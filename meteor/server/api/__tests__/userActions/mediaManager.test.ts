import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { testInFiber, testInFiberOnly } from '../../../../__mocks__/helpers/jest'
import { protectString, getCurrentTime } from '../../../../lib/lib'
import { setupDefaultStudioEnvironment, DefaultEnvironment } from '../../../../__mocks__/helpers/database'
import { ClientAPI } from '../../../../lib/api/client'
import { MediaWorkFlows } from '../../../../lib/collections/MediaWorkFlows'
import { PeripheralDeviceCommands } from '../../../../lib/collections/PeripheralDeviceCommands'
import { PeripheralDevices } from '../../../../lib/collections/PeripheralDevices'

require('../../client') // include in order to create the Meteor methods needed
require('../../userActions') // include in order to create the Meteor methods needed

namespace UserActionAPI {
	// Using our own method definition, to catch external API changes
	export enum methods {
		'mediaRestartWorkflow' = 'userAction.mediamanager.restartWorkflow',
		'mediaAbortWorkflow' = 'userAction.mediamanager.abortWorkflow',
		'mediaRestartAllWorkflows' = 'userAction.mediamanager.restartAllWorkflows',
		'mediaAbortAllWorkflows' = 'userAction.mediamanager.abortAllWorkflows',
		'mediaPrioritizeWorkflow' = 'userAction.mediamanager.mediaPrioritizeWorkflow',
	}
}

describe('User Actions - Media Manager', () => {
	let env: DefaultEnvironment
	function setupMockWorkFlow(env: DefaultEnvironment) {
		const workFlowId = protectString(Random.id())
		const workFlow = {
			_id: workFlowId,
			_rev: '',
			created: getCurrentTime(),
			deviceId: env.ingestDevice._id,
			finished: false,
			priority: 1,
			source: '',
			studioId: env.studio._id,
			success: false,
		}
		MediaWorkFlows.insert(workFlow)

		return { workFlow, workFlowId }
	}
	beforeEach(() => {
		// clean up old peripheral devices and MediaWorkFlows
		PeripheralDevices.remove({
			_id: {
				$exists: true,
			},
		})
		MediaWorkFlows.remove({
			_id: {
				$exists: true,
			},
		})
		env = setupDefaultStudioEnvironment()
		jest.resetAllMocks()
	})
	testInFiber('Restart workflow', async () => {
		const { workFlowId } = setupMockWorkFlow(env)
		{
			// should fail if the workflow doesn't exist
			expect(() => {
				Meteor.call(
					UserActionAPI.methods.mediaRestartWorkflow,
					'',
					'FAKE_ID'
				) as ClientAPI.ClientResponseSuccess<void>
			}).toThrowError(/not found/gi)
		}

		{
			// should execute function on the target device
			let pResolve
			const p = new Promise((resolve) => {
				pResolve = resolve
			})

			setTimeout(() => {
				const functionCall = PeripheralDeviceCommands.find({
					deviceId: env.ingestDevice._id,
					functionName: 'restartWorkflow',
				}).fetch()[0]
				expect(functionCall).toBeTruthy()
				PeripheralDeviceCommands.update(functionCall._id, {
					$set: {
						hasReply: true,
						reply: 'done',
					},
				})
				pResolve()
			}, 10)

			Meteor.call(UserActionAPI.methods.mediaRestartWorkflow, '', workFlowId)
			await p
		}
	})
	testInFiber('Abort worfklow', async () => {
		const { workFlowId } = setupMockWorkFlow(env)
		{
			// should fail if the workflow doesn't exist
			expect(() => {
				Meteor.call(UserActionAPI.methods.mediaAbortWorkflow, '', 'FAKE_ID') as ClientAPI.ClientResponseSuccess<
					void
				>
			}).toThrowError(/not found/gi)
		}

		{
			// should execute function on the target device
			let pResolve
			const p = new Promise((resolve) => {
				pResolve = resolve
			})

			setTimeout(() => {
				const functionCall = PeripheralDeviceCommands.find({
					deviceId: env.ingestDevice._id,
					functionName: 'abortWorkflow',
				}).fetch()[0]
				expect(functionCall).toBeTruthy()
				PeripheralDeviceCommands.update(functionCall._id, {
					$set: {
						hasReply: true,
						reply: 'done',
					},
				})
				pResolve()
			}, 10)

			Meteor.call(UserActionAPI.methods.mediaAbortWorkflow, '', workFlowId)
			await p
		}
	})
	testInFiber('Prioritize workflow', async () => {
		const { workFlowId } = setupMockWorkFlow(env)
		{
			// should fail if the workflow doesn't exist
			expect(() => {
				Meteor.call(
					UserActionAPI.methods.mediaPrioritizeWorkflow,
					'',
					'FAKE_ID'
				) as ClientAPI.ClientResponseSuccess<void>
			}).toThrowError(/not found/gi)
		}

		{
			// should execute function on the target device
			let pResolve
			const p = new Promise((resolve) => {
				pResolve = resolve
			})

			setTimeout(() => {
				const functionCall = PeripheralDeviceCommands.find({
					deviceId: env.ingestDevice._id,
					functionName: 'prioritizeWorkflow',
				}).fetch()[0]
				expect(functionCall).toBeTruthy()
				PeripheralDeviceCommands.update(functionCall._id, {
					$set: {
						hasReply: true,
						reply: 'done',
					},
				})
				pResolve()
			}, 10)

			Meteor.call(UserActionAPI.methods.mediaPrioritizeWorkflow, '', workFlowId)
			await p
		}
	})
	testInFiber('Restart all workflows', async () => {
		const { workFlowId } = setupMockWorkFlow(env)

		{
			// should execute function on all the target devices
			setTimeout(() => {
				const functionCalls = PeripheralDeviceCommands.find({
					functionName: 'restartAllWorkflows',
				}).fetch()
				expect(functionCalls).toHaveLength(1)
				PeripheralDeviceCommands.update(functionCalls[0]._id, {
					$set: {
						hasReply: true,
						reply: 'done',
					},
				})
			}, 10)

			Meteor.call(UserActionAPI.methods.mediaRestartAllWorkflows, '')
		}
	})
	testInFiber('Abort all workflows', async () => {
		const { workFlowId } = setupMockWorkFlow(env)

		{
			// should execute function on all the target devices
			setTimeout(() => {
				const functionCalls = PeripheralDeviceCommands.find({
					functionName: 'abortAllWorkflows',
				}).fetch()
				expect(functionCalls).toHaveLength(1)
				PeripheralDeviceCommands.update(functionCalls[0]._id, {
					$set: {
						hasReply: true,
						reply: 'done',
					},
				})
			}, 10)

			Meteor.call(UserActionAPI.methods.mediaAbortAllWorkflows, '')
		}
	})
})
