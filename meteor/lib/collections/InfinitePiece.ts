import { RundownAPI } from '../api/rundown'
import { TransformedCollection } from '../typings/meteor'
import { PartTimings, PartId } from './Parts'
import { registerCollection, ProtectedString, ProtectedStringProperties, Omit } from '../lib'
import { Meteor } from 'meteor/meteor'
import {
	IBlueprintInfinitePiece,
	IBlueprintPieceGeneric,
	IBlueprintPieceDB,
	BaseContent,
	Timeline,
	InfiniteMode
} from 'tv-automation-sofie-blueprints-integration'
import { createMongoCollection } from './lib'
import { RundownId } from './Rundowns'
import { SegmentId } from './Segments';
import { PieceGeneric } from './Pieces';
import { PartInstanceId } from './PartInstances';

/** A string, identifying a Piece */
export type InfinitePieceId = ProtectedString<'InfinitePieceId'>

export interface InfinitePiece {
	_id: InfinitePieceId

	/** The rundown this piece belongs to */
	startRundownId: RundownId
	startRundownRank: number

    startSegmentId: SegmentId
	startSegmentRank: number
	
	startPartId: PartId
	startPartRank: number

	/** If this was inserted via an adlib, then we start on a part instance too */
	startPartInstanceId?: PartInstanceId // TODO - or perhaps this collection should be cloned for this variant?
	
	// TODO - do we need stopped or can we handle that intelligently?

	/** The piece to be infinite */
	piece: InfinitePieceInner
}

export interface InfinitePieceInner extends PieceGeneric, IBlueprintInfinitePiece {
	partId: undefined

	/** The object describing the piece in detail */
	content?: BaseContent // TODO: Temporary, should be put into IBlueprintPiece
}

export const InfinitePieces: TransformedCollection<InfinitePiece, InfinitePiece> = createMongoCollection<InfinitePiece>('infinitePieces')
registerCollection('InfinitePieces', InfinitePieces)
Meteor.startup(() => {
	if (Meteor.isServer) {
		InfinitePieces._ensureIndex({
			startRundownId: 1,
			mode: 1
		})
	}
})
