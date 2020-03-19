import { Meteor } from 'meteor/meteor'
import { check } from 'meteor/check'
import { waitForPromiseAll, getCurrentTime, waitForPromise, asyncCollectionUpsert, protectString, clone, literal, asyncCollectionUpdate, unprotectObjectArray, unprotectString, asyncCollectionRemove, makePromise, asyncCollectionInsert, getRandomId } from "../../../lib/lib";
import { PartInstances, PartInstance } from "../../../lib/collections/PartInstances";
import { Parts, Part } from "../../../lib/collections/Parts";
import { logger } from "../../logging";
import { PartEventContext, RundownContext } from "../blueprints/context";
import { VTContent, PartEndState } from "tv-automation-sofie-blueprints-integration";
import { PieceInstances, PieceInstance, PieceInstanceId } from "../../../lib/collections/PieceInstances";
import { Pieces, PieceId, Piece } from "../../../lib/collections/Pieces";
import { RundownHoldState, Rundown } from "../../../lib/collections/Rundowns";
import { RundownPlaylist, RundownPlaylists, RundownPlaylistId, RundownPlaylistPlayoutData } from "../../../lib/collections/RundownPlaylists";
import { updateTimeline } from "./timeline";
import { ClientAPI } from "../../../lib/api/client";
import { getBlueprintOfRundown } from "../blueprints/cache";
import { rundownPlaylistSyncFunction, RundownSyncFunctionPriority } from "../ingest/rundownInput";
import { getResolvedPieces } from "./pieces";
import {
	resetRundownPlaylist as libResetRundownPlaylist,
	setNextPart as libSetNextPart,
	onPartHasStoppedPlaying,
	refreshPart,
	getPartBeforeSegment,
	selectNextPart,
	isTooCloseToAutonext
} from './lib'
import { IngestActions } from "../ingest/actions";
import * as _ from 'underscore'

function completeHold(playlist: RundownPlaylist, rundownData: RundownPlaylistPlayoutData) {
	const ps: Promise<any>[] = []
	ps.push(asyncCollectionUpdate(RundownPlaylists, playlist._id, {
		$set: {
			holdState: RundownHoldState.COMPLETE
		}
	}))

	if (playlist.currentPartInstanceId) {
		const currentPartInstance = rundownData.currentPartInstance
		if (!currentPartInstance) throw new Meteor.Error(404, 'currentPart not found!')

		// Remove the current extension line
		ps.push(asyncCollectionRemove(PieceInstances, {
			partInstanceId: currentPartInstance._id,
			'piece.extendOnHold': true,
			'piece.dynamicallyInserted': true
		}))
		// TODO-PartInstance - pending new data flow
		ps.push(asyncCollectionRemove(Pieces, {
			startPartId: currentPartInstance.part._id,
			extendOnHold: true,
			dynamicallyInserted: true
		}))
	}
	if (!playlist.previousPartInstanceId) {
		const previousPartInstance = rundownData.previousPartInstance
		if (!previousPartInstance) throw new Meteor.Error(404, 'previousPart not found!')

		// Clear the extended mark on the original
		ps.push(asyncCollectionUpdate(PieceInstances, {
			partInstanceId: previousPartInstance._id,
			'piece.extendOnHold': true,
			'piece.dynamicallyInserted': false
		}, {
			$unset: {
				'piece.infiniteId': 0,
				'piece.infiniteMode': 0,
			}
		}, { multi: true }))
		// TODO-PartInstance - pending new data flow
		ps.push(asyncCollectionUpdate(Pieces, {
			startPartId: previousPartInstance.part._id,
			extendOnHold: true,
			dynamicallyInserted: false
		}, {
			$unset: {
				infiniteId: 0,
				infiniteMode: 0,
			}
		}, { multi: true }))
	}
	waitForPromiseAll(ps)

	updateTimeline(playlist.studioId)
}

