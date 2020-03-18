import { Meteor } from 'meteor/meteor'
import '../../../../__mocks__/_extendJest'
import { testInFiber } from '../../../../__mocks__/helpers/jest'
import { fixSnapshot } from '../../../../__mocks__/helpers/snapshot'
import { mockupCollection } from '../../../../__mocks__/helpers/lib'
import { setupDefaultStudioEnvironment, DefaultEnvironment, setupDefaultRundownPlaylist, setupMockPeripheralDevice } from '../../../../__mocks__/helpers/database'
import { Rundowns, Rundown } from '../../../../lib/collections/Rundowns'
import '../api'
import { Timeline as OrgTimeline } from '../../../../lib/collections/Timeline'
import { ServerPlayoutAPI } from '../playout'
import { deactivate } from '../../userActions'
import { RundownPlaylists, RundownPlaylist } from '../../../../lib/collections/RundownPlaylists'
import { PeripheralDevice } from '../../../../lib/collections/PeripheralDevices'
import { PeripheralDeviceCommands } from '../../../../lib/collections/PeripheralDeviceCommands'
import { Pieces, Piece } from '../../../../lib/collections/Pieces'
import { AdLibPieces } from '../../../../lib/collections/AdLibPieces'
import { PeripheralDeviceAPI } from '../../../../lib/api/peripheralDevice'
import { InfinitePieces, InfinitePieceInner, InfinitePieceId } from '../../../../lib/collections/InfinitePiece';
import { getRandomId, literal } from '../../../../lib/lib';
import { Segment } from '../../../../lib/collections/Segments';
import { InfiniteMode, SourceLayerType } from 'tv-automation-sofie-blueprints-integration';
import { Part } from '../../../../lib/collections/Parts';
import { PieceInstances, PieceInstanceId, PieceInstance } from '../../../../lib/collections/PieceInstances';
import { PartInstanceId } from '../../../../lib/collections/PartInstances';
import { Studio, Studios } from '../../../../lib/collections/Studios';
import { ShowStyleBases, ShowStyleBaseId } from '../../../../lib/collections/ShowStyleBases';
import * as _ from 'underscore';

const Timeline = mockupCollection(OrgTimeline)

function createBasicInfinitePiece(rundown: Rundown, part: Part, sourceLayerId: string, suffix: string, mode?: InfiniteMode) {
	const segment = part.getSegment() as Segment
	InfinitePieces.insert({
		_id: getRandomId(),
		startRundownId: rundown._id,
		startRundownRank: rundown._rank,
		startSegmentId: segment._id,
		startSegmentRank: segment._rank,
		startPartId: part._id,
		startPartRank: part._rank,
		piece: literal<InfinitePieceInner>({
			_id: getRandomId(),
			partId: undefined,
			externalId: `${part.externalId}_${suffix}`,
			rundownId: rundown._id,
			status: -1,
			name: `${part.title}_${suffix}`,
			sourceLayerId,
			outputLayerId: 'pgm',
			infiniteMode: mode || InfiniteMode.OnSegmentEnd,
			enable: { start: 0 }
		})
	})
}

function setupSomeInfinites(showStyleBaseId: ShowStyleBaseId, rundown: Rundown) {
	// Ensure the sourcelayers exist to make the infinite logic happy
	ShowStyleBases.update(showStyleBaseId, {
		$push: {
			sourceLayers: {
				_id: 'inf0',
				_rank: 0,
				name: 'Layer 0',
				type: SourceLayerType.UNKNOWN
			}
		}
	})
	ShowStyleBases.update(showStyleBaseId, {
		$push: {
			sourceLayers: {
				_id: 'inf1',
				_rank: 0,
				name: 'Bad layer',
				type: SourceLayerType.UNKNOWN
			}
		}
	})

	// Create some infinite pieces to use
	rundown.getParts().forEach(part => {
		createBasicInfinitePiece(rundown, part, 'inf0', 'inf0', part._rank === 1 ? InfiniteMode.OnRundownEnd : InfiniteMode.OnSegmentEnd)
		if (part._rank === 1) {
			createBasicInfinitePiece(rundown, part, 'inf1', 'inf1')
		}
	})

	// Check we got the right number of infinites before starting
	expect(InfinitePieces.find({ startRundownId: rundown._id }).count()).toEqual(7)
}

