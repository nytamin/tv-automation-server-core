import { Meteor } from 'meteor/meteor'
import { check } from 'meteor/check'
import { waitForPromiseAll, getCurrentTime, waitForPromise, asyncCollectionUpsert, protectString, clone, literal, asyncCollectionUpdate, unprotectObjectArray, unprotectString, asyncCollectionRemove, makePromise, asyncCollectionInsert, getRandomId, normalizeArray } from "../../../lib/lib";
import { PartInstances, PartInstance } from "../../../lib/collections/PartInstances";
import { Parts, Part } from "../../../lib/collections/Parts";
import { logger } from "../../logging";
import { PartEventContext, RundownContext } from "../blueprints/context";
import { VTContent, PartEndState, PieceLifespan } from "tv-automation-sofie-blueprints-integration";
import { PieceInstances, PieceInstance, PieceInstanceId, PieceInstancePiece } from "../../../lib/collections/PieceInstances";
import { Pieces, PieceId, Piece } from "../../../lib/collections/Pieces";
import { RundownHoldState, Rundown, Rundowns } from "../../../lib/collections/Rundowns";
import { RundownPlaylist, RundownPlaylists, RundownPlaylistId } from "../../../lib/collections/RundownPlaylists";
import { updateTimeline } from "./timeline";
import { ClientAPI } from "../../../lib/api/client";
import { getBlueprintOfRundown } from "../blueprints/cache";
import { rundownPlaylistSyncFunction, RundownSyncFunctionPriority } from "../ingest/rundownInput";
import { getResolvedPieces } from "./pieces";
import {
	resetRundownPlaylist as libResetRundownPlaylist,
	setNextPart as libSetNextPart,
	onPartHasStoppedPlaying,
	getPartBeforeSegment,
	selectNextPart,
	isTooCloseToAutonext
} from './lib'
import { IngestActions } from "../ingest/actions";
import * as _ from 'underscore'
import { StudioId } from '../../../lib/collections/Studios';

function completeHold(playlist: RundownPlaylist, currentPartInstance: PartInstance | undefined | null) {
	const ps: Promise<any>[] = []
	ps.push(asyncCollectionUpdate(RundownPlaylists, playlist._id, {
		$set: {
			holdState: RundownHoldState.COMPLETE
		}
	}))

	if (currentPartInstance) {
		const extendedPieceInstances = PieceInstances.find({
			partInstanceId: currentPartInstance._id,
			'piece.extendOnHold': true,
			'infinite': { $exists: true }
		}).fetch()

		_.each(extendedPieceInstances, pieceInstance => {
			if (pieceInstance.infinite && pieceInstance.piece.startPartId !== currentPartInstance.part._id) {
				// This is a continuation, so give it an end
				ps.push(asyncCollectionUpdate(PieceInstances, pieceInstance._id, {
					$set: {
						// TODO - is this correct (both field and value)
						'piece.userDuration.end': getCurrentTime()
					}
				}))
			}
		})
	}
	waitForPromiseAll(ps)

	updateTimeline(playlist.studioId)
}