function startHold(rundownData: RundownPlaylistPlayoutData) {
	const ps: Array<Promise<any>> = []

	const previousPartInstance = rundownData.previousPartInstance
	if (!previousPartInstance) throw new Meteor.Error(404, 'previousPart not found!')
	const currentPartInstance = rundownData.currentPartInstance
	if (!currentPartInstance) throw new Meteor.Error(404, 'currentPart not found!')

	// Make a copy of any item which is flagged as an 'infinite' extension
	const itemsToCopy = previousPartInstance.getAllPieceInstances().filter(i => i.piece.extendOnHold)
	itemsToCopy.forEach(instance => {
		// TODO-PartInstance - temporary mutate existing piece, pending new data flow
		const rawPiece = rundownData.pieces.find(p => p._id === instance.piece._id)
		if (rawPiece) {
			// TODO
			// rawPiece.infiniteId = rawPiece._id
			// rawPiece.infiniteMode = PieceLifespan.OutOnNextPart
			// ps.push(asyncCollectionUpdate(Pieces, rawPiece._id, {
			// 	$set: {
			// 		infiniteMode: PieceLifespan.OutOnNextPart,
			// 		infiniteId: rawPiece._id,
			// 	}
			// }))
		}

		// mark current one as infinite
		// TODO
		// instance.piece.infiniteId = instance.piece._id
		// instance.piece.infiniteMode = PieceLifespan.OutOnNextPart
		// ps.push(asyncCollectionUpdate(PieceInstances, instance._id, {
		// 	$set: {
		// 		'piece.infiniteMode': PieceLifespan.OutOnNextPart,
		// 		'piece.infiniteId': instance.piece._id,
		// 	}
		// }))

		// TODO-PartInstance - temporary piece extension, pending new data flow
		const newPieceTmp: Piece = clone(instance.piece)
		newPieceTmp.startPartId = currentPartInstance.part._id
		newPieceTmp.startPartRank = currentPartInstance.part._rank
		newPieceTmp.enable = { start: 0 }
		const contentTmp = newPieceTmp.content as VTContent
		if (contentTmp.fileName && contentTmp.sourceDuration && instance.piece.startedPlayback) {
			contentTmp.seek = Math.min(contentTmp.sourceDuration, getCurrentTime() - instance.piece.startedPlayback)
		}
		newPieceTmp.dynamicallyInserted = true
		newPieceTmp._id = protectString(instance.piece._id + '_hold')

		// This gets deleted once the nextpart is activated, so it doesnt linger for long
		ps.push(asyncCollectionUpsert(Pieces, newPieceTmp._id, newPieceTmp))
		rundownData.pieces.push(newPieceTmp) // update the local collection

		// make the extension
		const newInstance = literal<PieceInstance>({
			_id: protectString<PieceInstanceId>(instance._id + '_hold'),
			rundownId: instance.rundownId,
			partInstanceId: currentPartInstance._id,
			piece: {
				...clone(instance.piece),
				_id: newPieceTmp._id,
				startPartId: currentPartInstance.part._id,
				startPartRank: currentPartInstance.part._rank,
				enable: { start: 0 },
				dynamicallyInserted: true
			}
		})
		const content = newInstance.piece.content as VTContent | undefined
		if (content && content.fileName && content.sourceDuration && instance.piece.startedPlayback) {
			content.seek = Math.min(content.sourceDuration, getCurrentTime() - instance.piece.startedPlayback)
		}

		// This gets deleted once the nextpart is activated, so it doesnt linger for long
		ps.push(asyncCollectionUpsert(PieceInstances, newInstance._id, newInstance))
		rundownData.selectedInstancePieces.push(newInstance) // update the local collection
	})

	waitForPromiseAll(ps)
}

