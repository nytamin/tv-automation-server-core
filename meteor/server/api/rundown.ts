import { Meteor } from 'meteor/meteor'
import * as _ from 'underscore'
import { check } from 'meteor/check'
import { Rundowns, Rundown, DBRundown, RundownId } from '../../lib/collections/Rundowns'
import { Part, Parts, DBPart, PartId } from '../../lib/collections/Parts'
import { Pieces } from '../../lib/collections/Pieces'
import { AdLibPieces } from '../../lib/collections/AdLibPieces'
import { Segments, SegmentId } from '../../lib/collections/Segments'
import {
	saveIntoDb,
	getRank,
	getCurrentTime,
	asyncCollectionUpdate,
	waitForPromiseAll,
	getHash,
	literal,
	waitForPromise,
	unprotectObjectArray,
	protectString,
	unprotectString,
	makePromise
} from '../../lib/lib'
import { logger } from '../logging'
import { registerClassToMeteorMethods } from '../methods'
import { NewRundownAPI, RundownAPIMethods } from '../../lib/api/rundown'
import { updateExpectedMediaItemsOnPart } from './expectedMediaItems'
import { ShowStyleVariants, ShowStyleVariant, ShowStyleVariantId } from '../../lib/collections/ShowStyleVariants'
import { ShowStyleBases, ShowStyleBase, ShowStyleBaseId } from '../../lib/collections/ShowStyleBases'
import { Blueprints } from '../../lib/collections/Blueprints'
import { Studios, Studio } from '../../lib/collections/Studios'
import { IngestRundown, BlueprintResultOrderedRundowns } from 'tv-automation-sofie-blueprints-integration'
import { StudioConfigContext } from './blueprints/context'
import { loadStudioBlueprints, loadShowStyleBlueprints } from './blueprints/cache'
import { PackageInfo } from '../coreSystem'
import { IngestActions } from './ingest/actions'
import { DBRundownPlaylist, RundownPlaylists, RundownPlaylistId } from '../../lib/collections/RundownPlaylists'
import { PeripheralDevice } from '../../lib/collections/PeripheralDevices'
import { PartInstances } from '../../lib/collections/PartInstances'
import { ReloadRundownPlaylistResponse, ReloadRundownResponse } from '../../lib/api/userActions'

export function selectShowStyleVariant (studio: Studio, ingestRundown: IngestRundown): { variant: ShowStyleVariant, base: ShowStyleBase } | null {
	if (!studio.supportedShowStyleBase.length) {
		logger.debug(`Studio "${studio._id}" does not have any supportedShowStyleBase`)
		return null
	}
	const showStyleBases = ShowStyleBases.find({ _id: { $in: studio.supportedShowStyleBase } }).fetch()
	let showStyleBase = _.first(showStyleBases)
	if (!showStyleBase) {
		logger.debug(`No showStyleBases matching with supportedShowStyleBase [${studio.supportedShowStyleBase}] from studio "${studio._id}"`)
		return null
	}

	const context = new StudioConfigContext(studio)

	const studioBlueprint = loadStudioBlueprints(studio)
	if (!studioBlueprint) throw new Meteor.Error(500, `Studio "${studio._id}" does not have a blueprint`)

	if (!studioBlueprint.blueprint.getShowStyleId) throw new Meteor.Error(500, `Studio "${studio._id}" blueprint missing property getShowStyleId`)

	const showStyleId: ShowStyleBaseId | null = protectString(studioBlueprint.blueprint.getShowStyleId(context, unprotectObjectArray(showStyleBases) as any, ingestRundown))
	if (showStyleId === null) {
		logger.debug(`StudioBlueprint for studio "${studio._id}" returned showStyleId = null`)
		return null
	}
	showStyleBase = _.find(showStyleBases, s => s._id === showStyleId)
	if (!showStyleBase) {
		logger.debug(`No ShowStyleBase found matching showStyleId "${showStyleId}", from studio "${studio._id}" blueprint`)
		return null
	}
	const showStyleVariants = ShowStyleVariants.find({ showStyleBaseId: showStyleBase._id }).fetch()
	if (!showStyleVariants.length) throw new Meteor.Error(500, `ShowStyleBase "${showStyleBase._id}" has no variants`)

	const showStyleBlueprint = loadShowStyleBlueprints(showStyleBase)
	if (!showStyleBlueprint) throw new Meteor.Error(500, `ShowStyleBase "${showStyleBase._id}" does not have a valid blueprint`)

	const variantId: ShowStyleVariantId | null = protectString(
		showStyleBlueprint.blueprint.getShowStyleVariantId(context, unprotectObjectArray(showStyleVariants) as any, ingestRundown)
	)
	if (variantId === null) {
		logger.debug(`StudioBlueprint for studio "${studio._id}" returned variantId = null in .getShowStyleVariantId`)
		return null
	} else {
		const showStyleVariant = _.find(showStyleVariants, s => s._id === variantId)
		if (!showStyleVariant) throw new Meteor.Error(404, `Blueprint returned variantId "${variantId}", which was not found!`)

		return {
			variant: showStyleVariant,
			base: showStyleBase
		}
	}
}

