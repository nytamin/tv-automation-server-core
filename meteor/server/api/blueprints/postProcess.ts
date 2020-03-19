import * as _ from 'underscore'
import { Piece } from '../../../lib/collections/Pieces'
import { AdLibPiece } from '../../../lib/collections/AdLibPieces'
import { RundownPlaylist } from '../../../lib/collections/RundownPlaylists'
import { extendMandadory, getHash, protectString, unprotectString, Omit, omit, literal } from '../../../lib/lib'
import {
	TimelineObjGeneric,
	TimelineObjRundown,
	TimelineObjType
} from '../../../lib/collections/Timeline'
import { Studio } from '../../../lib/collections/Studios'
import { Meteor } from 'meteor/meteor'
import {
	TimelineObjectCoreExt,
	IBlueprintPiece,
	IBlueprintAdLibPiece,
	TSR,
} from 'tv-automation-sofie-blueprints-integration'
import { RundownAPI } from '../../../lib/api/rundown'
import { BlueprintId } from '../../../lib/collections/Blueprints'
import { PartId, DBPart } from '../../../lib/collections/Parts'
import { SegmentId, DBSegment } from '../../../lib/collections/Segments';
import { RundownContext } from './context';
import { RundownBaselineAdLibItem } from '../../../lib/collections/RundownBaselineAdLibPieces';

export function postProcessPieces (innerContext: RundownContext, pieces: IBlueprintPiece[], blueprintId: BlueprintId, part: DBPart, segment: DBSegment): Piece[] {
	let i = 0
	let timelineUniqueIds: { [id: string]: true } = {}
	return _.map(_.compact(pieces), (itemOrig: IBlueprintPiece) => {
		let piece: Piece = {
			...itemOrig as Omit<IBlueprintPiece, 'continuesRefId'>,
			_id: protectString(innerContext.getHashId(`${blueprintId}_${part._id}_piece_${i++}`)),
			continuesRefId: protectString(itemOrig.continuesRefId),
			startRundownId: innerContext._rundown._id,
			startRundownRank: innerContext._rundown._rank,
			startSegmentId: segment._id,
			startSegmentRank: segment._rank,
			startPartId: part._id,
			startPartRank: part._rank,
			status: RundownAPI.PieceStatusCode.UNKNOWN
		}

		if (!piece.externalId && !piece.isTransition) throw new Meteor.Error(400, `Error in blueprint "${blueprintId}" externalId not set for piece in ${part._id}! ("${innerContext.unhashId(unprotectString(piece._id))}")`)

		if (piece.content && piece.content.timelineObjects) {
			piece.content.timelineObjects = _.map(_.compact(piece.content.timelineObjects), (o: TimelineObjectCoreExt) => {
				const obj = convertTimelineObject(o)

				if (!obj.id) obj.id = innerContext.getHashId(piece._id + '_' + (i++))

				if (timelineUniqueIds[obj.id]) throw new Meteor.Error(400, `Error in blueprint "${blueprintId}" ids of timelineObjs must be unique! ("${innerContext.unhashId(obj.id)}")`)
				timelineUniqueIds[obj.id] = true

				return obj
			})
		}

		return piece
	})
}

export function postProcessBaselineAdLibPieces (innerContext: RundownContext, adLibPieces: IBlueprintAdLibPiece[], blueprintId: BlueprintId): RundownBaselineAdLibItem[] {
	let i = 0
	let timelineUniqueIds: { [id: string]: true } = {}
	return _.map(_.compact(adLibPieces), (itemOrig: IBlueprintAdLibPiece) => {
		let piece: RundownBaselineAdLibItem = {
			...itemOrig,
			_id: protectString(innerContext.getHashId(`${blueprintId}_baseline_adlib_piece_${i++}`)),
			rundownId: innerContext._rundown._id,
			status: RundownAPI.PieceStatusCode.UNKNOWN,
			disabled: false
		}

		if (!piece.externalId) throw new Meteor.Error(400, `Error in blueprint "${blueprintId}" externalId not set for piece in ' + partId + '! ("${innerContext.unhashId(unprotectString(piece._id))}")`)

		if (piece.content && piece.content.timelineObjects) {
			piece.content.timelineObjects = _.map(_.compact(piece.content.timelineObjects), (o: TimelineObjectCoreExt) => {
				const obj = convertTimelineObject(o)

				if (!obj.id) obj.id = innerContext.getHashId(piece._id + '_adlib_' + (i++))

				if (timelineUniqueIds[obj.id]) throw new Meteor.Error(400, `Error in blueprint "${blueprintId}" ids of timelineObjs must be unique! ("${innerContext.unhashId(obj.id)}")`)
				timelineUniqueIds[obj.id] = true

				return obj
			})
		}

		return piece
	})
}

