import { Meteor } from 'meteor/meteor'
import '../../../../__mocks__/_extendJest'
import { testInFiber } from '../../../../__mocks__/helpers/jest'
import { fixSnapshot } from '../../../../__mocks__/helpers/snapshot'
import { mockupCollection } from '../../../../__mocks__/helpers/lib'
import { setupDefaultStudioEnvironment, DefaultEnvironment, setupDefaultRundownPlaylist, setupMockPeripheralDevice } from '../../../../__mocks__/helpers/database'
import { ShowStyleBase, ShowStyleBases, DBShowStyleBase } from '../../../../lib/collections/ShowStyleBases';
import { Rundowns, RundownId, DBRundown, Rundown } from '../../../../lib/collections/Rundowns';
import { Segments, SegmentId, DBSegment } from '../../../../lib/collections/Segments';
import { Parts, PartId, DBPart, Part } from '../../../../lib/collections/Parts';
import { protectString, literal, normalizeArray } from '../../../../lib/lib';
import { RundownPlaylistId, RundownPlaylistPlayoutData, DBRundownPlaylist, RundownPlaylist } from '../../../../lib/collections/RundownPlaylists';
import { Piece, PieceId, Pieces } from '../../../../lib/collections/Pieces';
import { PieceLifespan, SourceLayerType, TSR, TimelineObjectCoreExt, LookaheadMode } from 'tv-automation-sofie-blueprints-integration';
import { PartInstance, DBPartInstance, PartInstanceId } from '../../../../lib/collections/PartInstances';
import { PieceInstances, PieceInstance, PieceInstancePiece } from '../../../../lib/collections/PieceInstances';
import { findLookaheadForlayer } from '../lookahead'

const Ids = {
	playlist: protectString<RundownPlaylistId>('playlist0'),
	rundown0: protectString<RundownId>('rundown0'),
	rundown0Rank: 0,
	rundown1: protectString<RundownId>('rundown1'),
	rundown1Rank: 1,

	part0: protectString<PartId>('part0'),
	part1: protectString<PartId>('part1'),
	part2: protectString<PartId>('part2'),
	part3: protectString<PartId>('part3'),
	part4: protectString<PartId>('part4'),

	partInstance0: protectString<PartInstanceId>('partInstance0'),
	partInstance1: protectString<PartInstanceId>('partInstance1'),
	partInstance2: protectString<PartInstanceId>('partInstance2'),
	partInstance3: protectString<PartInstanceId>('partInstance3'),
}
const rundownIds = [Ids.rundown0, Ids.rundown1]
const Fakes = {
	playlist: new RundownPlaylist(literal<Partial<DBRundownPlaylist>>({
		_id: Ids.playlist,
	}) as DBRundownPlaylist),
	rundown0: new Rundown(literal<Partial<DBRundown>>({
		_id: Ids.rundown0,
		_rank: Ids.rundown0Rank
	}) as DBRundown),
	rundown1: new Rundown(literal<Partial<DBRundown>>({
		_id: Ids.rundown1,
		_rank: Ids.rundown1Rank
	}) as DBRundown),

	part0: new Part(literal<Partial<DBPart>>({
		_id: Ids.part0
	}) as DBPart),
	part1: new Part(literal<Partial<DBPart>>({
		_id: Ids.part1
	}) as DBPart),
	part2: new Part(literal<Partial<DBPart>>({
		_id: Ids.part2
	}) as DBPart),
	part3: new Part(literal<Partial<DBPart>>({
		_id: Ids.part3
	}) as DBPart),
	part4: new Part(literal<Partial<DBPart>>({
		_id: Ids.part4
	}) as DBPart),
}
const Fakes2 = {
	partInstance0: new PartInstance(literal<Partial<DBPartInstance>>({
		_id: Ids.partInstance0,
		part: Fakes.part0
	}) as DBPartInstance),
	partInstance1: new PartInstance(literal<Partial<DBPartInstance>>({
		_id: Ids.partInstance1,
		part: Fakes.part1
	}) as DBPartInstance),
	partInstance2: new PartInstance(literal<Partial<DBPartInstance>>({
		_id: Ids.partInstance2,
		part: Fakes.part2
	}) as DBPartInstance),
	partInstance3: new PartInstance(literal<Partial<DBPartInstance>>({
		_id: Ids.partInstance3,
		part: Fakes.part3
	}) as DBPartInstance),

	pieceInstances1: literal<Array<Partial<PieceInstance>>>([
		{
			_id: protectString('pieceInstance1_0'),
			partInstanceId: Ids.partInstance1,
			piece: {
				enable: { start: 0 },
				content: {
					timelineObjects: [
						{
							id: 'some-obj',
							enable: { start: 0 },
							layer: 'layer1'
						} as TimelineObjectCoreExt
					]
				}
			} as PieceInstancePiece
		},
		{
			_id: protectString('pieceInstance1_1'),
			partInstanceId: Ids.partInstance1,
			piece: {
				enable: { start: 0 },
				content: {
					timelineObjects: [
						{
							id: 'some-obj2',
							enable: { start: 0 },
							layer: 'layer2'
						} as TimelineObjectCoreExt
					]
				}
			} as PieceInstancePiece
		}
	]) as PieceInstance[],
	pieceInstances2: literal<Array<Partial<PieceInstance>>>([
		{
			_id: protectString('pieceInstance2_0'),
			partInstanceId: Ids.partInstance2,
			piece: {
				enable: { start: 0 },
				content: {
					timelineObjects: [
						{
							id: 'some-obj3',
							enable: { start: 0 },
							layer: 'layer1'
						} as TimelineObjectCoreExt
					]
				}
			} as PieceInstancePiece
		},
		{
			_id: protectString('pieceInstance2_1'),
			partInstanceId: Ids.partInstance2,
			piece: {
				enable: { start: 1000 },
				content: {
					timelineObjects: [
						{
							id: 'some-obj4',
							enable: { start: 0 },
							layer: 'layer1'
						} as TimelineObjectCoreExt
					]
				}
			} as PieceInstancePiece
		}
	]) as PieceInstance[],
}

