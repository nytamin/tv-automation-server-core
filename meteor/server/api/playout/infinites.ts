import * as _ from 'underscore'
import { Meteor } from 'meteor/meteor'
import { getPieceGroupId, PieceLifespan } from 'tv-automation-sofie-blueprints-integration'
import { logger } from '../../../lib/logging'
import { Rundown, DBRundown, RundownId } from '../../../lib/collections/Rundowns'
import { Part, PartId, DBPart } from '../../../lib/collections/Parts'
import { syncFunctionIgnore, syncFunction } from '../../codeControl'
import { Piece, Pieces, PieceId } from '../../../lib/collections/Pieces'
import { asyncCollectionUpdate, waitForPromiseAll, asyncCollectionRemove, asyncCollectionInsert, makePromise, waitForPromise, asyncCollectionFindFetch, literal, protectString, unprotectObject, waitForPromiseObj, normalizeArrayFunc, normalizeArray, unprotectString } from '../../../lib/lib'
import { PartInstance, PartInstances, PartInstanceId } from '../../../lib/collections/PartInstances'
import { PieceInstances, PieceInstance } from '../../../lib/collections/PieceInstances'
import { RundownPlaylist } from '../../../lib/collections/RundownPlaylists'
import { getPartsAfter } from './lib'
import { SegmentId, Segment, Segments, DBSegment } from '../../../lib/collections/Segments'
import { ShowStyleBase, DBShowStyleBase } from '../../../lib/collections/ShowStyleBases'

export interface InfinitePiecesToCopy {
	existingInstances: PieceInstance[]
	newInfinites: Piece[]
}

export function getInfinitePiecesToCopy(previousPartInstanceId: PartInstanceId | null, infinites: Piece[]): InfinitePiecesToCopy {
	if (!previousPartInstanceId) {
		return {
			existingInstances: [],
			newInfinites: infinites
		}
	}

	const pieceIds = _.map(infinites, inf => inf._id)

	const pieceInstances = PieceInstances.find({
		partInstanceId: previousPartInstanceId,
		'piece._id': { $in: pieceIds }
	}).fetch()
	const pieceInstancesMap = normalizeArrayFunc(pieceInstances, instance => unprotectString(instance.piece._id))

	const result: InfinitePiecesToCopy = {
		existingInstances: [],
		newInfinites: []
	}

	_.each(infinites, infinite => {
		const instance = pieceInstancesMap[unprotectString(infinite._id)]
		if (instance) {
			result.existingInstances.push(instance)
		} else {
			result.newInfinites.push(infinite)
		}
	})

	return result
}

export function getInfinitesStillRunningForPart(showStyleBase: DBShowStyleBase, rundownIds: RundownId[], rundown: DBRundown, segment: DBSegment, part: DBPart): Piece[] {
	// if (!segment0 || segment0._id !== part.segmentId) {
	// 	segment0 = Segments.findOne(part.segmentId)
	// }
	// const segment = segment0 as Segment
	// if (!segment) {
	// 	throw new Meteor.Error(404, `Segment "${part.segmentId}" was not found`)
	// }
	
	// Load the OnSegmentEnd infinites
	const pSegmentInfinites = asyncCollectionFindFetch(Pieces, {
		lifespan: PieceLifespan.OutOnSegmentEnd,
		startRundownId: part.rundownId,
		startSegmentId: part.segmentId,
		startPartRank: { $lt: part._rank }
	}, {
		sort: {
			startRundownRank: -1,
			startSegmentRank: -1,
			startPartRank: -1,
			'enable.start': -1,
			_id: 1 // Ensure order is stable
		}
	})

	// Load the latest infinite for each layer
	const pSourceLayerLatestInfinites = _.compact(_.map(showStyleBase.sourceLayers, layer => {
		// TODO - can we filter the sourcelayers more intelligently, as not every layer needs to consider OnRundownEnd infinites
		// TODO - should this account for piece.enable.start better? That will greatly complicate it, and is unlikely to provide a benefit
		// TODO-ASAP is this ok for the new combined collection?
		return asyncCollectionFindFetch(Pieces, {
			// TODO - onEnd types only
			sourceLayerId: layer._id,
			startRundownId: { $in: rundownIds },
			$or: [
				{
					// same segment, and same/previous part
					startRundownId: part.rundownId,
					startSegmentId: part.segmentId,
					startPartRank: { $lt: part._rank }
				},
				{
					// same rundown, and previous segment
					startRundownId: part.rundownId,
					startSegmentRank: { $lt: segment._rank }
				},
				// {
				// 	// previous rundown
				// 	startRundownRank: { $lt: rundown._rank }
				// }
			]
		}, {
			sort: {
				startRundownRank: -1,
				startSegmentRank: -1,
				startPartRank: -1,
				'enable.start': -1,
				_id: 1 // Ensure order is stable
			},
			limit: 1
		}).then(r => r.length > 0 ? r[0] : undefined)
	}))

	const sourceLayerLatestInfinites = _.compact(waitForPromiseAll(pSourceLayerLatestInfinites))
	const sourceLayerLatestInfinitesMap = normalizeArrayFunc(sourceLayerLatestInfinites, i => i.sourceLayerId)
	const segmentInfinites = waitForPromise(pSegmentInfinites)

	const resultInfinites: Piece[] = []

	// We have a list of all of the sourcelayers to process
	const sourceLayerIds = _.uniq(_.map([...sourceLayerLatestInfinites, ...segmentInfinites], l => l.sourceLayerId))
	_.each(sourceLayerIds, sourceLayerId => {
		const mainInfinite = sourceLayerLatestInfinitesMap[sourceLayerId]
		if (mainInfinite) {
			// Figure out if the found infinite is valid for this part
			switch(mainInfinite.lifespan) {
				case PieceLifespan.WithinPart:
					// This piece is not infinite, so ignore it
					// TODO-ASAP verify this claim
					break
				case PieceLifespan.OutOnSegmentEnd:
					if (mainInfinite.startSegmentId === part.segmentId) {
						resultInfinites.push(mainInfinite)
					}
					break
				case PieceLifespan.OutOnRundownEnd:
					if (mainInfinite.startRundownId === part.rundownId) {
						resultInfinites.push(mainInfinite)
					}
					break
				default:
					//TODO
					break
			}
		} else {
			// TODO fallback to 'cheap' segment only method via segmentInfinites
		}
	})

	return resultInfinites
}

export function updateInfinitesForNextedPieceInstance(rundownPlaylist: RundownPlaylist, sourceLayerId: string) {
	// TODO - this will be called when a layer is modified which could contain a new infinite via an adlib.
}


export function updateSourceLayerInfinitesAfterPart (rundown: Rundown, previousPart?: Part, runUntilEnd?: boolean): void {
	// TODO - should this be replaced with something to sync data across??
}
