
/* tslint:disable:no-use-before-declare */
import { Meteor } from 'meteor/meteor'
import { check } from 'meteor/check'
import { Rundowns, Rundown, RundownHoldState, RundownId } from '../../../lib/collections/Rundowns'
import { Part, Parts, DBPart, PartId } from '../../../lib/collections/Parts'
import { Piece, Pieces, PieceId } from '../../../lib/collections/Pieces'
import { getCurrentTime,
	Time,
	fetchNext,
	asyncCollectionUpdate,
	waitForPromiseAll,
	asyncCollectionInsert,
	asyncCollectionUpsert,
	waitForPromise,
	makePromise,
	clone,
	literal,
	asyncCollectionRemove,
	normalizeArray,
	unprotectString,
	unprotectObjectArray,
	protectString,
	isStringOrProtectedString,
	getRandomId} from '../../../lib/lib'
import { Timeline, TimelineObjGeneric, TimelineObjId } from '../../../lib/collections/Timeline'
import { Segments, Segment, SegmentId } from '../../../lib/collections/Segments'
import { Random } from 'meteor/random'
import * as _ from 'underscore'
import { logger } from '../../logging'
import {
	PartHoldMode,
	VTContent,
	PartEndState
} from 'tv-automation-sofie-blueprints-integration'
import { Studios, StudioId } from '../../../lib/collections/Studios'
import { getResolvedSegment, ISourceLayerExtended } from '../../../lib/Rundown'
import { ClientAPI } from '../../../lib/api/client'
import {
	reportRundownHasStarted,
	reportPartHasStarted,
	reportPieceHasStarted,
	reportPartHasStopped,
	reportPieceHasStopped
} from '../asRunLog'
import { Blueprints } from '../../../lib/collections/Blueprints'
import { RundownPlaylist, RundownPlaylists, RundownPlaylistPlayoutData, RundownPlaylistId } from '../../../lib/collections/RundownPlaylists'
import { getBlueprintOfRundown } from '../blueprints/cache'
import { PartEventContext, RundownContext } from '../blueprints/context'
import { IngestActions } from '../ingest/actions'
import { updateTimeline } from './timeline'
import {
	resetRundownPlaylist as libResetRundownPlaylist,
	setNextPart as libSetNextPart,
	onPartHasStoppedPlaying,
	refreshPart,
	getPartBeforeSegment,
	selectNextPart,
	isTooCloseToAutonext
} from './lib'
import {
	prepareStudioForBroadcast,
	activateRundownPlaylist as libActivateRundownPlaylist,
	deactivateRundownPlaylist as libDeactivateRundownPlaylist,
	deactivateRundownPlaylistInner
} from './actions'
import { PieceResolved, getResolvedPieces, convertAdLibToPieceInstance, convertPieceToAdLibPiece, sortPiecesByStart } from './pieces'
import { PackageInfo } from '../../coreSystem'
import { areThereActiveRundownPlaylistsInStudio } from './studio'
import { updateSourceLayerInfinitesAfterPart } from './infinites'
import { rundownPlaylistSyncFunction, RundownSyncFunctionPriority } from '../ingest/rundownInput'
import { ServerPlayoutAdLibAPI } from './adlib'
import { PieceInstances, PieceInstance, PieceInstanceId } from '../../../lib/collections/PieceInstances'
import { PartInstances, PartInstance, PartInstanceId } from '../../../lib/collections/PartInstances'
import { ReloadRundownPlaylistResponse } from '../../../lib/api/userActions'
import { takeNextPartInner, afterTake } from './take';

/**
 * debounce time in ms before we accept another report of "Part started playing that was not selected by core"
 */
const INCORRECT_PLAYING_PART_DEBOUNCE = 5000

