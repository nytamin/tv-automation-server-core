import * as _ from 'underscore'
import { Meteor } from 'meteor/meteor'
import { getHash, formatDateAsTimecode, formatDurationAsTimecode, unprotectString, unprotectObject, unprotectObjectArray, protectString, assertNever, protectStringArray, getCurrentTime, unprotectStringArray, normalizeArray } from '../../../../lib/lib'
import { DBPart, PartId } from '../../../../lib/collections/Parts'
import { check, Match } from 'meteor/check'
import { logger } from '../../../../lib/logging'
import {
	ICommonContext,
	NotesContext as INotesContext,
	ShowStyleContext as IShowStyleContext,
	RundownContext as IRundownContext,
	SegmentContext as ISegmentContext,
	EventContext as IEventContext,
	AsRunEventContext as IAsRunEventContext,
	PartEventContext as IPartEventContext,
	ActionExecutionContext as IActionExecutionContext,
	IStudioConfigContext,
	ConfigItemValue,
	IStudioContext,
	BlueprintMappings,
	BlueprintRuntimeArguments,
	IBlueprintSegmentDB,
	IngestRundown,
	IngestPart,
	IBlueprintPartInstance,
	IBlueprintPieceInstance,
	IBlueprintPartDB,
	IBlueprintRundownDB,
	IBlueprintAsRunLogEvent,
	IBlueprintPiece,
	IBlueprintPart,
	IBlueprintResolvedPieceInstance
} from 'tv-automation-sofie-blueprints-integration'
import { Studio } from '../../../../lib/collections/Studios'
import { ConfigRef, compileStudioConfig } from '../config'
import { Rundown, RundownId } from '../../../../lib/collections/Rundowns'
import { ShowStyleBase, ShowStyleBases, ShowStyleBaseId } from '../../../../lib/collections/ShowStyleBases'
import { getShowStyleCompound, ShowStyleVariantId } from '../../../../lib/collections/ShowStyleVariants'
import { AsRunLogEvent, AsRunLog } from '../../../../lib/collections/AsRunLog'
import { PartNote, NoteType, INoteBase } from '../../../../lib/api/notes'
import { loadCachedRundownData, loadIngestDataCachePart } from '../../ingest/ingestCache'
import { RundownPlaylist, RundownPlaylistId } from '../../../../lib/collections/RundownPlaylists'
import { Segment, SegmentId } from '../../../../lib/collections/Segments'
import { PieceInstances, unprotectPieceInstance, PieceInstanceId, PieceInstance } from '../../../../lib/collections/PieceInstances'
import { InternalIBlueprintPartInstance, PartInstanceId, unprotectPartInstance, PartInstance } from '../../../../lib/collections/PartInstances'
import { CacheForRundownPlaylist } from '../../../DatabaseCaches';
import { getResolvedPieces } from '../../playout/pieces';
import { postProcessPieces } from '../postProcess';
import { StudioContext, NotesContext, ShowStyleContext } from './context';

/** Actions */
export class ActionExecutionContext extends ShowStyleContext implements IActionExecutionContext {
	private readonly cache: CacheForRundownPlaylist
	private readonly rundownPlaylist: RundownPlaylist

	public currentPartChanged: boolean = false
	public nextPartChanged: boolean = false

	constructor(cache: CacheForRundownPlaylist, notesContext: NotesContext, rundownPlaylist: RundownPlaylist, rundown: Rundown) {
		super(cache.Studios.findOne(rundownPlaylist.studioId)!, rundown.showStyleBaseId, rundown.showStyleVariantId, notesContext) // TODO - better loading of studio
		this.cache = cache
		this.rundownPlaylist = rundownPlaylist
	}

	private _getPartInstanceId(part: 'current' | 'next'): PartInstanceId | null {
		switch(part) {
			case 'current':
				return this.rundownPlaylist.currentPartInstanceId
			case 'next':
				return this.rundownPlaylist.nextPartInstanceId
			default:
				assertNever(part)
				logger.warn(`Blueprint action requested unknown PartInstance "${part}"`)
				return null
		}
	}
	
	getNextShowStyleConfig (): {[key: string]: ConfigItemValue} {
		const partInstanceId = this.rundownPlaylist.nextPartInstanceId
		if (!partInstanceId) {
			throw new Error('Cannot get ShowStyle config when there is no next part')
		}

		const partInstance = this.cache.PartInstances.findOne(partInstanceId)
		const rundown = partInstance ? this.cache.Rundowns.findOne(partInstance.rundownId) : undefined
		if (!rundown) {
			throw new Error(`Failed to fetch rundown for PartInstance "${partInstanceId}"`)
		}

		const showStyleCompound = getShowStyleCompound(rundown.showStyleVariantId)
		if (!showStyleCompound) throw new Error(`Failed to compile showStyleCompound for "${rundown.showStyleVariantId}"`)

		const res: {[key: string]: ConfigItemValue} = {}
		_.each(showStyleCompound.config, (c) => {
			res[c._id] = c.value
		})
		return res
	}

