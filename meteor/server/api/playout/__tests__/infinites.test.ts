import { Meteor } from 'meteor/meteor'
import '../../../../__mocks__/_extendJest'
import { testInFiber } from '../../../../__mocks__/helpers/jest'
import { fixSnapshot } from '../../../../__mocks__/helpers/snapshot'
import { mockupCollection } from '../../../../__mocks__/helpers/lib'
import { setupDefaultStudioEnvironment, DefaultEnvironment, setupDefaultRundownPlaylist, setupMockPeripheralDevice } from '../../../../__mocks__/helpers/database'
import { ShowStyleBase, ShowStyleBases, DBShowStyleBase } from '../../../../lib/collections/ShowStyleBases';
import { Rundowns, RundownId, DBRundown } from '../../../../lib/collections/Rundowns';
import { Segments, SegmentId, DBSegment } from '../../../../lib/collections/Segments';
import { Parts, PartId, DBPart } from '../../../../lib/collections/Parts';
import { InfinitePieces, InfinitePieceId, InfinitePieceInner } from '../../../../lib/collections/InfinitePiece';
import { protectString, literal } from '../../../../lib/lib';
import { RundownPlaylistId } from '../../../../lib/collections/RundownPlaylists';
import { Piece } from '../../../../lib/collections/Pieces';
import { InfiniteMode, SourceLayerType } from 'tv-automation-sofie-blueprints-integration';
import { getInfinitesForPart } from '../infinites';