export interface RundownPlaylistAndOrder {
	rundownPlaylist: DBRundownPlaylist
	order: BlueprintResultOrderedRundowns
}

export function produceRundownPlaylistInfo (studio: Studio, currentRundown: DBRundown, peripheralDevice: PeripheralDevice | undefined): RundownPlaylistAndOrder {

	const studioBlueprint = loadStudioBlueprints(studio)
	if (!studioBlueprint) throw new Meteor.Error(500, `Studio "${studio._id}" does not have a blueprint`)

	if (currentRundown.playlistExternalId && studioBlueprint.blueprint.getRundownPlaylistInfo) {

		// Note: We have to use the ExternalId of the playlist here, since we actually don't know the id of the playlist yet
		const allRundowns = Rundowns.find({ playlistExternalId: currentRundown.playlistExternalId }).fetch()

		if (!_.find(allRundowns, (rd => rd._id === currentRundown._id))) throw new Meteor.Error(500, `produceRundownPlaylistInfo: currentRundown ("${currentRundown._id}") not found in collection!`)

		const playlistInfo = studioBlueprint.blueprint.getRundownPlaylistInfo(
			allRundowns
		)
		if (!playlistInfo) throw new Meteor.Error(500, `blueprint.getRundownPlaylistInfo() returned null for externalId "${currentRundown.playlistExternalId}"`)

		const playlistId: RundownPlaylistId = protectString(getHash(playlistInfo.playlist.externalId))

		const existingPlaylist = RundownPlaylists.findOne(playlistId)

		const playlist = _.extend(existingPlaylist || {}, _.omit(literal<DBRundownPlaylist>({
			_id: playlistId,
			externalId: playlistInfo.playlist.externalId,
			studioId: studio._id,
			name: playlistInfo.playlist.name,
			expectedStart: playlistInfo.playlist.expectedStart,
			expectedDuration: playlistInfo.playlist.expectedDuration,

			created: existingPlaylist ? existingPlaylist.created : getCurrentTime(),
			modified: getCurrentTime(),

			peripheralDeviceId: peripheralDevice ? peripheralDevice._id : protectString(''),

			currentPartInstanceId: null,
			nextPartInstanceId: null,
			previousPartInstanceId: null
		}), [ 'currentPartInstanceId', 'nextPartInstanceId', 'previousPartInstanceId', 'created' ])) as DBRundownPlaylist

		let order = playlistInfo.order
		if (!order) {
			// If no order is provided, fall back to sort the rundowns by their name:
			const rundownsInPlaylist = Rundowns.find({
				playlistExternalId: playlist.externalId
			}, {
				sort: {
					name: 1
				}
			}).fetch()
			order = _.object(rundownsInPlaylist.map((i, index) => [i._id, index + 1]))
		}

		return {
			rundownPlaylist: playlist,
			order: order
		}
	} else {
		// It's a rundown that "doesn't have a playlist", so we jsut make one up:
		const playlistId: RundownPlaylistId = protectString(getHash(unprotectString(currentRundown._id)))

		const existingPlaylist = RundownPlaylists.findOne(playlistId)

		const playlist = _.extend(existingPlaylist || {}, _.omit(literal<DBRundownPlaylist>({
			_id: playlistId,
			externalId: currentRundown.externalId,
			studioId: studio._id,
			name: currentRundown.name,
			expectedStart: currentRundown.expectedStart,
			expectedDuration: currentRundown.expectedDuration,

			created: existingPlaylist ? existingPlaylist.created : getCurrentTime(),
			modified: getCurrentTime(),

			peripheralDeviceId: peripheralDevice ? peripheralDevice._id : protectString(''),

			currentPartInstanceId: null,
			nextPartInstanceId: null,
			previousPartInstanceId: null
		}), [ 'currentPartInstanceId', 'nextPartInstanceId', 'previousPartInstanceId' ])) as DBRundownPlaylist

		return {
			rundownPlaylist: playlist,
			order: _.object([[currentRundown._id, 1]])
		}
	}
}

