/* tslint:disable:no-use-before-declare */
import { Resolver, TimelineEnable } from 'superfly-timeline'
import * as _ from 'underscore'
import { DeepReadonly } from 'utility-types'
import { Piece } from '../../../lib/collections/Pieces'
import {
	literal,
	extendMandadory,
	getCurrentTime,
	clone,
	normalizeArray,
	protectString,
	unprotectString,
	omit,
	flatten,
	applyToArray,
} from '../../../lib/lib'
import {
	TimelineObjPieceAbstract,
	TimelineObjType,
	TimelineObjRundown,
	TimelineObjGeneric,
} from '../../../lib/collections/Timeline'
import { logger } from '../../logging'
import {
	getPieceFirstObjectId,
	TimelineObjectCoreExt,
	OnGenerateTimelineObj,
	TSR,
	PieceLifespan,
} from 'tv-automation-sofie-blueprints-integration'
import { transformTimeline, TimelineContentObject } from '../../../lib/timeline'
import { AdLibPiece } from '../../../lib/collections/AdLibPieces'
import { Random } from 'meteor/random'
import { prefixAllObjectIds, getSelectedPartInstancesFromCache } from './lib'
import { RundownPlaylist, RundownPlaylistId } from '../../../lib/collections/RundownPlaylists'
import { BucketAdLib } from '../../../lib/collections/BucketAdlibs'
import { PieceInstance, ResolvedPieceInstance, PieceInstancePiece } from '../../../lib/collections/PieceInstances'
import { PartInstance } from '../../../lib/collections/PartInstances'
import { CacheForRundownPlaylist } from '../../DatabaseCaches'
import { processAndPrunePieceInstanceTimings } from '../../../lib/rundown/infinites'
import { createPieceGroupAndCap } from '../../../lib/rundown/pieces'
import { ShowStyleBase } from '../../../lib/collections/ShowStyleBases'
import { profiler } from '../profiler'

function comparePieceStart<T extends PieceInstancePiece>(a: T, b: T, nowInPart: number): 0 | 1 | -1 {
	const aStart = a.enable.start === 'now' ? nowInPart : a.enable.start
	const bStart = b.enable.start === 'now' ? nowInPart : b.enable.start
	if (aStart < bStart) {
		return -1
	} else if (aStart > bStart) {
		return 1
	} else {
		// Transitions first
		if (a.isTransition && !b.isTransition) {
			return -1
		} else if (!a.isTransition && b.isTransition) {
			return 1
		} else if (a._id < b._id) {
			// Then go by id to make it consistent
			return -1
		} else if (a._id > b._id) {
			return 1
		} else {
			return 0
		}
	}
}

export function sortPieceInstancesByStart(pieces: PieceInstance[], nowInPart: number): PieceInstance[] {
	pieces.sort((a, b) => comparePieceStart(a.piece, b.piece, nowInPart))
	return pieces
}

export function sortPiecesByStart<T extends PieceInstancePiece>(pieces: T[]): T[] {
	pieces.sort((a, b) => comparePieceStart(a, b, 0))
	return pieces
}

export function createPieceGroupFirstObject(
	playlistId: RundownPlaylistId,
	pieceInstance: DeepReadonly<PieceInstance>,
	pieceGroup: TimelineObjRundown,
	firstObjClasses?: string[]
): TimelineObjPieceAbstract & OnGenerateTimelineObj {
	const firstObject = literal<TimelineObjPieceAbstract & OnGenerateTimelineObj>({
		id: getPieceFirstObjectId(unprotectString(pieceInstance.piece._id)),
		_id: protectString(''), // set later
		studioId: protectString(''), // set later
		pieceInstanceId: unprotectString(pieceInstance._id),
		infinitePieceId: unprotectString(pieceInstance.infinite?.infinitePieceId),
		objectType: TimelineObjType.RUNDOWN,
		enable: { start: 0 },
		layer: pieceInstance.piece.sourceLayerId + '_firstobject',
		content: {
			deviceType: TSR.DeviceType.ABSTRACT,
			type: 'callback',
			callBack: 'piecePlaybackStarted',
			callBackData: {
				rundownPlaylistId: playlistId,
				pieceInstanceId: pieceInstance._id,
				dynamicallyInserted: pieceInstance.dynamicallyInserted !== undefined,
			},
			callBackStopped: 'piecePlaybackStopped', // Will cause a callback to be called, when the object stops playing:
		},
		classes: firstObjClasses,
		inGroup: pieceGroup.id,
	})
	return firstObject
}