const Ids = {
	playlist: protectString<RundownPlaylistId>('playlist0'),
	rundown0: protectString<RundownId>('rundown0'),
	rundown0Rank: 0,
	rundown1: protectString<RundownId>('rundown1'),
	rundown1Rank: 1,

	segment0_0: protectString<SegmentId>('segment0_0'),
	segment0_0Rank: 0,
	segment0_1: protectString<SegmentId>('segment0_1'),
	segment0_1Rank: 1,
	segment0_2: protectString<SegmentId>('segment0_2'),
	segment0_2Rank: 2,
	segment1_0: protectString<SegmentId>('segment1_0'),
	segment1_0Rank: 0,
	segment1_1: protectString<SegmentId>('segment1_1'),
	segment1_1Rank: 1,

	part0_0_0: protectString<PartId>('part0_0_0'),
	part0_0_0Rank: 0,
	part0_0_1: protectString<PartId>('part0_0_1'),
	part0_0_1Rank: 1,
	part0_0_2: protectString<PartId>('part0_0_2'),
	part0_0_2Rank: 2,
	part0_1_0: protectString<PartId>('part0_1_0'),
	part0_1_0Rank: 0,
	part0_1_1: protectString<PartId>('part0_1_1'),
	part0_1_1Rank: 1,
	part0_2_0: protectString<PartId>('part0_2_0'),
	part0_2_0Rank: 0,
	part1_0_0: protectString<PartId>('part1_0_0'),
	part1_0_0Rank: 0,
	part1_0_1: protectString<PartId>('part1_0_1'),
	part1_0_1Rank: 1,
	part1_1_0: protectString<PartId>('part1_1_0'),
	part1_1_0Rank: 0,
	part1_1_1: protectString<PartId>('part1_1_1'),
	part1_1_1Rank: 1,

	infiniteInOtherPlaylist: protectString<InfinitePieceId>('infinite-in-other-playlist')
}
const rundownIds = [Ids.rundown0, Ids.rundown1]
const Fakes = {
	showStyleBase: literal<Partial<DBShowStyleBase>>({
		sourceLayers: [
			{
				_id: 'layer0',
				_rank: 0,
				name: 'Layer 0',
				type: SourceLayerType.UNKNOWN
			},
			{
				_id: 'bad-layer',
				_rank: 0,
				name: 'Bad layer',
				type: SourceLayerType.UNKNOWN
			}
		]
	}) as DBShowStyleBase,

	rundown0: literal<Partial<DBRundown>>({
		_id: Ids.rundown0,
		_rank: Ids.rundown0Rank
	}) as DBRundown,
	rundown1: literal<Partial<DBRundown>>({
		_id: Ids.rundown1,
		_rank: Ids.rundown1Rank
	}) as DBRundown,

	segment0_0: literal<Partial<DBSegment>>({
		_id: Ids.segment0_0,
		_rank: Ids.segment0_0Rank,
		rundownId: Ids.rundown0
	}) as DBSegment,
	segment0_1: literal<Partial<DBSegment>>({
		_id: Ids.segment0_1,
		_rank: Ids.segment0_1Rank,
		rundownId: Ids.rundown0
	}) as DBSegment,
	segment0_2: literal<Partial<DBSegment>>({
		_id: Ids.segment0_2,
		_rank: Ids.segment0_2Rank,
		rundownId: Ids.rundown0
	}) as DBSegment,
	segment1_0: literal<Partial<DBSegment>>({
		_id: Ids.segment1_0,
		_rank: Ids.segment1_0Rank,
		rundownId: Ids.rundown1
	}) as DBSegment,

	part0_0_0: literal<Partial<DBPart>>({
		_id: Ids.part0_0_0,
		_rank: Ids.part0_0_0Rank,
		segmentId: Ids.segment0_0,
		rundownId: Ids.rundown0
	}) as DBPart,
	part0_0_1: literal<Partial<DBPart>>({
		_id: Ids.part0_0_1,
		_rank: Ids.part0_0_1Rank,
		segmentId: Ids.segment0_0,
		rundownId: Ids.rundown0
	}) as DBPart,
	part0_0_2: literal<Partial<DBPart>>({
		_id: Ids.part0_0_2,
		_rank: Ids.part0_0_2Rank,
		segmentId: Ids.segment0_0,
		rundownId: Ids.rundown0
	}) as DBPart,
	part0_1_0: literal<Partial<DBPart>>({
		_id: Ids.part0_1_0,
		_rank: Ids.part0_1_0Rank,
		segmentId: Ids.segment0_1,
		rundownId: Ids.rundown0
	}) as DBPart,
	part0_1_1: literal<Partial<DBPart>>({
		_id: Ids.part0_1_1,
		_rank: Ids.part0_1_1Rank,
		segmentId: Ids.segment0_1,
		rundownId: Ids.rundown0
	}) as DBPart,
	part0_2_0: literal<Partial<DBPart>>({
		_id: Ids.part0_2_0,
		_rank: Ids.part0_2_0Rank,
		segmentId: Ids.segment0_2,
		rundownId: Ids.rundown0
	}) as DBPart,
	part1_0_0: literal<Partial<DBPart>>({
		_id: Ids.part1_0_0,
		_rank: Ids.part1_0_0Rank,
		segmentId: Ids.segment1_0,
		rundownId: Ids.rundown1
	}) as DBPart
}

function setupBaseMockInfinitesRundown() {
	// Clean out old stuff
	ShowStyleBases.remove({ _id: { $exists: true } })
	// Rundowns.remove({})
	// Segments.remove({})
	// Parts.remove({})
	InfinitePieces.remove({ _id: { $exists: true } })

	// Insert new infinites
	InfinitePieces.insert({
		// This should never be seen, but exists to ensure we don't get data bleed from other playlists
		_id: Ids.infiniteInOtherPlaylist,
		startRundownId: protectString<RundownId>('bad-rundown'),
		startRundownRank: 0,
		startSegmentId: protectString<SegmentId>('bad-segment'),
		startSegmentRank: 0,
		startPartId: protectString<PartId>('bad-part'),
		startPartRank: 0,

		piece: literal<Partial<InfinitePieceInner>>({
			infiniteMode: InfiniteMode.OnRundownEnd,
			sourceLayerId: 'bad-layer',
			enable: { start: 0 }
		}) as any
	})

	// InfinitePieces.insert({
	// 	_id: protectString('rundown-end0'),
	// 	startRundownId: Ids.rundown0,
	// 	startRundownRank: 0,
	// 	startSegmentId: Ids.segment0_0,
	// 	startSegmentRank: 0,
	// 	startPartId: Ids.part0_0_0,
	// 	startPartRank: 0,

	// 	piece: literal<Partial<InfinitePieceInner>>({
	// 		infiniteMode: InfiniteMode.OnRundownEnd,
	// 		sourceLayerId: 'Layer0',
	// 		enable: { start: 0 }
	// 	}) as any
	// })
}