export function takeNextPartInner (rundownPlaylistId: RundownPlaylistId): ClientAPI.ClientResponse<void> {
	check(rundownPlaylistId, String)
	const now = getCurrentTime()

	return rundownPlaylistSyncFunction(rundownPlaylistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
		let playlist = RundownPlaylists.findOne(rundownPlaylistId)
		if (!playlist) throw new Meteor.Error(404, `RundownPlaylist "${rundownPlaylistId}" not found!`)
		if (!playlist.active) throw new Meteor.Error(501, `RundownPlaylist "${rundownPlaylistId}" is not active!`)
		if (!playlist.nextPartInstanceId) throw new Meteor.Error(500, 'nextPartInstanceId is not set!')

		const timeOffset: number | null = playlist.nextTimeOffset || null

		const isFirstTakeOfPlaylist = !playlist.startedPlayback
		let rundownData = playlist.fetchAllPlayoutData()

		const partInstance = rundownData.currentPartInstance || rundownData.nextPartInstance
		const currentRundown = partInstance ? rundownData.rundownsMap[unprotectString(partInstance.rundownId)] : undefined
		if (!currentRundown) throw new Meteor.Error(404, `Rundown "${partInstance && partInstance.rundownId || ''}" could not be found!`)

		const pBlueprint = makePromise(() => getBlueprintOfRundown(currentRundown))

		const currentPart = rundownData.currentPartInstance
		if (currentPart) {
			const prevPart = rundownData.previousPartInstance
			const allowTransition = prevPart && !prevPart.part.disableOutTransition
			const start = currentPart.part.getLastStartedPlayback()

			// If there was a transition from the previous Part, then ensure that has finished before another take is permitted
			if (allowTransition && currentPart.part.transitionDuration && start && now < start + currentPart.part.transitionDuration) {
				return ClientAPI.responseError('Cannot take during a transition')
			}

			if (isTooCloseToAutonext(currentPart, true)) {
				return ClientAPI.responseError('Cannot take shortly before an autoTake')
			}
		}

		if (playlist.holdState === RundownHoldState.COMPLETE) {
			RundownPlaylists.update(playlist._id, {
				$set: {
					holdState: RundownHoldState.NONE
				}
			})
		// If hold is active, then this take is to clear it
		} else if (playlist.holdState === RundownHoldState.ACTIVE) {
			completeHold(playlist, rundownData)
			return ClientAPI.responseSuccess(undefined)
		}

		let previousPartInstance = rundownData.currentPartInstance || null
		let takePartInstance = rundownData.nextPartInstance
		if (!takePartInstance) throw new Meteor.Error(404, 'takePart not found!')
		const takeRundown: Rundown | undefined = rundownData.rundownsMap[unprotectString(takePartInstance.rundownId)]
		if (!takeRundown) throw new Meteor.Error(500, `takeRundown: takeRundown not found! ("${takePartInstance.rundownId}")`)
		// let takeSegment = rundownData.segmentsMap[takePart.segmentId]
		const nextPart = selectNextPart(takePartInstance, rundownData.parts)

		copyOverflowingPieces(rundownData, previousPartInstance || null, takePartInstance)

		const { blueprint } = waitForPromise(pBlueprint)
		if (blueprint.onPreTake) {
			try {
				waitForPromise(
					Promise.resolve(blueprint.onPreTake(new PartEventContext(takeRundown, undefined, takePartInstance)))
					.catch(logger.error)
				)
			} catch (e) {
				logger.error(e)
			}
		}
		// TODO - the state could change after this sampling point. This should be handled properly
		let previousPartEndState: PartEndState | undefined = undefined
		if (blueprint.getEndStateForPart && previousPartInstance) {
			const time = getCurrentTime()
			const resolvedPieces = getResolvedPieces(previousPartInstance)

			const context = new RundownContext(takeRundown, undefined)
			previousPartEndState = blueprint.getEndStateForPart(context, playlist.previousPersistentState, previousPartInstance.part.previousPartEndState, unprotectObjectArray(resolvedPieces), time)
			logger.info(`Calculated end state in ${getCurrentTime() - time}ms`)
		}
		let ps: Array<Promise<any>> = []
		let m: Partial<RundownPlaylist> = {
			previousPartInstanceId: playlist.currentPartInstanceId,
			currentPartInstanceId: takePartInstance._id,
			holdState: !playlist.holdState || playlist.holdState === RundownHoldState.COMPLETE ? RundownHoldState.NONE : playlist.holdState + 1,
		}
		ps.push(asyncCollectionUpdate(RundownPlaylists, playlist._id, {
			$set: m
		}))
		playlist = _.extend(playlist, m) as RundownPlaylist

		let partInstanceM: any = {
			$set: {
				isTaken: true,
				'part.taken': true
			},
			$unset: {} as { string: 0 | 1 },
			$push: {
				'part.timings.take': now,
				'part.timings.playOffset': timeOffset || 0
			}
		}
		let partM = {
			$set: {
				taken: true
			} as Partial<Part>,
			$unset: {} as { [key in keyof Part]: 0 | 1 },
			$push: {
				'timings.take': now,
				'timings.playOffset': timeOffset || 0
			}
		}
		if (previousPartEndState) {
			partInstanceM.$set['part.previousPartEndState'] = previousPartEndState
			partM.$set.previousPartEndState = previousPartEndState
		} else {
			partInstanceM.$unset['part.previousPartEndState'] = 1
			partM.$unset.previousPartEndState = 1
		}
		if (Object.keys(partM.$set).length === 0) delete partM.$set
		if (Object.keys(partM.$unset).length === 0) delete partM.$unset
		if (Object.keys(partInstanceM.$set).length === 0) delete partInstanceM.$set
		if (Object.keys(partInstanceM.$unset).length === 0) delete partInstanceM.$unset

		ps.push(asyncCollectionUpdate(PartInstances, takePartInstance._id, partInstanceM))
		// TODO-PartInstance - pending new data flow
		ps.push(asyncCollectionUpdate(Parts, takePartInstance.part._id, partM))

		if (m.previousPartInstanceId) {
			ps.push(asyncCollectionUpdate(PartInstances, m.previousPartInstanceId, {
				$push: {
					'part.timings.takeOut': now,
				}
			}))
			// TODO-PartInstance - pending new data flow
			if (rundownData.currentPartInstance) {
				ps.push(asyncCollectionUpdate(Parts, rundownData.currentPartInstance.part._id, {
					$push: {
						'timings.takeOut': now,
					}
				}))
			}
		}

		waitForPromiseAll(ps)

		// Once everything is synced, we can choose the next part
		libSetNextPart(playlist, nextPart ? nextPart.part : null)

		// update playoutData
		// const newSelectedPartInstances = playlist.getSelectedPartInstances()
		// rundownData = {
		// 	...rundownData,
		// 	...newSelectedPartInstances
		// }
		rundownData = playlist.fetchAllPlayoutData()

		// Setup the parts for the HOLD we are starting
		if (playlist.previousPartInstanceId && m.holdState === RundownHoldState.ACTIVE) {
			startHold(rundownData)
		}

		afterTake(rundownData, takePartInstance, timeOffset)

		// Last:
		const takeDoneTime = getCurrentTime()
		Meteor.defer(() => {
			if (takePartInstance) {
				PartInstances.update(takePartInstance._id, {
					$push: {
						'part.timings.takeDone': takeDoneTime
					}
				})
				Parts.update(takePartInstance.part._id, {
					$push: {
						'timings.takeDone': takeDoneTime
					}
				})
				// let bp = getBlueprintOfRundown(rundown)
				if (isFirstTakeOfPlaylist) {
					if (blueprint.onRundownFirstTake) {
						waitForPromise(
							Promise.resolve(blueprint.onRundownFirstTake(new PartEventContext(takeRundown, undefined, takePartInstance)))
							.catch(logger.error)
						)
					}
				}

				if (blueprint.onPostTake) {
					waitForPromise(
						Promise.resolve(blueprint.onPostTake(new PartEventContext(takeRundown, undefined, takePartInstance)))
						.catch(logger.error)
					)
				}
			}
		})

		return ClientAPI.responseSuccess(undefined)
	})
}