const playoutData: RundownPlaylistPlayoutData = {
	rundownPlaylist: Fakes.playlist,
	rundowns: [Fakes.rundown0, Fakes.rundown1],
	rundownsMap: normalizeArray([Fakes.rundown0, Fakes.rundown1], '_id'),

	// TODO
	currentPartInstance: undefined,
	nextPartInstance: undefined,
	previousPartInstance: undefined,
	selectedInstancePieces: []
}

function setupBaseMockInfinitesRundown() {
	// Clean out old stuff
	ShowStyleBases.remove({ _id: { $exists: true } })
	Pieces.remove({ _id: { $exists: true } })

	playoutData.currentPartInstance = undefined
	playoutData.nextPartInstance = undefined
	playoutData.previousPartInstance = undefined
	playoutData.selectedInstancePieces = []
	playoutData.rundownPlaylist.currentPartInstanceId = null
	playoutData.rundownPlaylist.nextPartInstanceId = null
	playoutData.rundownPlaylist.previousPartInstanceId = null

	Pieces.insert({
		_id: protectString('random piece'),
		startRundownId: Ids.rundown0,
		startRundownRank: Ids.rundown0Rank,
		startSegmentId: protectString('segment0'),
		startSegmentRank: 0,
		startPartId: Ids.part3,
		startPartRank: 3,

		externalId: '',
		status: 0,
		name: '',
		lifespan: PieceLifespan.OutOnRundownEnd,
		sourceLayerId: 'layer0',
		outputLayerId: 'pgm',
		enable: { start: 0 },
		invalid: false,
		content: {
			timelineObjects: [
				{
					id: 'some-obj',
					enable: { start: 0 },
					layer: 'some-random-layer'
				} as TimelineObjectCoreExt
			]
		}
	})
	
}

describe('Lookahead Calculations', () => {
	beforeEach(() => {
		setupBaseMockInfinitesRundown()
	})
	describe('findLookaheadForlayer', () => {
		testInFiber('empty layer should produce nothing', () => {
			{
				// From no active parts
				const parts = [Fakes.part0, Fakes.part1, Fakes.part2]
				const result = findLookaheadForlayer(playoutData, 'layer99', LookaheadMode.PRELOAD, 1, parts)
				expect(result.future).toHaveLength(0)
				expect(result.timed).toHaveLength(0)
			}

			{
				// With a current part
				const playoutData2: RundownPlaylistPlayoutData = {
					...playoutData,
					currentPartInstance: Fakes2.partInstance1,
					nextPartInstance: Fakes2.partInstance2,
					selectedInstancePieces: [...Fakes2.pieceInstances1, ...Fakes2.pieceInstances2]
				}
				const parts = [Fakes.part3, Fakes.part4]
				const result = findLookaheadForlayer(playoutData2, 'layer99', LookaheadMode.PRELOAD, 1, parts)
				expect(result.future).toHaveLength(0)
				expect(result.timed).toHaveLength(0)
			}
		})
		testInFiber('layer should produce something', () => {
			Pieces.insert({
				_id: protectString('piece0'),
				startRundownId: Ids.rundown0,
				startRundownRank: Ids.rundown0Rank,
				startSegmentId: protectString('segment0'),
				startSegmentRank: 0,
				startPartId: Ids.part3,
				startPartRank: 3,

				externalId: '',
				status: 0,
				name: '',
				lifespan: PieceLifespan.OutOnRundownEnd,
				sourceLayerId: 'layer0',
				outputLayerId: 'pgm',
				enable: { start: 0 },
				invalid: false,
				content: {
					timelineObjects: [
						{
							id: 'find-this-obj',
							enable: { start: 0 },
							layer: 'layer1'
						} as TimelineObjectCoreExt
					]
				}
			})
			{
				// From no active parts
				const parts = [Fakes.part0, Fakes.part1, Fakes.part2]
				const result = findLookaheadForlayer(playoutData, 'layer1', LookaheadMode.PRELOAD, 1, parts)
				expect(result.future).toHaveLength(0)
				expect(result.timed).toHaveLength(0)
			}

			{
				// From no active parts 2
				const parts = [Fakes.part0, Fakes.part1, Fakes.part2, Fakes.part3, Fakes.part4]
				const result = findLookaheadForlayer(playoutData, 'layer1', LookaheadMode.PRELOAD, 1, parts)
				expect(result.future).toHaveLength(1)
				expect(result.timed).toHaveLength(0)
				expect(result).toMatchSnapshot()
			}

			{
				// With a current part
				const playoutData2: RundownPlaylistPlayoutData = {
					...playoutData,
					currentPartInstance: Fakes2.partInstance1,
					nextPartInstance: Fakes2.partInstance2,
					selectedInstancePieces: [...Fakes2.pieceInstances1, ...Fakes2.pieceInstances2]
				}
				const parts = [Fakes.part3, Fakes.part4]
				const result = findLookaheadForlayer(playoutData2, 'layer1', LookaheadMode.PRELOAD, 1, parts)
				expect(result.future).toHaveLength(1)
				expect(result.timed).toHaveLength(3)
				expect(result).toMatchSnapshot()
			}
		})
		
		// TODO - more tests
	})
})