export namespace ServerPlayoutAPI {
	/**
	 * Prepare the rundown for transmission
	 * To be triggered well before the broadcast, since it may take time and cause outputs to flicker
	 */
	export function prepareRundownPlaylistForBroadcast (rundownPlaylistId: RundownPlaylistId) {
		return rundownPlaylistSyncFunction(rundownPlaylistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			const playlist = RundownPlaylists.findOne(rundownPlaylistId)
			if (!playlist) throw new Meteor.Error(404, `Rundown Playlist "${rundownPlaylistId}" not found!`)
			if (playlist.active) throw new Meteor.Error(404, `rundownPrepareForBroadcast cannot be run on an active rundown!`)

			const anyOtherActiveRundowns = areThereActiveRundownPlaylistsInStudio(playlist.studioId, playlist._id)
			if (anyOtherActiveRundowns.length) {
				// logger.warn('Only one rundown can be active at the same time. Active rundowns: ' + _.map(anyOtherActiveRundowns, rundown => rundown._id))
				throw new Meteor.Error(409, 'Only one rundown can be active at the same time. Active rundowns: ' + _.map(anyOtherActiveRundowns, rundown => rundown._id))
			}

			libResetRundownPlaylist(playlist)
			prepareStudioForBroadcast(playlist.getStudio())

			return libActivateRundownPlaylist(playlist, true) // Activate rundownPlaylist (rehearsal)
		})
	}
	/**
	 * Reset the broadcast, to be used during testing.
	 * The User might have run through the rundown and wants to start over and try again
	 */
	export function resetRundownPlaylist (rundownPlaylistId: RundownPlaylistId): void {
		return rundownPlaylistSyncFunction(rundownPlaylistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			const playlist = RundownPlaylists.findOne(rundownPlaylistId)
			if (!playlist) throw new Meteor.Error(404, `Rundown Playlist "${rundownPlaylistId}" not found!`)
			if (playlist.active && !playlist.rehearsal) throw new Meteor.Error(401, `resetRundown can only be run in rehearsal!`)

			libResetRundownPlaylist(playlist)

			updateTimeline(playlist.studioId)
		})
	}
	/**
	 * Activate the rundown, final preparations before going on air
	 * To be triggered by the User a short while before going on air
	 */
	export function resetAndActivateRundownPlaylist (rundownPlaylistId: RundownPlaylistId, rehearsal?: boolean) {
		return rundownPlaylistSyncFunction(rundownPlaylistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			const playlist = RundownPlaylists.findOne(rundownPlaylistId)
			if (!playlist) throw new Meteor.Error(404, `Rundown Playlist "${rundownPlaylistId}" not found!`)
			if (playlist.active && !playlist.rehearsal) throw new Meteor.Error(402, `resetAndActivateRundownPlaylist cannot be run when active!`)

			libResetRundownPlaylist(playlist)

			return libActivateRundownPlaylist(playlist, !!rehearsal) // Activate rundown
		})
	}
	/**
	 * Activate the rundownPlaylist, decativate any other running rundowns
	 */
	export function forceResetAndActivateRundownPlaylist (rundownPlaylistId: RundownPlaylistId, rehearsal: boolean) {
		check(rehearsal, Boolean)
		return rundownPlaylistSyncFunction(rundownPlaylistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			const playlist = RundownPlaylists.findOne(rundownPlaylistId)
			if (!playlist) throw new Meteor.Error(404, `RundownPlaylist "${rundownPlaylistId}" not found!`)

			let anyOtherActiveRundowns = areThereActiveRundownPlaylistsInStudio(playlist.studioId, playlist._id)
			let error: any
			_.each(anyOtherActiveRundowns, (otherRundownPlaylist) => {
				try {
					deactivateRundownPlaylistInner(otherRundownPlaylist)
				} catch (e) {
					error = e
				}
			})
			if (error) {
				// Ok, something went wrong, but check if the active rundowns where deactivated?
				anyOtherActiveRundowns = areThereActiveRundownPlaylistsInStudio(playlist.studioId, playlist._id)
				if (anyOtherActiveRundowns.length) {
					// No they weren't, we can't continue..
					throw error
				} else {
					// They where deactivated, log the error and continue
					logger.error(error)
				}
			}

			libResetRundownPlaylist(playlist)

			return libActivateRundownPlaylist(playlist, rehearsal)
		})
	}
	/**
	 * Only activate the rundown, don't reset anything
	 */
	export function activateRundownPlaylist (rundownPlaylistId: RundownPlaylistId, rehearsal: boolean) {
		check(rehearsal, Boolean)
		return rundownPlaylistSyncFunction(rundownPlaylistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			const playlist = RundownPlaylists.findOne(rundownPlaylistId)
			if (!playlist) throw new Meteor.Error(404, `Rundown Playlist "${rundownPlaylistId}" not found!`)

			return libActivateRundownPlaylist(playlist, rehearsal)
		})
	}
	/**
	 * Deactivate the rundown
	 */
	export function deactivateRundownPlaylist (rundownPlaylistId: RundownPlaylistId) {
		return rundownPlaylistSyncFunction(rundownPlaylistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			const playlist = RundownPlaylists.findOne(rundownPlaylistId)
			if (!playlist) throw new Meteor.Error(404, `Rundown Playlist "${rundownPlaylistId}" not found!`)

			return libDeactivateRundownPlaylist(playlist)
		})
	}
	/**
	 * Trigger a reload of data of the rundown
	 */
	export function reloadRundownPlaylistData (rundownPlaylistId: RundownPlaylistId) {
		// Reload and reset the Rundown
		check(rundownPlaylistId, String)
		return rundownPlaylistSyncFunction(rundownPlaylistId, RundownSyncFunctionPriority.USER_INGEST, () => {
			const playlist = RundownPlaylists.findOne(rundownPlaylistId)
			if (!playlist) throw new Meteor.Error(404, `Rundown Playlist "${rundownPlaylistId}" not found!`)
			const rundowns = playlist.getRundowns()

			const response: ReloadRundownPlaylistResponse = {
				rundownsResponses: rundowns.map(rundown => {
					return {
						rundownId: rundown._id,
						response: IngestActions.reloadRundown(rundown)
					}
				})
			}
			return response
		})
	}
	/**
	 * Take the currently Next:ed Part (start playing it)
	 */
	export function takeNextPart (rundownPlaylistId: RundownPlaylistId): ClientAPI.ClientResponse<void> {
		check(rundownPlaylistId, String)

		return takeNextPartInner(rundownPlaylistId)
	}
	export function setNextPart (
		rundownPlaylistId: RundownPlaylistId,
		nextPartId: PartId | null,
		setManually?: boolean,
		nextTimeOffset?: number | undefined
	): ClientAPI.ClientResponse<void> {
		check(rundownPlaylistId, String)
		if (nextPartId) check(nextPartId, String)

		return rundownPlaylistSyncFunction(rundownPlaylistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			const playlist = RundownPlaylists.findOne(rundownPlaylistId)
			if (!playlist) throw new Meteor.Error(404, `Rundown Playlist "${rundownPlaylistId}" not found!`)

			setNextPartInner(playlist, nextPartId, setManually, nextTimeOffset)

			return ClientAPI.responseSuccess(undefined)
		})
	}
	export function setNextPartInner (
		playlist: RundownPlaylist,
		nextPartId: PartId | DBPart | null,
		setManually?: boolean,
		nextTimeOffset?: number | undefined
	) {
		if (!playlist.active) throw new Meteor.Error(501, `Rundown Playlist "${playlist._id}" is not active!`)

		if (playlist.holdState && playlist.holdState !== RundownHoldState.COMPLETE) throw new Meteor.Error(501, `Rundown "${playlist._id}" cannot change next during hold!`)

		let nextPart: DBPart | null = null
		if (nextPartId) {
			if (isStringOrProtectedString(nextPartId)) {
				nextPart = Parts.findOne(nextPartId) || null
			} else if (_.isObject(nextPartId)) {
				nextPart = nextPartId
			}
			if (!nextPart) throw new Meteor.Error(404, `Part "${nextPartId}" not found!`)
		}

		libSetNextPart(playlist, nextPart, setManually, nextTimeOffset)

		// remove old auto-next from timeline, and add new one
		updateTimeline(playlist.studioId)
	}
	export function moveNextPart (
		rundownPlaylistId: RundownPlaylistId,
		horizontalDelta: number,
		verticalDelta: number,
		setManually: boolean
	): PartId | null {
		check(rundownPlaylistId, String)
		check(horizontalDelta, Number)
		check(verticalDelta, Number)

		if (!horizontalDelta && !verticalDelta) throw new Meteor.Error(402, `rundownMoveNext: invalid delta: (${horizontalDelta}, ${verticalDelta})`)

		return rundownPlaylistSyncFunction(rundownPlaylistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			return moveNextPartInner(
				rundownPlaylistId,
				horizontalDelta,
				verticalDelta,
				setManually
			)
		})
	}
	function moveNextPartInner (
		rundownPlaylistId: RundownPlaylistId,
		horizontalDelta: number,
		verticalDelta: number,
		setManually: boolean,
		nextPartId0?: PartId
	): PartId | null {

		const playlist = RundownPlaylists.findOne(rundownPlaylistId)
		if (!playlist) throw new Meteor.Error(404, `RundownPlaylist "${rundownPlaylistId}" not found!`)
		if (!playlist.active) throw new Meteor.Error(501, `RundownPlaylist "${rundownPlaylistId}" is not active!`)

		if (playlist.holdState && playlist.holdState !== RundownHoldState.COMPLETE) throw new Meteor.Error(501, `RundownPlaylist "${rundownPlaylistId}" cannot change next during hold!`)

		const pSegmentsAndParts = playlist.getSegmentsAndParts()
		const { currentPartInstance, nextPartInstance } = playlist.getSelectedPartInstances()

		let currentNextPart: Part
		if (nextPartId0) {
			const nextPart = Parts.findOne(nextPartId0)
			if (!nextPart) throw new Meteor.Error(404, `Part "${nextPartId0}" not found!`)
			currentNextPart = nextPart
		} else {
			const nextPartInstanceTmp = nextPartInstance || currentPartInstance
			if (!nextPartInstanceTmp) throw new Meteor.Error(501, `RundownPlaylist "${rundownPlaylistId}" has no next and no current part!`)
			currentNextPart = nextPartInstanceTmp.part
		}

		const { segments, parts } = waitForPromise(pSegmentsAndParts)

		const currentNextSegment = segments.find(s => s._id === currentNextPart.segmentId) as Segment
		if (!currentNextSegment) throw new Meteor.Error(404, `Segment "${currentNextPart.segmentId}" not found!`)

		const partsInSegments: {[segmentId: string]: Part[]} = {}
		_.each(segments, segment => {
			let partsInSegment = _.filter(parts, p => p.segmentId === segment._id)
			if (partsInSegment.length) {
				partsInSegments[unprotectString(segment._id)] = partsInSegment
				parts.push(...partsInSegment)
			}
		})

		let partIndex: number = -1
		_.find(parts, (part, i) => {
			if (part._id === currentNextPart._id) {
				partIndex = i
				return true
			}
		})
		let segmentIndex: number = -1
		_.find(segments, (s, i) => {
			if (s._id === currentNextSegment._id) {
				segmentIndex = i
				return true
			}
		})
		if (partIndex === -1) throw new Meteor.Error(404, `Part not found in list of parts!`)
		if (segmentIndex === -1) throw new Meteor.Error(404, `Segment "${currentNextSegment._id}" not found in segmentsWithParts!`)
		if (verticalDelta !== 0) {
			segmentIndex += verticalDelta

			const segment = segments[segmentIndex]
			if (!segment) throw new Meteor.Error(404, `No Segment found!`)

			const part = _.first(partsInSegments[unprotectString(segment._id)])
			if (!part) throw new Meteor.Error(404, `No Parts in segment "${segment._id}"!`)

			partIndex = -1
			_.find(parts, (p, i) => {
				if (p._id === part._id) {
					partIndex = i
					return true
				}
			})
			if (partIndex === -1) throw new Meteor.Error(404, `Part (from segment) not found in list of parts!`)
		}
		partIndex += horizontalDelta

		partIndex = Math.max(0, Math.min(parts.length - 1, partIndex))

		let part = parts[partIndex]
		if (!part) throw new Meteor.Error(501, `Part index ${partIndex} not found in list of parts!`)

		if ((currentPartInstance && part._id === currentPartInstance.part._id && !nextPartId0) || !part.isPlayable()) {
			// Whoops, we're not allowed to next to that.
			// Skip it, then (ie run the whole thing again)
			if (part._id !== nextPartId0) {
				return moveNextPartInner(rundownPlaylistId, horizontalDelta, verticalDelta, setManually, part._id)
			} else {
				// Calling ourselves again at this point would result in an infinite loop
				// There probably isn't any Part available to Next then...
				setNextPartInner(playlist, null, setManually)
				return null
			}
		} else {
			setNextPartInner(playlist, part, setManually)
			return part._id
		}
	}
	export function activateHold (rundownPlaylistId: RundownPlaylistId) {
		check(rundownPlaylistId, String)
		logger.debug('rundownActivateHold')

		return rundownPlaylistSyncFunction(rundownPlaylistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			const playlist = RundownPlaylists.findOne(rundownPlaylistId)
			if (!playlist) throw new Meteor.Error(404, `Rundown Playlist "${rundownPlaylistId}" not found!`)

			if (!playlist.currentPartInstanceId) throw new Meteor.Error(400, `Rundown Playlist "${rundownPlaylistId}" no current part!`)
			if (!playlist.nextPartInstanceId) throw new Meteor.Error(400, `Rundown Playlist "${rundownPlaylistId}" no next part!`)

			const { currentPartInstance, nextPartInstance } = playlist.getSelectedPartInstances()
			if (!currentPartInstance) throw new Meteor.Error(404, `PartInstance "${playlist.currentPartInstanceId}" not found!`)
			if (!nextPartInstance) throw new Meteor.Error(404, `PartInstance "${playlist.nextPartInstanceId}" not found!`)

			if (playlist.holdState) {
				throw new Meteor.Error(400, `RundownPlaylist "${rundownPlaylistId}" already doing a hold!`)
			}

			if (currentPartInstance.part.holdMode !== PartHoldMode.FROM || nextPartInstance.part.holdMode !== PartHoldMode.TO) {
				throw new Meteor.Error(400, `RundownPlaylist "${rundownPlaylistId}" incompatible pair of HoldMode!`)
			}

			RundownPlaylists.update(rundownPlaylistId, { $set: { holdState: RundownHoldState.PENDING } })

			updateTimeline(playlist.studioId)
		})
	}
	export function deactivateHold (rundownPlaylistId: RundownPlaylistId) {
		check(rundownPlaylistId, String)
		logger.debug('deactivateHold')

		return rundownPlaylistSyncFunction(rundownPlaylistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			const playlist = RundownPlaylists.findOne(rundownPlaylistId)
			if (!playlist) throw new Meteor.Error(404, `RundownPlaylist "${rundownPlaylistId}" not found!`)

			if (playlist.holdState !== RundownHoldState.PENDING) throw new Meteor.Error(400, `RundownPlaylist "${rundownPlaylistId}" is not pending a hold!`)

			Rundowns.update(rundownPlaylistId, { $set: { holdState: RundownHoldState.NONE } })

			updateTimeline(playlist.studioId)
		})
	}
	export function disableNextPiece (rundownPlaylistId: RundownPlaylistId, undo?: boolean) {
		check(rundownPlaylistId, String)

		return rundownPlaylistSyncFunction(rundownPlaylistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			const playlist = RundownPlaylists.findOne(rundownPlaylistId)
			if (!playlist) throw new Meteor.Error(404, `RundownPlaylist "${rundownPlaylistId}" not found!`)
			if (!playlist.currentPartInstanceId) throw new Meteor.Error(401, `No current part!`)

			const { currentPartInstance, nextPartInstance } = playlist.getSelectedPartInstances()
			if (!currentPartInstance) throw new Meteor.Error(404, `PartInstance "${playlist.currentPartInstanceId}" not found!`)

			const rundown = Rundowns.findOne(currentPartInstance.rundownId)
			if (!rundown) throw new Meteor.Error(404, `Rundown "${currentPartInstance.rundownId}" not found!`)
			const showStyleBase = rundown.getShowStyleBase()

			// @ts-ignore stringify
			// logger.info(o)
			// logger.info(JSON.stringify(o, '', 2))

			const allowedSourceLayers = normalizeArray(showStyleBase.sourceLayers, '_id')

			// logger.info('nowInPart', nowInPart)
			// logger.info('filteredPieces', filteredPieces)
			let getNextPiece = (partInstance: PartInstance, undo?: boolean) => {
				// Find next piece to disable

				let nowInPart = 0
				if (
					partInstance.part.startedPlayback &&
					partInstance.part.timings &&
					partInstance.part.timings.startedPlayback
				) {
					let lastStartedPlayback = _.last(partInstance.part.timings.startedPlayback)

					if (lastStartedPlayback) {
						nowInPart = getCurrentTime() - lastStartedPlayback
					}
				}

				const pieceInstances = partInstance.getAllPieceInstances()
				const sortedPieces: Piece[] = sortPiecesByStart(pieceInstances.map(p => p.piece))

				let findLast: boolean = !!undo

				let filteredPieces = _.sortBy(
					_.filter(sortedPieces, (piece: Piece) => {
						let sourceLayer = allowedSourceLayers[piece.sourceLayerId]
						if (sourceLayer && sourceLayer.allowDisable && !piece.virtual && !piece.isTransition) return true
						return false
					}),
					(piece: Piece) => {
						let sourceLayer = allowedSourceLayers[piece.sourceLayerId]
						return sourceLayer._rank || -9999
					}
				)
				if (findLast) filteredPieces.reverse()

				let nextPiece: Piece | undefined = _.find(filteredPieces, (piece) => {
					logger.info('piece.enable.start', piece.enable.start)
					return (
						piece.enable.start >= nowInPart &&
						(
							(
								!undo &&
								!piece.disabled
							) || (
								undo &&
								piece.disabled
							)
						)
					)
				})
				return nextPiece ? pieceInstances.find(p => p.piece._id === nextPiece!._id) : undefined
			}

			if (nextPartInstance) {
				// pretend that the next part never has played (even if it has)
				nextPartInstance.part.startedPlayback = false
			}

			let partInstances = [
				currentPartInstance,
				nextPartInstance // If not found in currently playing part, let's look in the next one:
			]
			if (undo) partInstances.reverse()

			let nextPieceInstance: PieceInstance | undefined

			_.each(partInstances, (partInstance) => {
				if (partInstance && !nextPieceInstance) {
					nextPieceInstance = getNextPiece(partInstance, undo)
				}
			})

			if (nextPieceInstance) {
				logger.info((undo ? 'Disabling' : 'Enabling') + ' next PieceInstance ' + nextPieceInstance._id)
				PieceInstances.update(nextPieceInstance._id, {$set: {
					'piece.disabled': !undo
				}})
				// TODO-PartInstance - pending new data flow
				Pieces.update(nextPieceInstance.piece._id, {$set: {
					disabled: !undo
				}})

				updateTimeline(playlist.studioId)
			} else {
				throw new Meteor.Error(500, 'Found no future pieces')
			}
		})
	}
	/**
	 * Triggered from Playout-gateway when a Piece has started playing
	 */
	export function onPiecePlaybackStarted (rundownId: RundownId, pieceInstanceId: PieceInstanceId, dynamicallyInserted: boolean, startedPlayback: Time) {
		check(rundownId, String)
		check(pieceInstanceId, String)
		check(startedPlayback, Number)

		const playlistId = getRundown(rundownId).playlistId
		// TODO - confirm this is correct
		return rundownPlaylistSyncFunction(playlistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			// This method is called when an auto-next event occurs
			const pieceInstance = PieceInstances.findOne({
				_id: pieceInstanceId,
				rundownId: rundownId
			})
			if (dynamicallyInserted && !pieceInstance) return// if it was dynamically inserted, it's okay if we can't find it
			if (!pieceInstance) throw new Meteor.Error(404, `PieceInstance "${pieceInstanceId}" in rundown "${rundownId}" not found!`)

			const isPlaying: boolean = !!(
				pieceInstance.piece.startedPlayback &&
				!pieceInstance.piece.stoppedPlayback
			)
			if (!isPlaying) {
				logger.info(`Playout reports pieceInstance "${pieceInstanceId}" has started playback on timestamp ${(new Date(startedPlayback)).toISOString()}`)

				reportPieceHasStarted(pieceInstance, startedPlayback)

				// We don't need to bother with an updateTimeline(), as this hasn't changed anything, but lets us accurately add started items when reevaluating
			}
		})
	}
	/**
	 * Triggered from Playout-gateway when a Piece has stopped playing
	 */
	export function onPiecePlaybackStopped (rundownId: RundownId, pieceInstanceId: PieceInstanceId, dynamicallyInserted: boolean, stoppedPlayback: Time) {
		check(rundownId, String)
		check(pieceInstanceId, String)
		check(stoppedPlayback, Number)

		const playlistId = getRundown(rundownId).playlistId

		// TODO - confirm this is correct
		return rundownPlaylistSyncFunction(playlistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			// This method is called when an auto-next event occurs
			const pieceInstance = PieceInstances.findOne({
				_id: pieceInstanceId,
				rundownId: rundownId
			})
			if (dynamicallyInserted && !pieceInstance) return// if it was dynamically inserted, it's okay if we can't find it
			if (!pieceInstance) throw new Meteor.Error(404, `PieceInstance "${pieceInstanceId}" in rundown "${rundownId}" not found!`)

			const isPlaying: boolean = !!(
				pieceInstance.piece.startedPlayback &&
				!pieceInstance.piece.stoppedPlayback
			)
			if (isPlaying) {
				logger.info(`Playout reports pieceInstance "${pieceInstanceId}" has stopped playback on timestamp ${(new Date(stoppedPlayback)).toISOString()}`)

				reportPieceHasStopped(pieceInstance, stoppedPlayback)
			}
		})
	}
	/**
	 * Triggered from Playout-gateway when a Part has started playing
	 */
	export function onPartPlaybackStarted (rundownId: RundownId, partInstanceId: PartInstanceId, startedPlayback: Time) {
		check(rundownId, String)
		check(partInstanceId, String)
		check(startedPlayback, Number)

		const playlistId = getRundown(rundownId).playlistId

		return rundownPlaylistSyncFunction(playlistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			// This method is called when a part starts playing (like when an auto-next event occurs, or a manual next)

			const playingPartInstance = PartInstances.findOne({
				_id: partInstanceId,
				rundownId: rundownId
			})

			if (playingPartInstance) {
				// make sure we don't run multiple times, even if TSR calls us multiple times

				const isPlaying = (
					playingPartInstance.part.startedPlayback &&
					!playingPartInstance.part.stoppedPlayback
				)
				if (!isPlaying) {
					logger.info(`Playout reports PartInstance "${partInstanceId}" has started playback on timestamp ${(new Date(startedPlayback)).toISOString()}`)

					const rundown = Rundowns.findOne(rundownId)
					if (!rundown) throw new Meteor.Error(404, `Rundown "${rundownId}" not found!`)
					let playlist = rundown.getRundownPlaylist()
					if (!playlist.active) throw new Meteor.Error(501, `Rundown "${rundownId}" is not active!`)

					const { currentPartInstance, previousPartInstance } = playlist.getSelectedPartInstances()

					if (playlist.currentPartInstanceId === partInstanceId) {
						// this is the current part, it has just started playback
						if (playlist.previousPartInstanceId) {
							if (!previousPartInstance) {
								// We couldn't find the previous part: this is not a critical issue, but is clearly is a symptom of a larger issue
								logger.error(`Previous PartInstance "${playlist.previousPartInstanceId}" on RundownPlaylist "${playlist._id}" could not be found.`)
							} else if (!previousPartInstance.part.duration) {
								onPartHasStoppedPlaying(previousPartInstance, startedPlayback)
							}
						}

						setRundownStartedPlayback(playlist, rundown, startedPlayback) // Set startedPlayback on the rundown if this is the first item to be played

						reportPartHasStarted(playingPartInstance, startedPlayback)

					} else if (playlist.nextPartInstanceId === partInstanceId) {
						// this is the next part, clearly an autoNext has taken place
						if (playlist.currentPartInstanceId) {
							if (!currentPartInstance) {
								// We couldn't find the previous part: this is not a critical issue, but is clearly is a symptom of a larger issue
								logger.error(`Previous PartInstance "${playlist.currentPartInstanceId}" on RundownPlaylist "${playlist._id}" could not be found.`)
							} else if (!currentPartInstance.part.duration) {
								onPartHasStoppedPlaying(currentPartInstance, startedPlayback)
							}
						}

						setRundownStartedPlayback(playlist, rundown, startedPlayback) // Set startedPlayback on the rundown if this is the first item to be played

						const playlistChange = literal<Partial<RundownPlaylist>>({
							previousPartInstanceId: playlist.currentPartInstanceId,
							currentPartInstanceId: playingPartInstance._id,
							holdState: RundownHoldState.NONE,
						})

						RundownPlaylists.update(playlist._id, {
							$set: playlistChange
						})
						playlist = _.extend(playlist, playlistChange) as RundownPlaylist

						reportPartHasStarted(playingPartInstance, startedPlayback)

						const nextPart = selectNextPart(playingPartInstance, playlist.getAllOrderedParts())
						libSetNextPart(playlist, nextPart ? nextPart.part : null)
					} else {
						// a part is being played that has not been selected for playback by Core
						// show must go on, so find next part and update the Rundown, but log an error
						const previousReported = playlist.lastIncorrectPartPlaybackReported

						if (previousReported && Date.now() - previousReported > INCORRECT_PLAYING_PART_DEBOUNCE) {
							// first time this has happened for a while, let's try to progress the show:

							setRundownStartedPlayback(playlist, rundown, startedPlayback) // Set startedPlayback on the rundown if this is the first item to be played

							const playlistChange = literal<Partial<RundownPlaylist>>({
								previousPartInstanceId: null,
								currentPartInstanceId: playingPartInstance._id,
								lastIncorrectPartPlaybackReported: Date.now() // save the time to prevent the system to go in a loop
							})

							RundownPlaylists.update(playlist._id, {
								$set: playlistChange
							})
							playlist = _.extend(playlist, playlistChange)

							reportPartHasStarted(playingPartInstance, startedPlayback)

							const nextPart = selectNextPart(playingPartInstance, playlist.getAllOrderedParts())
							libSetNextPart(playlist, nextPart ? nextPart.part : null)
						}

						// TODO-ASAP - should this even change the next?
						logger.error(`PartInstance "${playingPartInstance._id}" has started playback by the playout gateway, but has not been selected for playback!`)
					}

					// Load the latest data and complete the take
					const rundownPlaylist = RundownPlaylists.findOne(rundown.playlistId)
					if (!rundownPlaylist) throw new Meteor.Error(404, `RundownPlaylist "${rundown.playlistId}", parent of rundown "${rundown._id}" not found!`)

					afterTake(rundownPlaylist.fetchAllPlayoutData(), playingPartInstance)
				}
			} else {
				throw new Meteor.Error(404, `PartInstance "${partInstanceId}" in rundown "${rundownId}" not found!`)
			}
		})
	}
	/**
	 * Triggered from Playout-gateway when a Part has stopped playing
	 */
	export function onPartPlaybackStopped (rundownId: RundownId, partInstanceId: PartInstanceId, stoppedPlayback: Time) {
		check(rundownId, String)
		check(partInstanceId, String)
		check(stoppedPlayback, Number)

		const playlistId = getRundown(rundownId).playlistId

		return rundownPlaylistSyncFunction(playlistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			// This method is called when a part stops playing (like when an auto-next event occurs, or a manual next)

			const rundown = Rundowns.findOne(rundownId)
			if (!rundown) throw new Meteor.Error(404, `Rundown "${rundownId}" not found!`)

			const partInstance = PartInstances.findOne({
				_id: partInstanceId,
				rundownId: rundownId
			})

			if (partInstance) {
				// make sure we don't run multiple times, even if TSR calls us multiple times

				const isPlaying = (
					partInstance.part.startedPlayback &&
					!partInstance.part.stoppedPlayback
				)
				if (isPlaying) {
					logger.info(`Playout reports PartInstance "${partInstanceId}" has stopped playback on timestamp ${(new Date(stoppedPlayback)).toISOString()}`)

					reportPartHasStopped(partInstance, stoppedPlayback)
				}
			} else {
				throw new Meteor.Error(404, `PartInstance "${partInstanceId}" in rundown "${rundownId}" not found!`)
			}
		})
	}
	/**
	 * Make a copy of a piece and start playing it now
	 */
	export function pieceTakeNow (playlistId: RundownPlaylistId, partInstanceId: PartInstanceId, pieceInstanceIdOrPieceIdToCopy: PieceInstanceId | PieceId) {
		check(playlistId, String)
		check(partInstanceId, String)
		check(pieceInstanceIdOrPieceIdToCopy, String)

		return ServerPlayoutAdLibAPI.pieceTakeNow(playlistId, partInstanceId, pieceInstanceIdOrPieceIdToCopy)
	}
	export function segmentAdLibPieceStart (rundownPlaylistId: RundownPlaylistId, partInstanceId: PartInstanceId, adLibPieceId: PieceId, queue: boolean) {
		check(rundownPlaylistId, String)
		check(partInstanceId, String)
		check(adLibPieceId, String)

		return ServerPlayoutAdLibAPI.segmentAdLibPieceStart(rundownPlaylistId, partInstanceId, adLibPieceId, queue)
	}
	export function rundownBaselineAdLibPieceStart (rundownPlaylistId: RundownPlaylistId, partInstanceId: PartInstanceId, baselineAdLibPieceId: PieceId, queue: boolean) {
		check(rundownPlaylistId, String)
		check(partInstanceId, String)
		check(baselineAdLibPieceId, String)

		return ServerPlayoutAdLibAPI.rundownBaselineAdLibPieceStart(rundownPlaylistId, partInstanceId, baselineAdLibPieceId, queue)
	}
	export function sourceLayerStickyPieceStart (rundownPlaylistId: RundownPlaylistId, sourceLayerId: string) {
		check(rundownPlaylistId, String)
		check(sourceLayerId, String)

		return ServerPlayoutAdLibAPI.sourceLayerStickyPieceStart(rundownPlaylistId, sourceLayerId)
	}
	export function sourceLayerOnPartStop (rundownPlaylistId: RundownPlaylistId, partInstanceId: PartInstanceId, sourceLayerId: string) {
		check(rundownPlaylistId, String)
		check(partInstanceId, String)
		check(sourceLayerId, String)

		return rundownPlaylistSyncFunction(rundownPlaylistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			const playlist = RundownPlaylists.findOne(rundownPlaylistId)
			if (!playlist) throw new Meteor.Error(404, `Rundown "${rundownPlaylistId}" not found!`)
			if (!playlist.active) throw new Meteor.Error(403, `Pieces can be only manipulated in an active rundown!`)
			if (playlist.currentPartInstanceId !== partInstanceId) throw new Meteor.Error(403, `Pieces can be only manipulated in a current part!`)

			const partInstance = PartInstances.findOne(partInstanceId)
			if (!partInstance) throw new Meteor.Error(404, `PartInstance "${partInstanceId}" not found!`)
			const lastStartedPlayback = partInstance.part.getLastStartedPlayback()
			if (!lastStartedPlayback) throw new Meteor.Error(405, `Part "${partInstanceId}" has yet to start playback!`)

			const rundown = Rundowns.findOne(partInstance.rundownId)
			if (!rundown) throw new Meteor.Error(501, `Rundown "${partInstance.rundownId}" not found!`)

			const now = getCurrentTime()
			const relativeNow = now - lastStartedPlayback
			const orderedPieces = getResolvedPieces(partInstance)

			orderedPieces.forEach((pieceInstance) => {
				if (pieceInstance.piece.sourceLayerId === sourceLayerId) {
					if (!pieceInstance.piece.userDuration) {
						let newExpectedDuration: number | undefined = undefined

						if (pieceInstance.piece.infiniteId && pieceInstance.piece.infiniteId !== pieceInstance.piece._id) {
							newExpectedDuration = now - lastStartedPlayback
						} else if (
							pieceInstance.piece.startedPlayback && // currently playing
							(pieceInstance.resolvedStart || 0) < relativeNow && // is relative, and has started
							!pieceInstance.piece.stoppedPlayback // and not yet stopped
						) {
							newExpectedDuration = now - pieceInstance.piece.startedPlayback
						}

						if (newExpectedDuration !== undefined) {
							console.log(`Cropping PieceInstance "${pieceInstance._id}" to ${newExpectedDuration}`)

							PieceInstances.update({
								_id: pieceInstance._id
							}, {
								$set: {
									'piece.userDuration': {
										duration: newExpectedDuration
									}
								}
							})

							// TODO-PartInstance - pending new data flow
							Pieces.update({
								_id: pieceInstance.piece._id
							}, {
								$set: {
									userDuration: {
										duration: newExpectedDuration
									}
								}
							})
						}
					}
				}
			})

			updateSourceLayerInfinitesAfterPart(rundown, partInstance.part)

			updateTimeline(playlist.studioId)
		})
	}
	export function rundownTogglePartArgument (
		rundownPlaylistId: RundownPlaylistId,
		partInstanceId: PartInstanceId,
		property: string,
		value: string
	) {
		check(rundownPlaylistId, String)
		check(partInstanceId, String)

		return rundownPlaylistSyncFunction(rundownPlaylistId, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			const playlist = RundownPlaylists.findOne(rundownPlaylistId)
			if (!playlist) throw new Meteor.Error(404, `Rundown "${rundownPlaylistId}" not found!`)
			if (playlist.holdState === RundownHoldState.ACTIVE || playlist.holdState === RundownHoldState.PENDING) {
				throw new Meteor.Error(403, `Part Arguments can not be toggled when hold is used!`)
			}

			let partInstance = PartInstances.findOne(partInstanceId)
			if (!partInstance) throw new Meteor.Error(404, `PartInstance "${partInstanceId}" not found!`)
			const rundown = Rundowns.findOne(partInstance.rundownId)
			if (!rundown) throw new Meteor.Error(501, `Rundown "${partInstance.rundownId}" not found!`)

			const rArguments = partInstance.part.runtimeArguments || {}

			if (rArguments[property] === value) {
				// unset property
				const mUnset: any = {}
				const mUnset1: any = {}
				mUnset['runtimeArguments.' + property] = 1
				mUnset1['part.runtimeArguments.' + property] = 1
				Parts.update(partInstance.part._id, {$unset: mUnset, $set: {
					dirty: true
				}})
				PartInstances.update(partInstance._id, {$unset: mUnset1, $set: {
					dirty: true
				}})
				delete rArguments[property]
			} else {
				// set property
				const mSet: any = {}
				const mSet1: any = {}
				mSet['runtimeArguments.' + property] = value
				mSet1['part.runtimeArguments.' + property] = value
				mSet.dirty = true
				Parts.update(partInstance.part._id, { $set: mSet })
				PartInstances.update(partInstance._id, { $set: mSet1 })

				rArguments[property] = value
			}

			refreshPart(rundown, partInstance.part)

			// Only take time to update the timeline if there's a point to do it
			if (playlist.active) {
				// If this part is rundown's next, check if current part has autoNext
				if ((playlist.nextPartInstanceId === partInstance._id) && playlist.currentPartInstanceId) {
					const currentPartInstance = PartInstances.findOne(playlist.currentPartInstanceId)
					if (currentPartInstance && currentPartInstance.part.autoNext) {
						updateTimeline(rundown.studioId)
					}
				// If this is rundown's current part, update immediately
				} else if (playlist.currentPartInstanceId === partInstance._id) {
					updateTimeline(rundown.studioId)
				}
			}
			return ClientAPI.responseSuccess(undefined)
		})
	}
	/**
	 * Called from Playout-gateway when the trigger-time of a timeline object has updated
	 * ( typically when using the "now"-feature )
	 */
	export function timelineTriggerTimeUpdateCallback (activeRundownIds: RundownId[], timelineObj: TimelineObjGeneric, time: number) {
		check(timelineObj, Object)
		check(time, Number)

		if (activeRundownIds && activeRundownIds.length > 0 && timelineObj.metadata && timelineObj.metadata.pieceId) {
			logger.debug('Update PieceInstance: ', timelineObj.metadata.pieceId, (new Date(time)).toTimeString())
			PieceInstances.update({
				_id: timelineObj.metadata.pieceId,
				rundownId: { $in: activeRundownIds }
			}, {
				$set: {
					'piece.enable.start': time
				}
			})

			const pieceInstance = PieceInstances.findOne({
				_id: timelineObj.metadata.pieceId,
				rundownId: { $in: activeRundownIds }
			})
			if (pieceInstance) {
				// TODO-PartInstance - pending new data flow
				Pieces.update({
					_id: pieceInstance.piece._id,
					rundownId: { $in: activeRundownIds }
				}, {
					$set: {
						'enable.start': time
					}
				})
				PieceInstances.update({
					_id: pieceInstance._id,
					rundownId: { $in: activeRundownIds }
				}, {
					$set: {
						'piece.enable.start': time
					}
				})
			}
		}
	}
	export function updateStudioBaseline (studioId: StudioId) {
		check(studioId, String)

		// TODO - should there be a studio lock for activate/deactivate/this?

		const activeRundowns = areThereActiveRundownPlaylistsInStudio(studioId)
		if (activeRundowns.length === 0) {
			// This is only run when there is no rundown active in the studio
			updateTimeline(studioId)
		}

		return shouldUpdateStudioBaseline(studioId)
	}
	export function shouldUpdateStudioBaseline (studioId: StudioId): string | false {
		check(studioId, String)

		const studio = Studios.findOne(studioId)
		if (!studio) throw new Meteor.Error(404, `Studio "${studioId}" not found!`)

		const activeRundowns = areThereActiveRundownPlaylistsInStudio(studio._id)

		if (activeRundowns.length === 0) {
			const markerId: TimelineObjId = protectString(`${studio._id}_baseline_version`)
			const markerObject = Timeline.findOne(markerId)
			if (!markerObject) return 'noBaseline'

			const versionsContent = (markerObject.metadata || {}).versions || {}

			if (versionsContent.core !== PackageInfo.version) return 'coreVersion'

			if (versionsContent.studio !== (studio._rundownVersionHash || 0)) return 'studio'

			if (versionsContent.blueprintId !== studio.blueprintId) return 'blueprintId'
			if (studio.blueprintId) {
				const blueprint = Blueprints.findOne(studio.blueprintId)
				if (!blueprint) return 'blueprintUnknown'
				if (versionsContent.blueprintVersion !== (blueprint.blueprintVersion || 0)) return 'blueprintVersion'
			}
		}

		return false
	}
}