function startHold(previousPartInstance: PartInstance, currentPartInstance: PartInstance) {
	const ps: Array<Promise<any>> = []

	// Make a copy of any item which is flagged as an 'infinite' extension
	const itemsToCopy = previousPartInstance.getAllPieceInstances().filter(i => i.piece.extendOnHold)
	itemsToCopy.forEach(instance => {
		// Update the original to be an infinite
		ps.push(asyncCollectionUpdate(PieceInstances, instance._id, {
			$set: {
				infinite: {
					infinitePieceId: instance.piece._id,
					fromHold: true
				}
			}
		}))

		// make the extension
		const newPiece: PieceInstancePiece = clone(instance.piece)
		// Hack to continue playback of a copied clip
		const contentTmp = newPiece.content as VTContent
		if (contentTmp.fileName && contentTmp.sourceDuration && instance.piece.startedPlayback) {
			contentTmp.seek = Math.min(contentTmp.sourceDuration, getCurrentTime() - instance.piece.startedPlayback)
		}
		const newInstance = literal<PieceInstance>({
			_id: protectString<PieceInstanceId>(instance._id + '_hold'),
			rundownId: instance.rundownId,
			partInstanceId: currentPartInstance._id,
			piece: newPiece,
			infinite: {
				infinitePieceId: instance.piece._id,
				fromHold: true
			}
		})

		// This gets deleted once the nextpart is activated, so it doesnt linger for long
		ps.push(asyncCollectionInsert(PieceInstances, newInstance))
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
		// let rundownData = playlist.fetchAllPlayoutData()

		const allRundowns = playlist.getRundownsMap()

		let { currentPartInstance, nextPartInstance, previousPartInstance } = playlist.getSelectedPartInstances()
		const partInstance = currentPartInstance || nextPartInstance
		const currentRundown = partInstance ? allRundowns[unprotectString(partInstance.rundownId)] : undefined
		if (!currentRundown) throw new Meteor.Error(404, `Rundown "${partInstance && partInstance.rundownId || ''}" could not be found!`)

		const pBlueprint = makePromise(() => getBlueprintOfRundown(currentRundown))

		if (currentPartInstance) {
			const allowTransition = previousPartInstance && !previousPartInstance.part.disableOutTransition
			const start = currentPartInstance.part.getLastStartedPlayback()

			// If there was a transition from the previous Part, then ensure that has finished before another take is permitted
			if (allowTransition && currentPartInstance.part.transitionDuration && start && now < start + currentPartInstance.part.transitionDuration) {
				return ClientAPI.responseError('Cannot take during a transition')
			}

			if (isTooCloseToAutonext(currentPartInstance, true)) {
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
			completeHold(playlist, currentPartInstance)
			return ClientAPI.responseSuccess(undefined)
		}

		previousPartInstance = currentPartInstance || undefined
		let takePartInstance = nextPartInstance
		if (!takePartInstance) throw new Meteor.Error(404, 'takePart not found!')
		const takeRundown: Rundown | undefined = allRundowns[unprotectString(takePartInstance.rundownId)]
		if (!takeRundown) throw new Meteor.Error(500, `takeRundown: takeRundown not found! ("${takePartInstance.rundownId}")`)
		// let takeSegment = rundownData.segmentsMap[takePart.segmentId]

		const orderedParts = playlist.getAllOrderedParts()
		const nextPart = selectNextPart(takePartInstance, orderedParts)

		copyOverflowingPieces(orderedParts, previousPartInstance || null, takePartInstance)

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
			if (previousPartInstance) {
				ps.push(asyncCollectionUpdate(Parts, previousPartInstance.part._id, {
					$push: {
						'timings.takeOut': now,
					}
				}))
			}
		}

		waitForPromiseAll(ps)

		// Once everything is synced, we can choose the next part
		libSetNextPart(playlist, nextPart ? nextPart.part : null)

		// Setup the parts for the HOLD we are starting
		if (previousPartInstance && m.holdState === RundownHoldState.ACTIVE) {
			startHold(previousPartInstance, takePartInstance)
		}

		afterTake(playlist.studioId, takePartInstance, timeOffset)

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


function copyOverflowingPieces (orderedParts: Part[], currentPartInstance: PartInstance | null, nextPartInstance: PartInstance) {
	if (currentPartInstance) {
		const adjacentPart = _.find(orderedParts, (part) => {
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

				// TODO - won't this need some help seeking if a clip?

				if (remainingDuration > 0) {
					// Clone an overflowing piece
					let overflowedItem = literal<PieceInstance>({
						_id: protectString(`${instance._id}_overflow`),
						rundownId: instance.rundownId,
						partInstanceId: nextPartInstance._id,
						piece: {
							..._.omit(instance.piece, 'startedPlayback', 'duration', 'overflows'),
							_id: getRandomId(),
							startPartId: nextPartInstance.part._id,
							enable: {
								start: 0,
								duration: remainingDuration,
							},
							dynamicallyInserted: true,
							continuesRefId: instance.piece._id,
						}
					})

					ps.push(asyncCollectionInsert(PieceInstances, overflowedItem))
				}
			}
		})
		waitForPromiseAll(ps)
	}
}

export function afterTake (
	studioId: StudioId,
	takePartInstance: PartInstance,
	timeOffset: number | null = null
) {
	// This function should be called at the end of a "take" event (when the Parts have been updated)

	let forceNowTime: number | undefined = undefined
	if (timeOffset) {
		forceNowTime = getCurrentTime() - timeOffset
	}
	// or after a new part has started playing
	updateTimeline(studioId, forceNowTime)

	if (takePartInstance.part.shouldNotifyCurrentPlayingPart) {
		const takeRundown = Rundowns.findOne(takePartInstance.rundownId) as Rundown
		if (!takeRundown) throw new Meteor.Error(404, `Unable to find Rundown "${takePartInstance.rundownId}"`)

		// defer these so that the playout gateway has the chance to learn about the changes
		Meteor.setTimeout(() => {
			IngestActions.notifyCurrentPlayingPart(takeRundown, takePartInstance.part)
		}, 40)
	}
}