/**
 * Removes Segments from the database
 * @param rundownId The Rundown id to remove from
 * @param segmentIds The Segment ids to be removed
 */
export function removeSegments (rundownId: RundownId, segmentIds: SegmentId[]): number {
	logger.debug('removeSegments', rundownId, segmentIds)
	const count = Segments.remove({
		_id: { $in: segmentIds },
		rundownId: rundownId
	})
	if (count > 0) {
		afterRemoveSegments(rundownId, segmentIds)
	}
	return count
}
/**
 * After Segments have been removed, handle the contents.
 * This will trigger an update of the timeline
 * @param rundownId Id of the Rundown
 * @param segmentIds Id of the Segments
 */
export function afterRemoveSegments (rundownId: RundownId, segmentIds: SegmentId[]) {
	// Remove the parts:
	saveIntoDb(Parts, {
		rundownId: rundownId,
		segmentId: { $in: segmentIds }
	},[],{
		afterRemoveAll (parts) {
			afterRemoveParts(rundownId, parts)
		}
	})
}

/**
 * After Parts have been removed, handle the contents.
 * This will NOT trigger an update of the timeline
 * @param rundownId Id of the Rundown
 * @param removedParts The parts that have been removed
 */
export function afterRemoveParts (rundownId: RundownId, removedParts: DBPart[]) {
	saveIntoDb(Parts, {
		rundownId: rundownId,
		dynamicallyInserted: true,
		afterPart: { $in: _.map(removedParts, p => p._id) }
	}, [], {
		afterRemoveAll (parts) {
			// Do the same for any affected dynamicallyInserted Parts
			afterRemoveParts(rundownId, parts)
		}
	})

	// Clean up all the db parts that belong to the removed Parts
	Pieces.remove({
		rundownId: rundownId,
		startPartId: { $in: _.map(removedParts, p => p._id) }
	})
	AdLibPieces.remove({
		rundownId: rundownId,
		partId: { $in: _.map(removedParts, p => p._id) }
	})
	_.each(removedParts, part => {
		// TODO - batch?
		updateExpectedMediaItemsOnPart(part.rundownId, part._id)
	})
}
/**
 * Update the ranks of all parts.
 * Uses the ranks to determine order within segments, and then updates part ranks based on segment ranks.
 * Adlib/dynamic parts get assigned ranks based on the rank of what they are told to be after
 * @param rundownId
 */