function copyOverflowingPieces (playoutData: RundownPlaylistPlayoutData, currentPartInstance: PartInstance | null, nextPartInstance: PartInstance) {
	// TODO-PartInstance - is this going to work? It needs some work to handle part data changes
	if (currentPartInstance) {
		const adjacentPart = _.find(playoutData.parts, (part) => {
			return (
				part.segmentId === currentPartInstance.segmentId &&
				part._rank > currentPartInstance.part._rank
			)
		})
		if (!adjacentPart || adjacentPart._id !== nextPartInstance.part._id) {
			// adjacent Part isn't the next part, do not overflow
			return
		}
		let ps: Array<Promise<any>> = []
		const currentPieces = currentPartInstance.getAllPieceInstances()
		currentPieces.forEach((instance) => {
			if (instance.piece.overflows && typeof instance.piece.enable.duration === 'number' && instance.piece.enable.duration > 0 && instance.piece.playoutDuration === undefined && instance.piece.userDuration === undefined) {
				// Subtract the amount played from the duration
				const remainingDuration = Math.max(0, instance.piece.enable.duration - ((instance.piece.startedPlayback || currentPartInstance.part.getLastStartedPlayback() || getCurrentTime()) - getCurrentTime()))

				if (remainingDuration > 0) {
					// Clone an overflowing piece
					let overflowedItem = literal<PieceInstance>({
						_id: getRandomId(),
						rundownId: instance.rundownId,
						partInstanceId: nextPartInstance._id,
						piece: {
							..._.omit(instance.piece, 'startedPlayback', 'duration', 'overflows'),
							_id: getRandomId(),
							startPartId: nextPartInstance.part._id,
							startPartRank: nextPartInstance.part._rank,
							enable: {
								start: 0,
								duration: remainingDuration,
							},
							dynamicallyInserted: true,
							continuesRefId: instance.piece._id,
						}
					})

					ps.push(asyncCollectionInsert(PieceInstances, overflowedItem))
					playoutData.selectedInstancePieces.push(overflowedItem) // update the cache

					// TODO-PartInstance - pending new data flow
					ps.push(asyncCollectionInsert(Pieces, overflowedItem.piece))
					playoutData.pieces.push(overflowedItem.piece) // update the cache
				}
			}
		})
		waitForPromiseAll(ps)
	}
}

export function afterTake (
	playoutData: RundownPlaylistPlayoutData,
	takePartInstance: PartInstance,
	timeOffset: number | null = null
) {
	// This function should be called at the end of a "take" event (when the Parts have been updated)

	let forceNowTime: number | undefined = undefined
	if (timeOffset) {
		forceNowTime = getCurrentTime() - timeOffset
	}
	// or after a new part has started playing
	updateTimeline(playoutData.rundownPlaylist.studioId, forceNowTime, playoutData)

	// defer these so that the playout gateway has the chance to learn about the changes
	Meteor.setTimeout(() => {
		if (takePartInstance.part.shouldNotifyCurrentPlayingPart) {
			const currentRundown = playoutData.rundownsMap[unprotectString(takePartInstance.rundownId)]
			IngestActions.notifyCurrentPlayingPart(currentRundown, takePartInstance.part)
		}
	}, 40)
}