	getPartInstance(part: "current" | "next"): IBlueprintPartInstance | undefined {
		const partInstanceId = this._getPartInstanceId(part)
		if (!partInstanceId) {
			return undefined
		}

		const partInstance = this.cache.PartInstances.findOne(partInstanceId)
		if (partInstance) {
			return _.clone(unprotectObject(partInstance))
		}
		return undefined
	}
	getPieceInstances(part: "current" | "next"): IBlueprintPieceInstance[] {
		const partInstanceId = this._getPartInstanceId(part)
		if (!partInstanceId) {
			return []
		}

		const pieceInstances = this.cache.PieceInstances.findFetch({ partInstanceId })
		return pieceInstances.map(piece => _.clone(unprotectObject(piece)))
	}
	getResolvedPieceInstances(part: "current" | "next"): IBlueprintResolvedPieceInstance[] {
		const partInstanceId = this._getPartInstanceId(part)
		if (!partInstanceId) {
			return []
		}

		const partInstance = this.cache.PartInstances.findOne(partInstanceId)
		if (!partInstance) {
			return []
		}

		const resolvedInstances = getResolvedPieces(this.cache, partInstance)
		return resolvedInstances.map(piece => _.clone(unprotectObject(piece)))
	}

	findLastPieceOnLayers(...sourceLayerIds: string[]): IBlueprintPieceInstance[] {
		throw new Error("Method not implemented.");
	}
	insertPiece(part: "current" | "next", piece: IBlueprintPiece): string {
		const partInstanceId = this._getPartInstanceId(part)
		if (!partInstanceId) {
			throw new Error('Cannot insert piece when no active part')
		}

		

		throw new Error("Method not implemented.");
	}
	updatePieceInstance(pieceInstanceId: string, piece: Partial<IBlueprintPiece>): void {
		throw new Error("Method not implemented.");
	}
	queuePart(part: IBlueprintPart, pieces: IBlueprintPiece[]): void {
		throw new Error("Method not implemented.");
	}
	stopPieceOnLayers(sourceLayerIds: string[], timeOffset?: number | undefined): string[] {
		if (sourceLayerIds.length == 0) {
			return []
		}
		
		return this._stopPiecesByRule(pieceInstance => sourceLayerIds.indexOf(pieceInstance.piece.sourceLayerId) !== -1, timeOffset)
	}
	stopPieceInstances(pieceInstanceIds: string[], timeOffset?: number | undefined): string[] {
		if (pieceInstanceIds.length == 0) {
			return []
		}
		
		return this._stopPiecesByRule(pieceInstance => pieceInstanceIds.indexOf(unprotectString(pieceInstance._id)) !== -1, timeOffset)
	}

	private _stopPiecesByRule(filter: (pieceInstance: PieceInstance) => boolean, timeOffset: number | undefined) {
		if (!this.rundownPlaylist.currentPartInstanceId) {
			return []
		}
		const partInstance = this.cache.PartInstances.findOne(this.rundownPlaylist.currentPartInstanceId)
		if (!partInstance) {
			throw new Error('Cannot stop pieceInstances when no current partInstance')
		}

		const changedInstances: PieceInstanceId[] = []
		
		const lastStartedPlayback = partInstance.part.getLastStartedPlayback()
		if (lastStartedPlayback === undefined) {
			throw new Error('Cannot stop pieceInstances when partInstance hasnt started playback')
		}

		const orderedPieces = getResolvedPieces(this.cache, partInstance)
		const stopAt = getCurrentTime() + (timeOffset || 0)
		const relativeStop = stopAt - lastStartedPlayback

		orderedPieces.forEach(pieceInstance => {
			if (!pieceInstance.piece.userDuration && filter(pieceInstance)) {
				let newExpectedDuration: number | undefined = undefined

				if (pieceInstance.piece.infiniteId && pieceInstance.piece.infiniteId !== pieceInstance.piece._id) {
					newExpectedDuration = stopAt - lastStartedPlayback
				} else if (
					pieceInstance.piece.startedPlayback && // currently playing
					(pieceInstance.resolvedStart || 0) < relativeStop && // is relative, and has started
					!pieceInstance.piece.stoppedPlayback // and not yet stopped
				) {
					newExpectedDuration = stopAt - pieceInstance.piece.startedPlayback
				}

				if (newExpectedDuration !== undefined) {
					logger.info(`Blueprint action: Cropping PieceInstance "${pieceInstance._id}" to ${newExpectedDuration}`)

					this.cache.PieceInstances.update({
						_id: pieceInstance._id
					}, {
						$set: {
							'piece.userDuration': {
								duration: newExpectedDuration
							}
						}
					})

					// TODO-PartInstance - pending new data flow
					this.cache.Pieces.update({
						_id: pieceInstance.piece._id
					}, {
						$set: {
							userDuration: {
								duration: newExpectedDuration
							}
						}
					})

					changedInstances.push(pieceInstance._id)

					this.currentPartChanged = true
				}

			}
		})
		
		return unprotectStringArray(changedInstances)
	}
}