export function updatePartRanks (rundown: Rundown, segmentIds: SegmentId[]) {
	// TODO-PartInstance this will need to consider partInstances that have no backing part at some point
	// It should be a simple toggle to work on instances instead though. As it only changes the dynamic inserted ones it should be nice and safe
	// Make sure to rethink the sorting, especially with regards to reset vs non-reset (as reset may have outdated ranks etc)

	const pSegmentsAndParts = rundown.getSegmentsAndParts(segmentIds)

	const { segments, parts: orgParts } = waitForPromise(pSegmentsAndParts)

	logger.debug(`updatePartRanks (${orgParts.length} parts, ${segments.length} segments)`)

	const ps: Array<Promise<any>> = []
	_.each(segments, segment => {
		const parts = _.filter(orgParts, p => p.segmentId === segment._id)
		const dynamicParts = _.filter(parts, p => !!p.dynamicallyInserted)

		if (dynamicParts.length) {
			// We have parts that need updating
			const sortedParts = _.filter(parts, p => !p.dynamicallyInserted)

			// Build the parts into an sorted array
			let remainingParts = dynamicParts
			let hasAddedAnything = true
			while (hasAddedAnything) {
				hasAddedAnything = false

				const newRemainingParts: Part[] = []
				_.each(remainingParts, possiblePart => {
					const afterIndex = sortedParts.findIndex(p => p._id === possiblePart.afterPart)
					if (afterIndex !== -1) {
						// We found the one before
						sortedParts.splice(afterIndex + 1, 0, possiblePart)
						hasAddedAnything = true
					} else {
						newRemainingParts.push(possiblePart)
					}
				})
				remainingParts = newRemainingParts
			}

			if (remainingParts.length) {
				// TODO - remainingParts are invalid and should be deleted/warned about
			}

			// Now go through and update their ranks
			for(let i = 0; i < sortedParts.length - 1;) {
				// Find the range to process this iteration
				const beforePartIndex = i;
				const afterPartIndex = sortedParts.findIndex((p, o) => o > i && !!p.dynamicallyInserted)

				if (afterPartIndex === beforePartIndex + 1) {
					// no dynamic parts in between
					i++
					continue
				} else if (afterPartIndex === -1) { 
					// We will reach the end, so make sure we stop
					i = sortedParts.length
				} else {
					// next iteration should look from the next fixed point
					i = afterPartIndex
				}

				const firstDynamicIndex = beforePartIndex + 1
				const lastDynamicIndex = afterPartIndex === -1 ? sortedParts.length : afterPartIndex - 1

				// Calculate the rank change per part
				const dynamicPartCount = lastDynamicIndex - firstDynamicIndex + 1
				const basePartRank = sortedParts[beforePartIndex]._rank
				const afterPartRank = afterPartIndex === -1 ? basePartRank + 1 : sortedParts[afterPartIndex]._rank
				const delta = (afterPartRank - basePartRank) / dynamicPartCount

				let prevRank = basePartRank
				for (let o = firstDynamicIndex; o <= lastDynamicIndex; o++) {
					const newRank = prevRank = prevRank + delta
					
					const dynamicPart = sortedParts[o]
					if (dynamicPart._rank !== newRank) {
						ps.push(asyncCollectionUpdate(Parts, dynamicPart._id, { $set: { _rank: newRank } }))
						ps.push(asyncCollectionUpdate(PartInstances, {
							'part._id': dynamicPart._id,
							reset: { $ne: true }
						}, { $set: { 'part._rank': newRank } }))
						ps.push(asyncCollectionUpdate(Pieces, { startPartId: dynamicPart._id }, { $set: { startPartRank: newRank } }))
					}
				}
			}
			
		}
	})
	waitForPromiseAll(ps)
	logger.debug(`updatePartRanks: ${ps.length} parts updated`)
}

