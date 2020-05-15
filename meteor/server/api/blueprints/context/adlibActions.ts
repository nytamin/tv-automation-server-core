import * as _ from 'underscore'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { getHash, formatDateAsTimecode, formatDurationAsTimecode, unprotectString, unprotectObject, unprotectObjectArray, protectString, assertNever, protectStringArray, getCurrentTime, unprotectStringArray, normalizeArray, literal, getRandomId } from '../../../../lib/lib'
import { DBPart, PartId, Part } from '../../../../lib/collections/Parts'
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
import { PieceInstances, unprotectPieceInstance, PieceInstanceId, PieceInstance, wrapPieceToInstance } from '../../../../lib/collections/PieceInstances'
import { InternalIBlueprintPartInstance, PartInstanceId, unprotectPartInstance, PartInstance, wrapPartToTemporaryInstance } from '../../../../lib/collections/PartInstances'
import { CacheForRundownPlaylist } from '../../../DatabaseCaches';
import { getResolvedPieces } from '../../playout/pieces';
import { postProcessPieces } from '../postProcess';
import { StudioContext, NotesContext, ShowStyleContext } from './context';
import { setNextPart } from '../../playout/lib';
import { ServerPlayoutAdLibAPI } from '../../playout/adlib';

/** Actions */
export class ActionExecutionContext extends ShowStyleContext implements IActionExecutionContext {
	private readonly cache: CacheForRundownPlaylist
	private readonly rundownPlaylist: RundownPlaylist
	private readonly rundown: Rundown

	private queuedPartInstance: PartInstance | undefined

	public currentPartChanged: boolean = false
	public nextPartChanged: boolean = false

	constructor(cache: CacheForRundownPlaylist, notesContext: NotesContext, rundownPlaylist: RundownPlaylist, rundown: Rundown) {
		super(cache.Studios.findOne(rundownPlaylist.studioId)!, rundown.showStyleBaseId, rundown.showStyleVariantId, notesContext) // TODO - better loading of studio
		this.cache = cache
		this.rundownPlaylist = rundownPlaylist
		this.rundown = rundown
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
	
	// getNextShowStyleConfig (): {[key: string]: ConfigItemValue} {
	// 	const partInstanceId = this.rundownPlaylist.nextPartInstanceId
	// 	if (!partInstanceId) {
	// 		throw new Error('Cannot get ShowStyle config when there is no next part')
	// 	}

	// 	const partInstance = this.cache.PartInstances.findOne(partInstanceId)
	// 	const rundown = partInstance ? this.cache.Rundowns.findOne(partInstance.rundownId) : undefined
	// 	if (!rundown) {
	// 		throw new Error(`Failed to fetch rundown for PartInstance "${partInstanceId}"`)
	// 	}

	// 	const showStyleCompound = getShowStyleCompound(rundown.showStyleVariantId)
	// 	if (!showStyleCompound) throw new Error(`Failed to compile showStyleCompound for "${rundown.showStyleVariantId}"`)

	// 	const res: {[key: string]: ConfigItemValue} = {}
	// 	_.each(showStyleCompound.config, (c) => {
	// 		res[c._id] = c.value
	// 	})
	// 	return res
	// }

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

	findLastPieceOnLayer(sourceLayerId: string, originalOnly?: boolean): IBlueprintPieceInstance | undefined {
		throw new Error("Method not implemented.");
	}
	insertPiece(part: "current" | "next", rawPiece: IBlueprintPiece): string {
		const partInstanceId = this._getPartInstanceId(part)
		if (!partInstanceId) {
			throw new Error('Cannot insert piece when no active part')
		}
		
		const partInstance = this.cache.PartInstances.findOne(partInstanceId)
		if (!partInstance) {
			throw new Error('Cannot queue part when no partInstance')
		}

		const rundown = this.cache.Rundowns.findOne(partInstance.rundownId)
		if (!rundown) {
			throw new Error('Failed to find rundown of partInstance')
		}

		// TODO - ensure id does not already exist
		if (!rawPiece._id) rawPiece._id = Random.id()

		const piece = postProcessPieces(this, [rawPiece], this.getShowStyleBase().blueprintId, partInstance.rundownId, partInstance.part._id, part === 'current')[0]
		const newPieceInstance = wrapPieceToInstance(piece, partInstance._id)

		// TODO - this is very circular...
		ServerPlayoutAdLibAPI.innerStartAdLibPiece2Piece(this.cache, this.rundownPlaylist, rundown, partInstance, newPieceInstance)
		
		if (part === 'current') {
			this.currentPartChanged = true
		} else {
			this.nextPartChanged = true
		}

		return unprotectString(newPieceInstance._id)
	}
	updatePieceInstance(pieceInstanceId: string, piece: Partial<IBlueprintPiece>): void {
		throw new Error("Method not implemented.");
	}
	queuePart(rawPart: IBlueprintPart, rawPieces: IBlueprintPiece[]): void {
		const currentPartInstance = this.rundownPlaylist.currentPartInstanceId ? this.cache.PartInstances.findOne(this.rundownPlaylist.currentPartInstanceId) : undefined
		if (!currentPartInstance) {
			throw new Error('Cannot queue part when no current partInstance')
		}

		const newPartInstance = new PartInstance({
			_id: getRandomId(),
			rundownId: currentPartInstance.rundownId,
			segmentId: currentPartInstance.segmentId,
			takeCount: -1, // Filled in later
			part: new Part({
				...rawPart,
				_id: getRandomId(),
				rundownId: currentPartInstance.rundownId,
				segmentId: currentPartInstance.segmentId,
				_rank: 99999, // something high, so it will be placed after current part. The rank will be updated later to its correct value
				dynamicallyInserted: true,
				notes: [], // TODO
			})
		})

		if (!newPartInstance.part.isPlayable()) {
			throw new Error('Cannot queue a part which is not playable')
		}

		const pieces = postProcessPieces(this, rawPieces, this.getShowStyleBase().blueprintId, currentPartInstance.rundownId, newPartInstance.part._id)
		const newPieceInstances = pieces.map(piece => wrapPieceToInstance(piece, newPartInstance._id))

		// TODO - this is very circular...
		ServerPlayoutAdLibAPI.innerStartAdLibPiece2Queued(this.cache, this.rundownPlaylist, this.rundown, currentPartInstance, newPartInstance, newPieceInstances)

		this.nextPartChanged = true

		// // TODO-PartInstance - pending new data flow to insert. in future we dont want to be creating a part, only an instance
		// this.cache.Parts.insert(part)
		// pieces.forEach(piece => this.cache.Pieces.insert(piece))

		// setNextPart(this.cache, this.rundownPlaylist, newPartInstance)


		// throw new Error("Method not implemented.");
	}
	stopPiecesOnLayers(sourceLayerIds: string[], timeOffset?: number | undefined): string[] {
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