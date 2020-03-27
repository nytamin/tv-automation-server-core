import { Meteor } from 'meteor/meteor'
import * as _ from 'underscore'
import { LookaheadMode, Timeline as TimelineTypes, OnGenerateTimelineObj } from 'tv-automation-sofie-blueprints-integration'
import { Studio, MappingExt } from '../../../lib/collections/Studios'
import { TimelineObjGeneric, TimelineObjRundown, fixTimelineId, TimelineObjType } from '../../../lib/collections/Timeline'
import { Part, PartId } from '../../../lib/collections/Parts'
import { Piece, Pieces } from '../../../lib/collections/Pieces'
import { sortPiecesByStart } from './pieces'
import { literal, clone, unprotectString, protectString, makePromise, waitForPromiseAll } from '../../../lib/lib'
import { RundownPlaylistPlayoutData, RundownPlaylist } from '../../../lib/collections/RundownPlaylists'
import { PieceInstance, wrapPieceToInstance, PieceInstancePiece, rewrapPieceToInstance } from '../../../lib/collections/PieceInstances'
import { selectNextPart } from './lib'
import { PartInstanceId, PartInstance } from '../../../lib/collections/PartInstances'
import { Rundown, RundownId } from '../../../lib/collections/Rundowns';

const LOOKAHEAD_OBJ_PRIORITY = 0.1

export function getLookeaheadObjects (playoutData: RundownPlaylistPlayoutData, studio: Studio): Array<TimelineObjGeneric> {
	const timelineObjs: Array<TimelineObjGeneric> = []
	const mutateAndPushObject = (rawObj: TimelineObjRundown, i: string, enable: TimelineObjRundown['enable'], mapping: MappingExt, priority: number) => {
		const obj: TimelineObjGeneric = clone(rawObj)

		obj.id = `lookahead_${i}_${obj.id}`
		obj.priority = priority
		obj.enable = enable
		obj.isLookahead = true
		delete obj.keyframes
		delete obj.inGroup // force it to be cleared

		if (mapping.lookahead === LookaheadMode.PRELOAD) {
			obj.lookaheadForLayer = obj.layer
			obj.layer += '_lookahead'
		}

		timelineObjs.push(obj)
	}

	const calculateStartAfterPreviousObj = (prevObj: TimelineObjRundown): TimelineTypes.TimelineEnable => {
		const prevHasDelayFlag = (prevObj.classes || []).indexOf('_lookahead_start_delay') !== -1

		// Start with previous piece
		const startOffset = prevHasDelayFlag ? 2000 : 0
		return {
			start: `#${prevObj.id}.start + ${startOffset}`
		}
	}

	// Get all the parts and figure out which ones to consider for future lookahead
	const orderedParts = playoutData.rundownPlaylist.getAllOrderedParts()
	const nextNextPart = selectNextPart(playoutData.nextPartInstance || playoutData.currentPartInstance || null, orderedParts)
	let futureParts: Part[] = []
	if (nextNextPart) {
		futureParts = orderedParts.slice(nextNextPart.index)
	}

	const ps = _.map(studio.mappings || {}, (mapping: MappingExt, layerId: string) => {
		// This runs some db queries, so lets try and run in parallel whenever possible
		return makePromise(() => {
			const lookaheadDepth = mapping.lookahead === LookaheadMode.PRELOAD ? mapping.lookaheadDepth || 1 : 1 // TODO - test other modes
			const lookaheadObjs = findLookaheadForlayer(playoutData, layerId, mapping.lookahead, lookaheadDepth, futureParts)
	
			// Add the objects that have some timing info
			_.each(lookaheadObjs.timed, (entry, i) => {
				let enable: TimelineTypes.TimelineEnable = {
					start: 1 // Absolute 0 without a group doesnt work
				}
				if (i !== 0) {
					const prevObj = lookaheadObjs.timed[i - 1].obj
					enable = calculateStartAfterPreviousObj(prevObj)
				}
				if (!entry.obj.id) throw new Meteor.Error(500, 'lookahead: timeline obj id not set')
	
				enable.end = `#${entry.obj.id}.start`
	
				mutateAndPushObject(entry.obj, `timed${i}`, enable, mapping, LOOKAHEAD_OBJ_PRIORITY)
			})
	
			// Add each of the future objects, that have no end point
			const futureObjCount = lookaheadObjs.future.length
			const futurePriorityScale = LOOKAHEAD_OBJ_PRIORITY / (futureObjCount + 1)
			_.each(lookaheadObjs.future, (entry, i) => {
				if (!entry.obj.id) throw new Meteor.Error(500, 'lookahead: timeline obj id not set')
	
				// WHEN_CLEAR mode can't take multiple futures, as they are always flattened into the single layer. so give it some real timings, and only output one
				const singleFutureObj = mapping.lookahead !== LookaheadMode.WHEN_CLEAR
				if (singleFutureObj && i !== 0) {
					return
				}
	
				const lastTimedObj = _.last(lookaheadObjs.timed)
				const enable = singleFutureObj && lastTimedObj ? calculateStartAfterPreviousObj(lastTimedObj.obj) : { while: '1' }
				// We use while: 1 for the enabler, as any time before it should be active will be filled by either a playing object, or a timed lookahead.
				// And this allows multiple futures to be timed in a way that allows them to co-exist
	
				// Prioritise so that the earlier ones are higher, decreasing within the range 'reserved' for lookahead
				const priority = singleFutureObj ? LOOKAHEAD_OBJ_PRIORITY : futurePriorityScale * (futureObjCount - i)
				mutateAndPushObject(entry.obj, `future${i}`, enable, mapping, priority)
			})
		})
	})
	waitForPromiseAll(ps)
	
	return timelineObjs
}