export namespace ServerRundownAPI {
	/** Remove a RundownPlaylist and all its contents */
	export function removeRundownPlaylist (playlistId: RundownPlaylistId) {
		check(playlistId, String)
		logger.info('removeRundownPlaylist ' + playlistId)

		const playlist = RundownPlaylists.findOne(playlistId)
		if (!playlist) throw new Meteor.Error(404, `RundownPlaylist "${playlistId}" not found!`)
		if (playlist.active) throw new Meteor.Error(400,`Not allowed to remove an active RundownPlaylist "${playlistId}".`)

		playlist.remove()
	}
	/** Remove an individual rundown */
	export function removeRundown (rundownId: RundownId) {
		check(rundownId, String)
		logger.info('removeRundown ' + rundownId)

		const rundown = Rundowns.findOne(rundownId)
		if (!rundown) throw new Meteor.Error(404, `Rundown "${rundownId}" not found!`)
		if (rundown.playlistId) {
			const playlist = RundownPlaylists.findOne(rundown.playlistId)
			if (playlist && playlist.active && playlist.currentPartInstanceId) {
				const partInstance = PartInstances.findOne(playlist.currentPartInstanceId)
				if (partInstance && partInstance.rundownId === rundown._id) {
					throw new Meteor.Error(400,`Not allowed to remove an active Rundown "${rundownId}". (active part: "${partInstance._id}" in playlist "${playlist._id}")`)
				}
			}
		}
		rundown.remove()
	}
	/** Resync all rundowns in a rundownPlaylist */
	export function resyncRundownPlaylist (playlistId: RundownPlaylistId): ReloadRundownPlaylistResponse {
		check(playlistId, String)
		logger.info('resyncRundownPlaylist ' + playlistId)

		const playlist = RundownPlaylists.findOne(playlistId)
		if (!playlist) throw new Meteor.Error(404, `RundownPlaylist "${playlistId}" not found!`)

		const response: ReloadRundownPlaylistResponse = {
			rundownsResponses: playlist.getRundowns().map(rundown => {
				return {
					rundownId: rundown._id,
					response: resyncRundown(rundown._id)
				}
			})
		}
		return response
	}
	export function resyncRundown (rundownId: RundownId): ReloadRundownResponse {
		check(rundownId, String)
		logger.info('resyncRundown ' + rundownId)

		const rundown = Rundowns.findOne(rundownId)
		if (!rundown) throw new Meteor.Error(404, `Rundown "${rundownId}" not found!`)
		// if (rundown.active) throw new Meteor.Error(400,`Not allowed to resync an active Rundown "${rundownId}".`)

		Rundowns.update(rundown._id, {
			$set: {
				unsynced: false
			}
		})

		return IngestActions.reloadRundown(rundown)
	}
	export function unsyncRundown (rundownId: RundownId): void {
		check(rundownId, String)
		logger.info('unsyncRundown ' + rundownId)

		let rundown = Rundowns.findOne(rundownId)
		if (!rundown) throw new Meteor.Error(404, `Rundown "${rundownId}" not found!`)

		Rundowns.update(rundown._id, {$set: {
			unsynced: true,
			unsyncedTime: getCurrentTime()
		}})
	}
}
export namespace ClientRundownAPI {
	export function rundownPlaylistNeedsResync (playlistId: RundownPlaylistId): string[] {
		check(playlistId, String)
		// logger.info('rundownPlaylistNeedsResync ' + playlistId)

		const playlist = RundownPlaylists.findOne(playlistId)
		if (!playlist) throw new Meteor.Error(404, `RundownPlaylist "${playlistId}" not found!`)

		const rundowns = playlist.getRundowns()
		const errors = rundowns.map(rundown => {
			if (!rundown.importVersions) return 'unknown'
	
			if (rundown.importVersions.core !== PackageInfo.version) return 'coreVersion'
	
			const showStyleVariant = ShowStyleVariants.findOne(rundown.showStyleVariantId)
			if (!showStyleVariant) return 'missing showStyleVariant'
			if (rundown.importVersions.showStyleVariant !== (showStyleVariant._rundownVersionHash || 0)) return 'showStyleVariant'
	
			const showStyleBase = ShowStyleBases.findOne(rundown.showStyleBaseId)
			if (!showStyleBase) return 'missing showStyleBase'
			if (rundown.importVersions.showStyleBase !== (showStyleBase._rundownVersionHash || 0)) return 'showStyleBase'
	
			const blueprint = Blueprints.findOne(showStyleBase.blueprintId)
			if (!blueprint) return 'missing blueprint'
			if (rundown.importVersions.blueprint !== (blueprint.blueprintVersion || 0)) return 'blueprint'
	
			const studio = Studios.findOne(rundown.studioId)
			if (!studio) return 'missing studio'
			if (rundown.importVersions.studio !== (studio._rundownVersionHash || 0)) return 'studio'
		})

		return _.compact(errors)
	}
}

class ServerRundownAPIClass implements NewRundownAPI {
	removeRundownPlaylist (playlistId: RundownPlaylistId) {
		return makePromise(() => ServerRundownAPI.removeRundownPlaylist(playlistId))
	}
	resyncRundownPlaylist (playlistId: RundownPlaylistId) {
		return makePromise(() => ServerRundownAPI.resyncRundownPlaylist(playlistId))
	}
	rundownPlaylistNeedsResync (playlistId: RundownPlaylistId) {
		return makePromise(() => ClientRundownAPI.rundownPlaylistNeedsResync(playlistId))
	}
	removeRundown (rundownId: RundownId) {
		return makePromise(() => ServerRundownAPI.removeRundown(rundownId))
	}
	resyncRundown (rundownId: RundownId) {
		return makePromise(() => ServerRundownAPI.resyncRundown(rundownId))
	}
	unsyncRundown (rundownId: RundownId) {
		return makePromise(() => ServerRundownAPI.unsyncRundown(rundownId))
	}
}
registerClassToMeteorMethods(RundownAPIMethods, ServerRundownAPIClass, false)