function setRundownStartedPlayback (playlist: RundownPlaylist, rundown: Rundown, startedPlayback: Time) {
	if (!rundown.startedPlayback) { // Set startedPlayback on the rundown if this is the first item to be played
		reportRundownHasStarted(playlist, rundown, startedPlayback)
	}
}

interface UpdateTimelineFromIngestDataTimeout {
	timeout?: number
	changedSegments: SegmentId[]
}
let updateTimelineFromIngestDataTimeouts: {
	[rundownId: string]: UpdateTimelineFromIngestDataTimeout
} = {}
export function triggerUpdateTimelineAfterIngestData (rundownId: RundownId, changedSegmentIds: SegmentId[]) {
	// Lock behind a timeout, so it doesnt get executed loads when importing a rundown or there are large changes
	let data: UpdateTimelineFromIngestDataTimeout = updateTimelineFromIngestDataTimeouts[unprotectString(rundownId)]
	if (data) {
		if (data.timeout) Meteor.clearTimeout(data.timeout)
		data.changedSegments = data.changedSegments.concat(changedSegmentIds)
	} else {
		data = {
			changedSegments: changedSegmentIds
		}
	}

	data.timeout = Meteor.setTimeout(() => {
		delete updateTimelineFromIngestDataTimeouts[unprotectString(rundownId)]

		// infinite items only need to be recalculated for those after where the edit was made (including the edited line)
		let prevPart: Part | undefined
		if (data.changedSegments) {
			const firstSegment = Segments.findOne({
				rundownId: rundownId,
				_id: { $in: data.changedSegments }
			})
			if (firstSegment) {
				prevPart = getPartBeforeSegment(rundownId, firstSegment)
			}
		}

		const rundown = Rundowns.findOne(rundownId)
		if (!rundown) throw new Meteor.Error(404, `Rundown "${rundownId}" not found!`)
		const playlist = rundown.getRundownPlaylist()
		if (!playlist) throw new Meteor.Error(501, `Rundown "${rundownId}" not a part of a playlist: "${rundown.playlistId}"`)

		// TODO - test the input data for this
		updateSourceLayerInfinitesAfterPart(rundown, prevPart, true)

		return rundownPlaylistSyncFunction(playlist._id, RundownSyncFunctionPriority.USER_PLAYOUT, () => {
			if (playlist.active && playlist.currentPartInstanceId) {
				const { currentPartInstance, nextPartInstance } = playlist.getSelectedPartInstances()
				if (currentPartInstance && (currentPartInstance.rundownId === rundown._id || (currentPartInstance.part.autoNext && nextPartInstance && nextPartInstance.rundownId === rundownId))) {
					updateTimeline(rundown.studioId)
				}
			}
		})
	}, 1000)

	updateTimelineFromIngestDataTimeouts[unprotectString(rundownId)] = data
}

function getRundown (rundownId: RundownId): Rundown {
	const rundown = Rundowns.findOne(rundownId)
	if (!rundown) throw new Meteor.Error(404, 'Rundown ' + rundownId + ' not found')
	return rundown
}