export interface LookaheadObjectEntry {
	obj: TimelineObjRundown
	partId: PartId
}

export interface LookaheadResult {
	timed: Array<LookaheadObjectEntry>
	future: Array<LookaheadObjectEntry>
}

export function findLookaheadForlayer (
	playoutData: RundownPlaylistPlayoutData,
	layer: string,
	mode: LookaheadMode,
	lookaheadDepth: number,
	futureParts: Part[],
	// followingPiecesQueryFragment: Mongo.Query<Piece>[]
	): LookaheadResult {

	const res: LookaheadResult = {
		timed: [],
		future: []
	}

	if (mode === undefined || mode === LookaheadMode.NONE) {
		return res
	}

	// Track the previous info for checking how the timeline will be built
	let previousPart: Part | undefined
	if (playoutData.previousPartInstance) {
		previousPart = playoutData.previousPartInstance.part
	}

	// Get the PieceInstances which are on the timeline
	const partInstancesOnTimeline = _.compact([
		playoutData.currentPartInstance,
		playoutData.nextPartInstance
	])
	// Generate timed objects for parts on the timeline
	_.each(partInstancesOnTimeline, partInstance => {
		const pieces = _.filter(playoutData.selectedInstancePieces, (pieceInstance: PieceInstance) => {
			return !!(
				pieceInstance.partInstanceId === partInstance._id &&
				pieceInstance.piece.content &&
				pieceInstance.piece.content.timelineObjects &&
				_.find(pieceInstance.piece.content.timelineObjects, (o) => (o && o.layer === layer))
			)
		})

		const newObjs = findObjectsForPart(playoutData.rundownPlaylist.currentPartInstanceId, layer, previousPart, partInstance.part, pieces.map(p => p.piece), partInstance)
		const isAutonext = playoutData.currentPartInstance && playoutData.currentPartInstance.part.autoNext
		if (playoutData.rundownPlaylist.nextPartInstanceId === partInstance._id && !isAutonext) {
			// The next instance should be future objects if not in an autonext
			newObjs.forEach(o => res.future.push({ obj: o, partId: partInstance.part._id }))
		} else {
			newObjs.forEach(o => res.timed.push({ obj: o, partId: partInstance.part._id }))
		}
		previousPart = partInstance.part
	})

	// Ensure we havent reached enough already
	if (res.future.length >= lookaheadDepth) {
		return res
	}
	
	// There are no future parts, so this will not find anything more
	if (futureParts.length === 0) {
		return res
	}
	const futurePartIds = _.map(futureParts, part => part._id)

	// find enough pieces that touch the layer
	const rundownIds = Object.keys(playoutData.rundownsMap).map(id => protectString<RundownId>(id))
	const piecesUsingLayer: Array<Pick<Piece, 'startPartId'>> = Pieces.find({
		invalid: { $ne: true },
		'content.timelineObjects.layer': layer,
		startRundownId: { $in: rundownIds },
		startPartId: { $in: futurePartIds }
	}, {
		limit: lookaheadDepth * 2, // TODO - is this enough because some could be dropped due to being transitions?
		fields: {
			startPartId: 1
		}
	}).fetch()

	if (piecesUsingLayer.length === 0) {
		// No instances of layer
		return res
	}

	// We need all the pieces from those parts..
	const possiblePartIds = _.uniq(_.map(piecesUsingLayer, piece => piece.startPartId))
	const allPiecesFromParts = Pieces.find({
		invalid: { $ne: true },
		startRundownId: { $in: rundownIds },
		startPartId: { $in: possiblePartIds }
	}).fetch()
	const piecesUsingLayerByPart = _.groupBy(allPiecesFromParts, piece => piece.startPartId)

	for (const part of futureParts) {
		// Stop if we have enough objects already
		if (res.future.length >= lookaheadDepth) {
			break
		}

		const pieces = piecesUsingLayerByPart[unprotectString(part._id)] || []
		if (pieces.length > 0 && part.isPlayable()) {
			findObjectsForPart(playoutData.rundownPlaylist.currentPartInstanceId, layer, previousPart, part, pieces, null)
				.forEach(o => res.future.push({ obj: o, partId: part._id }))
		}
		previousPart = part
	}

	return res
}

