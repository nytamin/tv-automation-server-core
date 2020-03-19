import { AdLibPiece, AdLibPieceGeneric } from './AdLibPieces'
import { TransformedCollection } from '../typings/meteor'
import { registerCollection } from '../lib'
import { Meteor } from 'meteor/meteor'
import { createMongoCollection } from './lib'
import { RundownId } from './Rundowns';

export interface RundownBaselineAdLibItem extends AdLibPieceGeneric {
	/** The rundown this piece belongs to */
	rundownId: RundownId
}

export const RundownBaselineAdLibPieces: TransformedCollection<RundownBaselineAdLibItem, RundownBaselineAdLibItem>
	= createMongoCollection<RundownBaselineAdLibItem>('rundownBaselineAdLibPieces')
registerCollection('RundownBaselineAdLibPieces', RundownBaselineAdLibPieces)
Meteor.startup(() => {
	if (Meteor.isServer) {
		RundownBaselineAdLibPieces._ensureIndex({
			rundownId: 1
		})
	}
})