function resolvePieceTimeline(
	objs: TimelineContentObject[],
	baseTime: number,
	pieceInstanceMap: { [id: string]: PieceInstance | undefined },
	resolveForStr: string
): ResolvedPieceInstance[] {
	const tlResolved = Resolver.resolveTimeline(objs, { time: baseTime })
	const resolvedPieces: Array<ResolvedPieceInstance> = []

	let unresolvedIds: string[] = []
	_.each(tlResolved.objects, (obj0) => {
		const obj = (obj0 as any) as TimelineObjRundown
		const id = (obj.metaData || {}).pieceId

		if (!id) return

		const pieceInstance = pieceInstanceMap[id]
		// Erm... How?
		if (!pieceInstance) {
			unresolvedIds.push(id)
			return
		}

		if (obj0.resolved.resolved && obj0.resolved.instances && obj0.resolved.instances.length > 0) {
			const firstInstance = obj0.resolved.instances[0] || {}
			resolvedPieces.push(
				literal<ResolvedPieceInstance>({
					...pieceInstance,
					resolvedStart: firstInstance.start || baseTime,
					resolvedDuration: firstInstance.end
						? firstInstance.end - (firstInstance.start || baseTime)
						: undefined,
				})
			)
		} else {
			resolvedPieces.push(
				literal<ResolvedPieceInstance>({
					...pieceInstance,
					resolvedStart: baseTime,
					resolvedDuration: undefined,
				})
			)
			unresolvedIds.push(id)
		}
	})

	if (tlResolved.statistics.unresolvedCount > 0) {
		logger.warn(
			`Got ${tlResolved.statistics.unresolvedCount} unresolved pieces for ${resolveForStr} (${unresolvedIds.join(
				', '
			)})`
		)
	}
	if (_.size(pieceInstanceMap) !== resolvedPieces.length) {
		logger.warn(
			`Got ${resolvedPieces.length} ordered pieces. Expected ${_.size(pieceInstanceMap)}. for ${resolveForStr}`
		)
	}

	// Sort the pieces by time, then transitions first
	resolvedPieces.sort((a, b) => {
		if (a.resolvedStart < b.resolvedStart) {
			return -1
		} else if (a.resolvedStart > b.resolvedStart) {
			return 1
		} else {
			if (a.piece.isTransition === b.piece.isTransition) {
				return 0
			} else if (b.piece.isTransition) {
				return 1
			} else {
				return -1
			}
		}
	})

	// Clamp the times to be reasonably valid
	resolvedPieces.forEach((resolvedPiece) => {
		resolvedPiece.resolvedStart = Math.max(0, resolvedPiece.resolvedStart - 1)
		resolvedPiece.resolvedDuration = resolvedPiece.resolvedDuration
			? Math.max(0, resolvedPiece.resolvedDuration)
			: undefined
	})

	return resolvedPieces
}

export function getResolvedPieces(
	cache: CacheForRundownPlaylist,
	showStyleBase: ShowStyleBase,
	partInstance: PartInstance
): ResolvedPieceInstance[] {
	const span = profiler.startSpan('getResolvedPieces')
	const pieceInstances = cache.PieceInstances.findFetch({ partInstanceId: partInstance._id })

	const pieceInststanceMap = normalizeArray(pieceInstances, '_id')

	const now = getCurrentTime()
	const partStarted = partInstance.part.getLastStartedPlayback()
	const nowInPart = now - (partStarted ?? 0)

	const preprocessedPieces = processAndPrunePieceInstanceTimings(showStyleBase, pieceInstances, nowInPart)

	const objs = flatten(
		preprocessedPieces.map((piece) => {
			const r = createPieceGroupAndCap(piece)
			return [r.pieceGroup, ...r.capObjs]
		})
	)
	objs.forEach((o) => {
		applyToArray(o.enable, (enable) => {
			if (enable.start === 'now' && partStarted) {
				// Emulate playout starting now. TODO - ensure didnt break other uses
				enable.start = nowInPart
			} else if (enable.start === 0 || enable.start === 'now') {
				enable.start = 1
			}
		})
	})

	const resolvedPieces = resolvePieceTimeline(
		transformTimeline(objs),
		0,
		pieceInststanceMap,
		`PartInstance #${partInstance._id}`
	)

	if (span) span.end()
	return resolvedPieces
}
export function getResolvedPiecesFromFullTimeline(
	cache: CacheForRundownPlaylist,
	playlist: RundownPlaylist,
	allObjs: TimelineObjGeneric[]
): { pieces: ResolvedPieceInstance[]; time: number } {
	const span = profiler.startSpan('getResolvedPiecesFromFullTimeline')
	const objs = clone(
		allObjs.filter((o) => o.isGroup && ((o as any).isPartGroup || (o.metaData && o.metaData.pieceId)))
	)

	const now = getCurrentTime()

	const partInstanceIds = _.compact([playlist.previousPartInstanceId, playlist.currentPartInstanceId])
	const pieceInstances: PieceInstance[] = cache.PieceInstances.findFetch(
		(p) => partInstanceIds.indexOf(p.partInstanceId) !== -1
	)

	const { currentPartInstance } = getSelectedPartInstancesFromCache(cache, playlist) // todo: should these be passed as a parameter from getTimelineRundown?

	if (currentPartInstance && currentPartInstance.part.autoNext && playlist.nextPartInstanceId) {
		pieceInstances.push(...cache.PieceInstances.findFetch((p) => p.partInstanceId === playlist.nextPartInstanceId))
	}

	const replaceNows = (obj: TimelineContentObject, parentAbsoluteStart: number) => {
		let absoluteStart = parentAbsoluteStart

		applyToArray(obj.enable, (enable: TimelineEnable) => {
			if (enable.start === 'now') {
				// Start is always relative to parent start, so we need to factor that when flattening the 'now
				enable.start = Math.max(0, now - parentAbsoluteStart)
				absoluteStart = now
			} else if (typeof enable.start === 'number') {
				absoluteStart += enable.start
			} else {
				// We can't resolve this here, so lets hope there are no 'now' inside and end
				return
			}
		})

		// Ensure any children have their 'now's updated
		if (obj.isGroup && obj.children && obj.children.length) {
			obj.children.forEach((ch) => replaceNows(ch, absoluteStart))
		}
	}
	const transformedObjs = transformTimeline(objs)
	transformedObjs.forEach((o) => replaceNows(o, 0))

	const pieceInstanceMap = normalizeArray(pieceInstances, '_id')
	const resolvedPieces = resolvePieceTimeline(transformedObjs, now, pieceInstanceMap, 'timeline')

	if (span) span.end()
	return {
		pieces: resolvedPieces,
		time: now,
	}
}