export function findObjectsForPart (
	currentPartInstanceId: PartInstanceId | null,
	layer: string,
	previousPart: Part | undefined,
	part: Part,
	pieces: PieceInstancePiece[],
	partInstance: PartInstance | null,
): (TimelineObjRundown & OnGenerateTimelineObj)[] {

	// Sanity check, if no part to search, then abort
	if (!part || !pieces || pieces.length === 0) {
		return []
	}

	let allObjs: TimelineObjRundown[] = []
	pieces.forEach(piece => {
		if (piece.content && piece.content.timelineObjects) {
			// Calculate the pieceInstanceId or fallback to the pieceId. This is ok, as its only for lookahead
			const pieceInstanceId = partInstance ? rewrapPieceToInstance(piece, partInstance.rundownId, partInstance._id)._id : piece._id

			_.each(piece.content.timelineObjects, (obj) => {
				if (obj) {
					fixTimelineId(obj)
					allObjs.push(literal<TimelineObjRundown & OnGenerateTimelineObj>({
						...obj,
						_id: protectString(''), // set later
						studioId: protectString(''), // set later
						objectType: TimelineObjType.RUNDOWN,
						pieceInstanceId: unprotectString(pieceInstanceId),
						infinitePieceId: unprotectString(piece.infiniteId)
					}))
				}
			})
		}
	})
	// let allObjs: TimelineObjRundown[] = _.compact(rawObjs)

	if (allObjs.length === 0) {
		// Should never happen. suggests something got 'corrupt' during this process
		return []
	} else if (allObjs.length === 1) {
		// Only one, just return it
		return allObjs
	} else { // They need to be ordered
		// TODO - this needs to consider infinites properly... In what way?
		const orderedPieces = sortPiecesByStart(pieces)

		let allowTransition = false
		let classesFromPreviousPart: string[] = []
		if (previousPart && currentPartInstanceId) { // If we have a previous and not at the start of the rundown
			allowTransition = !previousPart.disableOutTransition
			classesFromPreviousPart = previousPart.classesForNext || []
		}

		const transObj = orderedPieces.find(i => !!i.isTransition)
		const transObj2 = transObj ? pieces.find(l => l._id === transObj._id) : undefined
		const hasTransition = (
			allowTransition &&
			transObj2 &&
			transObj2.content &&
			transObj2.content.timelineObjects &&
			transObj2.content.timelineObjects.find(o => o != null && o.layer === layer)
		)

		const res: TimelineObjRundown[] = []
		orderedPieces.forEach(piece => {
			if (!part || (!allowTransition && piece.isTransition)) {
				return
			}
			if (!piece.content || !piece.content.timelineObjects) {
				return
			}

			// If there is a transition and this piece is abs0, it is assumed to be the primary piece and so does not need lookahead
			if (
				hasTransition &&
				!piece.isTransition &&
				piece.enable.start === 0 // <-- need to discuss this!
			) {
				return
			}

			// Note: This is assuming that there is only one use of a layer in each piece.
			const obj = piece.content.timelineObjects.find(o => o !== null && o.layer === layer)
			if (obj) {
				// Try and find a keyframe that is used when in a transition
				let transitionKF: TimelineTypes.TimelineKeyframe | undefined = undefined
				if (allowTransition) {
					transitionKF = _.find(obj.keyframes || [], kf => kf.enable.while === '.is_transition')

					// TODO - this keyframe matching is a hack, and is very fragile

					if (!transitionKF && classesFromPreviousPart && classesFromPreviousPart.length > 0) {
						// Check if the keyframe also uses a class to match. This handles a specific edge case
						transitionKF = _.find(obj.keyframes || [], kf => _.any(classesFromPreviousPart, cl => kf.enable.while === `.is_transition & .${cl}`))
					}
				}
				const newContent = Object.assign({}, obj.content, transitionKF ? transitionKF.content : {})

				// Calculate the pieceInstanceId or fallback to the pieceId. This is ok, as its only for lookahead
				const pieceInstanceId = partInstance ? rewrapPieceToInstance(piece, partInstance.rundownId, partInstance._id)._id : piece._id

				res.push(literal<TimelineObjRundown & OnGenerateTimelineObj>({
					...obj,
					_id: protectString(''), // set later
					studioId: protectString(''), // set later
					objectType: TimelineObjType.RUNDOWN,
					pieceInstanceId: unprotectString(pieceInstanceId),
					infinitePieceId: unprotectString(piece.infiniteId),
					content: newContent
				}))
			}
		})
		return res
	}
}
