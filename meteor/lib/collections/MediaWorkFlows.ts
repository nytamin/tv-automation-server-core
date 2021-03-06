import { TransformedCollection } from '../typings/meteor'
import { registerCollection, Time, ProtectedString } from '../lib'
import { Meteor } from 'meteor/meteor'
import { createMongoCollection } from './lib'
import { StudioId } from './Studios'
import { PeripheralDeviceId } from './PeripheralDevices'
import { MediaManagerAPI } from '../api/mediaManager'
import { registerIndex } from '../database'

/** A string, identifying a MediaWorkFlow */
export type MediaWorkFlowId = ProtectedString<'MediaWorkFlowId'>

export interface MediaWorkFlow {
	_id: MediaWorkFlowId
	_rev: string

	name?: string
	/** A secondary name, some kind of a comment about the workFlow */
	comment?: string

	/** Which device this workflow originated from */
	deviceId: PeripheralDeviceId
	studioId: StudioId

	source: string
	/** Id of the expectedMedia Item */
	expectedMediaItemId?: string[]
	mediaObjectId?: string
	created: Time

	priority: number

	finished: boolean
	success: boolean
}

export const MediaWorkFlows: TransformedCollection<MediaWorkFlow, MediaWorkFlow> = createMongoCollection<MediaWorkFlow>(
	'mediaWorkFlows'
)
registerCollection('MediaWorkFlows', MediaWorkFlows)
registerIndex(MediaWorkFlows, {
	// TODO: add deviceId: 1,
	mediaObjectId: 1,
})
registerIndex(MediaWorkFlows, {
	finished: 1,
	success: 1,
	priority: 1,
})