describe('Basic Playout', () => {
	let env: DefaultEnvironment
	let playoutDevice: PeripheralDevice

	beforeEach(() => {
		env = setupDefaultStudioEnvironment()
		playoutDevice = setupMockPeripheralDevice(
			PeripheralDeviceAPI.DeviceCategory.PLAYOUT,
			PeripheralDeviceAPI.DeviceType.PLAYOUT,
			PeripheralDeviceAPI.SUBTYPE_PROCESS,
			env.studio
		)
		// @ts-ignore
		Timeline.insert.mockClear()
		// @ts-ignore
		Timeline.upsert.mockClear()
		// @ts-ignore
		Timeline.update.mockClear()
	})
	testInFiber('rundown progression', () => {
		const {
			rundownId: rundownId0,
			playlistId: playlistId0
		} = setupDefaultRundownPlaylist(env)
		expect(rundownId0).toBeTruthy()
		expect(playlistId0).toBeTruthy()

		const getRundown0 = () => {
			return Rundowns.findOne(rundownId0) as Rundown
		}
		const getPlaylist0 = () => {
			return RundownPlaylists.findOne(playlistId0) as RundownPlaylist
		}

		const getPieceInstances = (...partInstanceIds: PartInstanceId[]) => {
			return PieceInstances.find({
				partInstanceId: { $in: partInstanceIds }
			}).fetch()
		}

		setupSomeInfinites(env.showStyleBaseId, getRundown0())

		const parts = getRundown0().getParts()

		expect(getPlaylist0()).toMatchObject({
			active: false,
			rehearsal: false
		})

		{
			// Prepare and activate in rehersal:
			ServerPlayoutAPI.activateRundownPlaylist(playlistId0, false)

			const { currentPartInstance, nextPartInstance } = getPlaylist0().getSelectedPartInstances()
			expect(currentPartInstance).toBeFalsy()
			expect(nextPartInstance).toBeTruthy()
			expect(nextPartInstance!.part._id).toEqual(parts[0]._id)

			expect(getPlaylist0()).toMatchObject({
				active: true,
				rehearsal: false,
				currentPartInstanceId: null,
				nextPartInstanceId: nextPartInstance!._id,
			})

			// check pieceInstances
			expect(fixSnapshot(getPieceInstances(nextPartInstance!._id))).toMatchSnapshot()
		}

		{
			// Perform a take:
			ServerPlayoutAPI.takeNextPart(playlistId0)

			const { currentPartInstance, nextPartInstance } = getPlaylist0().getSelectedPartInstances()
			expect(currentPartInstance).toBeTruthy()
			expect(currentPartInstance!.part._id).toEqual(parts[0]._id)
			expect(nextPartInstance).toBeTruthy()
			expect(nextPartInstance!.part._id).toEqual(parts[1]._id)
			expect(nextPartInstance!.segmentId).toEqual(currentPartInstance!.segmentId)

			expect(getPlaylist0()).toMatchObject({
				active: true,
				rehearsal: false,
				currentPartInstanceId: currentPartInstance!._id,
				nextPartInstanceId: nextPartInstance!._id,
			})

			// check pieceInstances
			expect(fixSnapshot(getPieceInstances(nextPartInstance!._id, currentPartInstance!._id))).toMatchSnapshot()
		}

		{
			// One more take (entering second segment):
			ServerPlayoutAPI.takeNextPart(playlistId0)

			const { currentPartInstance, nextPartInstance } = getPlaylist0().getSelectedPartInstances()
			expect(currentPartInstance).toBeTruthy()
			expect(currentPartInstance!.part._id).toEqual(parts[1]._id)
			expect(nextPartInstance).toBeTruthy()
			expect(nextPartInstance!.part._id).toEqual(parts[2]._id)
			expect(nextPartInstance!.segmentId).not.toEqual(currentPartInstance!.segmentId)

			expect(getPlaylist0()).toMatchObject({
				active: true,
				rehearsal: false,
				currentPartInstanceId: currentPartInstance!._id,
				nextPartInstanceId: nextPartInstance!._id,
			})

			// check pieceInstances
			expect(fixSnapshot(getPieceInstances(nextPartInstance!._id, currentPartInstance!._id))).toMatchSnapshot()
		}
	})
	testInFiber('check infinites are copied where possible', () => {
		const {
			rundownId: rundownId0,
			playlistId: playlistId0
		} = setupDefaultRundownPlaylist(env)
		expect(rundownId0).toBeTruthy()
		expect(playlistId0).toBeTruthy()

		const getRundown0 = () => {
			return Rundowns.findOne(rundownId0) as Rundown
		}
		const getPlaylist0 = () => {
			return RundownPlaylists.findOne(playlistId0) as RundownPlaylist
		}

		const getPieceInstances = (...partInstanceIds: PartInstanceId[]) => {
			return PieceInstances.find({
				partInstanceId: { $in: partInstanceIds }
			}).fetch()
		}

		setupSomeInfinites(env.showStyleBaseId, getRundown0())

		const parts = getRundown0().getParts()

		expect(getPlaylist0()).toMatchObject({
			active: false,
			rehearsal: false
		})

		let lastInfiniteIds: InfinitePieceId[] = []
		const checkPieceInstancesAreCopiedInfinitesWhenPossible = (partInstanceId: PartInstanceId | null) => {
			if (partInstanceId) {
				const pieceInstances = getPieceInstances(partInstanceId)
				_.each(pieceInstances, pieceInstance => {
					if (pieceInstance.infinite && lastInfiniteIds.indexOf(pieceInstance.infinite.infinitePieceId) !== -1) {
						expect(pieceInstance.piece.content).toEqual('existing-instance')
					} else {
						expect(pieceInstance.piece.content).not.toEqual('existing-instance')
					}
				})
				
				lastInfiniteIds = _.compact(_.map(pieceInstances, inst => inst.infinite ? inst.infinite.infinitePieceId : null))
			} else {
				lastInfiniteIds = []
			}

			// mark all instances as existing
			PieceInstances.update({
				rundownId: rundownId0
			}, {
				$set: {
					'piece.content': 'existing-instance'
				}
			}, {
				multi: true
			})
		}

		{
			// Start rundown:
			ServerPlayoutAPI.activateRundownPlaylist(playlistId0, false)

			const { currentPartInstance, nextPartInstance } = getPlaylist0().getSelectedPartInstances()
			expect(currentPartInstance).toBeFalsy()
			expect(nextPartInstance).toBeTruthy()
			expect(nextPartInstance!.part._id).toEqual(parts[0]._id)

			expect(getPlaylist0()).toMatchObject({
				active: true,
				rehearsal: false,
				currentPartInstanceId: null,
				nextPartInstanceId: nextPartInstance!._id,
			})

			// check pieceInstances
			expect(fixSnapshot(getPieceInstances(nextPartInstance!._id))).toMatchSnapshot()
			checkPieceInstancesAreCopiedInfinitesWhenPossible(nextPartInstance!._id)
		}

		{
			// Do a take:
			ServerPlayoutAPI.takeNextPart(playlistId0)

			const { currentPartInstance, nextPartInstance } = getPlaylist0().getSelectedPartInstances()
			expect(currentPartInstance).toBeTruthy()
			expect(currentPartInstance!.part._id).toEqual(parts[0]._id)
			expect(nextPartInstance).toBeTruthy()
			expect(nextPartInstance!.part._id).toEqual(parts[1]._id)
			expect(nextPartInstance!.segmentId).toEqual(currentPartInstance!.segmentId)
			expect(getPlaylist0()).toMatchObject({
				active: true,
				rehearsal: false,
				currentPartInstanceId: currentPartInstance!._id,
				nextPartInstanceId: nextPartInstance!._id,
			})

			// check pieceInstances
			expect(fixSnapshot(getPieceInstances(nextPartInstance!._id, currentPartInstance!._id))).toMatchSnapshot()
			checkPieceInstancesAreCopiedInfinitesWhenPossible(nextPartInstance!._id)
		}

		{
			// Another take:
			ServerPlayoutAPI.takeNextPart(playlistId0)

			const { currentPartInstance, nextPartInstance } = getPlaylist0().getSelectedPartInstances()
			expect(currentPartInstance).toBeTruthy()
			expect(currentPartInstance!.part._id).toEqual(parts[1]._id)
			expect(nextPartInstance).toBeTruthy()
			expect(nextPartInstance!.part._id).toEqual(parts[2]._id)

			expect(getPlaylist0()).toMatchObject({
				active: true,
				rehearsal: false,
				currentPartInstanceId: currentPartInstance!._id,
				nextPartInstanceId: nextPartInstance!._id,
			})

			// check pieceInstances
			expect(fixSnapshot(getPieceInstances(nextPartInstance!._id, currentPartInstance!._id))).toMatchSnapshot()
			checkPieceInstancesAreCopiedInfinitesWhenPossible(nextPartInstance!._id)
		}

		{
			// Take the last part
			const lastPartId =  _.last(parts)!._id
			ServerPlayoutAPI.setNextPart(playlistId0, lastPartId)
			ServerPlayoutAPI.takeNextPart(playlistId0)

			const { currentPartInstance, nextPartInstance } = getPlaylist0().getSelectedPartInstances()
			expect(currentPartInstance).toBeTruthy()
			expect(currentPartInstance!.part._id).toEqual(lastPartId)
			expect(nextPartInstance).toBeFalsy()

			expect(getPlaylist0()).toMatchObject({
				active: true,
				rehearsal: false,
				currentPartInstanceId: currentPartInstance!._id,
				nextPartInstanceId: null,
			})

			// check pieceInstances
			expect(fixSnapshot(getPieceInstances(currentPartInstance!._id))).toMatchSnapshot()
			checkPieceInstancesAreCopiedInfinitesWhenPossible(null)
		}

		{
			// Take the second again, to ensure we dont get accidental copies
			ServerPlayoutAPI.setNextPart(playlistId0, parts[1]._id)
			ServerPlayoutAPI.takeNextPart(playlistId0)

			const { currentPartInstance, nextPartInstance } = getPlaylist0().getSelectedPartInstances()
			expect(currentPartInstance).toBeTruthy()
			expect(currentPartInstance!.part._id).toEqual(parts[1]._id)
			expect(nextPartInstance).toBeTruthy()
			expect(nextPartInstance!.part._id).toEqual(parts[2]._id)

			expect(getPlaylist0()).toMatchObject({
				active: true,
				rehearsal: false,
				currentPartInstanceId: currentPartInstance!._id,
				nextPartInstanceId: nextPartInstance!._id,
			})

			// check pieceInstances
			expect(fixSnapshot(getPieceInstances(nextPartInstance!._id, currentPartInstance!._id))).toMatchSnapshot()
			checkPieceInstancesAreCopiedInfinitesWhenPossible(nextPartInstance!._id)
		}
	})
})
