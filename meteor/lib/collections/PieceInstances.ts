import { TransformedCollection } from '../typings/meteor'
import { registerCollection, literal, ProtectedString, ProtectedStringProperties, protectString, Omit } from '../lib'
import { Meteor } from 'meteor/meteor'
import { IBlueprintPieceInstance, Time, IBlueprintResolvedPieceInstance, PieceLifespan } from 'tv-automation-sofie-blueprints-integration'
import { createMongoCollection } from './lib'
import { Piece, PieceId } from './Pieces'
import { PartInstance, PartInstanceId } from './PartInstances'
import { RundownId } from './Rundowns'

/** A string, identifying a PieceInstance */
export type PieceInstanceId = ProtectedString<'PieceInstanceId'>
export function unprotectPieceInstance (pieceInstance: PieceInstance): IBlueprintPieceInstance
export function unprotectPieceInstance (pieceInstance: PieceInstance | undefined): IBlueprintPieceInstance | undefined
export function unprotectPieceInstance (pieceInstance: PieceInstance | undefined): IBlueprintPieceInstance | undefined {
	return pieceInstance as any
}

export interface PieceInstance extends ProtectedStringProperties<Omit<IBlueprintPieceInstance, 'piece'>, '_id'> {
	/** Whether this PieceInstance is a temprorary wrapping of a Piece */
	readonly isTemporary?: boolean

	_id: PieceInstanceId
	/** The rundown this piece belongs to */
	rundownId: RundownId
	/** The part instace this piece belongs to */
	partInstanceId: PartInstanceId

	piece: Piece

	/** Only set when this pieceInstance is an infinite. It contains info about the infinite */
	infinite?: {
		infinitePieceId: PieceId
		// lifespan: PieceLifespan // In case the original piece gets destroyed/mutated? // TODO - is this wanted?
		// TODO - more properties?
	}
}

export interface ResolvedPieceInstance extends PieceInstance, Omit<IBlueprintResolvedPieceInstance, '_id' | 'piece'> {
	piece: Piece
}

export function wrapPieceToTemporaryInstance (piece: Piece, partInstanceId: PartInstanceId): PieceInstance {
	return literal<PieceInstance>({
		isTemporary: true,
		_id: protectString(`${piece._id}_tmp_instance`),
		rundownId: piece.startRundownId,
		partInstanceId: partInstanceId,
		piece: piece
	})
}

export function wrapPieceToInstance (piece: Piece, partInstanceId: PartInstanceId): PieceInstance {
	return {
		_id: protectString(`${partInstanceId}_${piece._id}`),
		rundownId: piece.startRundownId,
		partInstanceId: partInstanceId,
		piece: piece
	}
}

export const PieceInstances: TransformedCollection<PieceInstance, PieceInstance> = createMongoCollection<PieceInstance>('pieceInstances')
registerCollection('PieceInstances', PieceInstances)
Meteor.startup(() => {
	if (Meteor.isServer) {
		PieceInstances._ensureIndex({
			rundownId: 1,
			partInstanceId: 1
		})
	}
})