export function convertPieceToAdLibPiece(piece: PieceInstancePiece): AdLibPiece {
	const span = profiler.startSpan('convertPieceToAdLibPiece')
	// const oldId = piece._id
	const newId = Random.id()
	const newAdLibPiece = literal<AdLibPiece>({
		...omit(piece, 'timings', 'startedPlayback', 'stoppedPlayback'),
		_id: protectString(newId),
		_rank: 0,
		expectedDuration: piece.enable.duration,
		rundownId: protectString(''),
	})

	if (newAdLibPiece.content && newAdLibPiece.content.timelineObjects) {
		let contentObjects = newAdLibPiece.content.timelineObjects
		const objs = prefixAllObjectIds(
			_.compact(
				_.map(contentObjects, (obj: TimelineObjectCoreExt) => {
					return extendMandadory<TimelineObjectCoreExt, TimelineObjGeneric>(obj, {
						_id: protectString(''), // set later
						studioId: protectString(''), // set later
						objectType: TimelineObjType.RUNDOWN,
					})
				})
			),
			newId + '_'
		)
		newAdLibPiece.content.timelineObjects = objs
	}

	if (span) span.end()
	return newAdLibPiece
}

export function convertAdLibToPieceInstance(
	adLibPiece: AdLibPiece | Piece | BucketAdLib | PieceInstancePiece,
	partInstance: PartInstance,
	queue: boolean
): PieceInstance {
	const span = profiler.startSpan('convertAdLibToPieceInstance')
	let duration: number | undefined = undefined
	if (adLibPiece['expectedDuration']) {
		duration = adLibPiece['expectedDuration']
	} else if (adLibPiece['enable'] && adLibPiece['enable'].duration) {
		duration = adLibPiece['enable'].duration
	}

	const newPieceId = Random.id()
	const newPieceInstance = literal<PieceInstance>({
		_id: protectString(`${partInstance._id}_${newPieceId}`),
		rundownId: partInstance.rundownId,
		partInstanceId: partInstance._id,
		adLibSourceId: adLibPiece._id,
		dynamicallyInserted: queue ? undefined : getCurrentTime(),
		piece: literal<PieceInstancePiece>({
			...(_.omit(
				adLibPiece,
				'_rank',
				'expectedDuration',
				'startedPlayback',
				'stoppedPlayback',
				'partId',
				'rundownId'
			) as PieceInstancePiece), // TODO - this could be typed stronger
			_id: protectString(newPieceId),
			startPartId: partInstance.part._id,
			enable: {
				start: queue ? 0 : 'now',
				duration: !queue && adLibPiece.lifespan === PieceLifespan.WithinPart ? duration : undefined,
			},
			timings: {
				take: [getCurrentTime()],
				startedPlayback: [],
				next: [],
				stoppedPlayback: [],
				playOffset: [],
				takeDone: [],
				takeOut: [],
			},
		}),
	})

	if (newPieceInstance.piece.lifespan !== PieceLifespan.WithinPart) {
		// Set it up as an infinite
		newPieceInstance.infinite = {
			infinitePieceId: newPieceInstance.piece._id,
			fromPreviousPart: false,
		}
	}

	if (newPieceInstance.piece.content && newPieceInstance.piece.content.timelineObjects) {
		let contentObjects = newPieceInstance.piece.content.timelineObjects
		const objs = prefixAllObjectIds(
			_.compact(
				_.map(contentObjects, (obj) => {
					return extendMandadory<TimelineObjectCoreExt, TimelineObjGeneric>(obj, {
						_id: protectString(''), // set later
						studioId: protectString(''), // set later
						objectType: TimelineObjType.RUNDOWN,
					})
				})
			),
			newPieceId + '_'
		)
		newPieceInstance.piece.content.timelineObjects = objs
	}

	if (span) span.end()
	return newPieceInstance
}
