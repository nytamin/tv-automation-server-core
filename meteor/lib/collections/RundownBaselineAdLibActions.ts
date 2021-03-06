import { AdLibActionCommon } from './AdLibActions'
import { TransformedCollection } from '../typings/meteor'
import { registerCollection, ProtectedString } from '../lib'
import { Meteor } from 'meteor/meteor'
import { createMongoCollection } from './lib'
import { registerIndex } from '../database'

/** A string, identifying an RundownBaselineAdLibActionId */
export type RundownBaselineAdLibActionId = ProtectedString<'RundownBaselineAdLibActionId'>

export interface RundownBaselineAdLibAction extends AdLibActionCommon {
	_id: RundownBaselineAdLibActionId
}

export const RundownBaselineAdLibActions: TransformedCollection<
	RundownBaselineAdLibAction,
	RundownBaselineAdLibAction
> = createMongoCollection<RundownBaselineAdLibAction>('rundownBaselineAdLibActions')
registerCollection('RundownBaselineAdLibActions', RundownBaselineAdLibActions)
registerIndex(RundownBaselineAdLibActions, {
	rundownId: 1,
})