describe('Infinites Calculations', () => {
	beforeEach(() => {
		setupBaseMockInfinitesRundown()
	})
	testInFiber('OnRundownEnd isolated lifetime', () => {
		const id = protectString('infinite0')
		InfinitePieces.insert({
			_id: id,
			startRundownId: Ids.rundown0,
			startRundownRank: Ids.rundown0Rank,
			startSegmentId: Ids.segment0_0,
			startSegmentRank: Ids.segment0_0Rank,
			startPartId: Ids.part0_0_1,
			startPartRank: Ids.part0_0_1Rank,
	
			piece: literal<Partial<InfinitePieceInner>>({
				infiniteMode: InfiniteMode.OnRundownEnd,
				sourceLayerId: 'layer0',
				enable: { start: 0 }
			}) as any
		})

		{
			// Should not be running yet
			const result = getInfinitesForPart(Fakes.showStyleBase, rundownIds, Fakes.rundown0, Fakes.segment0_0, Fakes.part0_0_0)
			expect(result).toHaveLength(0)
		}

		{
			// Origin part
			const result = getInfinitesForPart(Fakes.showStyleBase, rundownIds, Fakes.rundown0, Fakes.segment0_0, Fakes.part0_0_1)
			expect(result).toHaveLength(1)
			expect(result[0]._id).toEqual(id)
		}

		{
			// Still going in last of rundown
			const result = getInfinitesForPart(Fakes.showStyleBase, rundownIds, Fakes.rundown0, Fakes.segment0_2, Fakes.part0_2_0)
			expect(result).toHaveLength(1)
			expect(result[0]._id).toEqual(id)
		}

		{
			// Clear on next rundown
			const result = getInfinitesForPart(Fakes.showStyleBase, rundownIds, Fakes.rundown1, Fakes.segment1_0, Fakes.part1_0_0)
			expect(result).toHaveLength(0)
		}
	})
	testInFiber('OnRundownEnd stops another', () => {
		const id0 = protectString('infinite0')
		const id1 = protectString('infinite1')
		InfinitePieces.insert({
			_id: id0,
			startRundownId: Ids.rundown0,
			startRundownRank: Ids.rundown0Rank,
			startSegmentId: Ids.segment0_0,
			startSegmentRank: Ids.segment0_0Rank,
			startPartId: Ids.part0_0_0,
			startPartRank: Ids.part0_0_0Rank,
	
			piece: literal<Partial<InfinitePieceInner>>({
				infiniteMode: InfiniteMode.OnRundownEnd,
				sourceLayerId: 'layer0',
				enable: { start: 0 }
			}) as any
		})
		InfinitePieces.insert({
			_id: id1,
			startRundownId: Ids.rundown0,
			startRundownRank: Ids.rundown0Rank,
			startSegmentId: Ids.segment0_1,
			startSegmentRank: Ids.segment0_1Rank,
			startPartId: Ids.part0_1_0,
			startPartRank: Ids.part0_1_0Rank,
	
			piece: literal<Partial<InfinitePieceInner>>({
				infiniteMode: InfiniteMode.OnRundownEnd,
				sourceLayerId: 'layer0',
				enable: { start: 0 }
			}) as any
		})

		{
			// Origin part
			const result = getInfinitesForPart(Fakes.showStyleBase, rundownIds, Fakes.rundown0, Fakes.segment0_0, Fakes.part0_0_0)
			expect(result).toHaveLength(1)
			expect(result[0]._id).toEqual(id0)
		}

		{
			// Second takes over
			const result = getInfinitesForPart(Fakes.showStyleBase, rundownIds, Fakes.rundown0, Fakes.segment0_1, Fakes.part0_1_0)
			expect(result).toHaveLength(1)
			expect(result[0]._id).toEqual(id1)
		}

		{
			// Clear on next rundown
			const result = getInfinitesForPart(Fakes.showStyleBase, rundownIds, Fakes.rundown1, Fakes.segment1_0, Fakes.part1_0_0)
			expect(result).toHaveLength(0)
		}
	})
	testInFiber('OnSegmentEnd isolated lifetime', () => {
		const id = protectString('infinite0')
		InfinitePieces.insert({
			_id: id,
			startRundownId: Ids.rundown0,
			startRundownRank: Ids.rundown0Rank,
			startSegmentId: Ids.segment0_0,
			startSegmentRank: Ids.segment0_0Rank,
			startPartId: Ids.part0_0_1,
			startPartRank: Ids.part0_0_1Rank,
	
			piece: literal<Partial<InfinitePieceInner>>({
				infiniteMode: InfiniteMode.OnSegmentEnd,
				sourceLayerId: 'layer0',
				enable: { start: 0 }
			}) as any
		})

		{
			// Should not be running yet
			const result = getInfinitesForPart(Fakes.showStyleBase, rundownIds, Fakes.rundown0, Fakes.segment0_0, Fakes.part0_0_0)
			expect(result).toHaveLength(0)
		}

		{
			// Origin part
			const result = getInfinitesForPart(Fakes.showStyleBase, rundownIds, Fakes.rundown0, Fakes.segment0_0, Fakes.part0_0_1)
			expect(result).toHaveLength(1)
			expect(result[0]._id).toEqual(id)
		}

		{
			// Still going in last of segment
			const result = getInfinitesForPart(Fakes.showStyleBase, rundownIds, Fakes.rundown0, Fakes.segment0_0, Fakes.part0_0_2)
			expect(result).toHaveLength(1)
			expect(result[0]._id).toEqual(id)
		}

		{
			// Clear on next segment
			const result = getInfinitesForPart(Fakes.showStyleBase, rundownIds, Fakes.rundown0, Fakes.segment0_1, Fakes.part0_1_0)
			expect(result).toHaveLength(0)
		}
	})
	testInFiber('OnSegmentEnd stops OnRundownEnd', () => {
		const id0 = protectString('infinite0')
		const id1 = protectString('infinite1')
		InfinitePieces.insert({
			_id: id0,
			startRundownId: Ids.rundown0,
			startRundownRank: Ids.rundown0Rank,
			startSegmentId: Ids.segment0_0,
			startSegmentRank: Ids.segment0_0Rank,
			startPartId: Ids.part0_0_0,
			startPartRank: Ids.part0_0_0Rank,
	
			piece: literal<Partial<InfinitePieceInner>>({
				infiniteMode: InfiniteMode.OnRundownEnd,
				sourceLayerId: 'layer0',
				enable: { start: 0 }
			}) as any
		})
		InfinitePieces.insert({
			_id: id1,
			startRundownId: Ids.rundown0,
			startRundownRank: Ids.rundown0Rank,
			startSegmentId: Ids.segment0_1,
			startSegmentRank: Ids.segment0_1Rank,
			startPartId: Ids.part0_1_0,
			startPartRank: Ids.part0_1_0Rank,
	
			piece: literal<Partial<InfinitePieceInner>>({
				infiniteMode: InfiniteMode.OnSegmentEnd,
				sourceLayerId: 'layer0',
				enable: { start: 0 }
			}) as any
		})

		{
			// Origin part
			const result = getInfinitesForPart(Fakes.showStyleBase, rundownIds, Fakes.rundown0, Fakes.segment0_0, Fakes.part0_0_0)
			expect(result).toHaveLength(1)
			expect(result[0]._id).toEqual(id0)
		}

		{
			// Second takes over
			const result = getInfinitesForPart(Fakes.showStyleBase, rundownIds, Fakes.rundown0, Fakes.segment0_1, Fakes.part0_1_0)
			expect(result).toHaveLength(1)
			expect(result[0]._id).toEqual(id1)
		}

		{
			// Clear on next segment
			const result = getInfinitesForPart(Fakes.showStyleBase, rundownIds, Fakes.rundown0, Fakes.segment0_2, Fakes.part0_2_0)
			expect(result).toHaveLength(0)
		}
	})
})