export function postProcessAdLibPieces (innerContext: RundownContext, adLibPieces: IBlueprintAdLibPiece[], blueprintId: BlueprintId, partId: PartId): AdLibPiece[] {
	let i = 0
	let timelineUniqueIds: { [id: string]: true } = {}
	return _.map(_.compact(adLibPieces), (itemOrig: IBlueprintAdLibPiece) => {
		let piece: AdLibPiece = {
			...itemOrig,
			_id: protectString(innerContext.getHashId(`${blueprintId}_${partId}_adlib_piece_${i++}`)),
			rundownId: innerContext._rundown._id,
			partId: partId,
			status: RundownAPI.PieceStatusCode.UNKNOWN,
			disabled: false
		}

		if (!piece.externalId) throw new Meteor.Error(400, `Error in blueprint "${blueprintId}" externalId not set for piece in ' + partId + '! ("${innerContext.unhashId(unprotectString(piece._id))}")`)

		if (piece.content && piece.content.timelineObjects) {
			piece.content.timelineObjects = _.map(_.compact(piece.content.timelineObjects), (o: TimelineObjectCoreExt) => {
				const obj = convertTimelineObject(o)

				if (!obj.id) obj.id = innerContext.getHashId(piece._id + '_adlib_' + (i++))

				if (timelineUniqueIds[obj.id]) throw new Meteor.Error(400, `Error in blueprint "${blueprintId}" ids of timelineObjs must be unique! ("${innerContext.unhashId(obj.id)}")`)
				timelineUniqueIds[obj.id] = true

				return obj
			})
		}

		return piece
	})
}

export function postProcessStudioBaselineObjects (studio: Studio, objs: TSR.TSRTimelineObjBase[]): TimelineObjRundown[] {
	const timelineUniqueIds: { [id: string]: true } = {}
	return _.map(_.compact(objs), (baseObj, i) => {
		const obj = convertTimelineObject(baseObj)

		if (!obj.id) obj.id = getHash('baseline_' + (i++))

		if (timelineUniqueIds[obj.id]) throw new Meteor.Error(400, `Error in blueprint "${studio.blueprintId}": ids of timelineObjs must be unique! ("${obj.id}")`)
		timelineUniqueIds[obj.id] = true

		return obj
	})
}

function convertTimelineObject (o: TimelineObjectCoreExt): TimelineObjRundown {
	return {
		...o,
		id: o.id,
		_id: protectString(''), // set later
		studioId: protectString(''), // set later
		objectType: TimelineObjType.RUNDOWN,
	}
}

export function postProcessRundownBaselineItems (innerContext: RundownContext, baselineItems: TSR.Timeline.TimelineObject[]): TimelineObjGeneric[] {
	const timelineUniqueIds: { [id: string]: true } = {}
	return _.map(_.compact(baselineItems), (o: TimelineObjGeneric, i): TimelineObjGeneric => {
		const obj: TimelineObjGeneric = convertTimelineObject(o)

		if (!obj.id) obj.id = innerContext.getHashId('baseline_' + (i++))

		if (timelineUniqueIds[obj.id]) throw new Meteor.Error(400, `Error in baseline blueprint: ids of timelineObjs must be unique! ("${innerContext.unhashId(obj.id)}")`)
		timelineUniqueIds[obj.id] = true

		return obj
	})
}
