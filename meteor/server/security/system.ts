import { Meteor } from 'meteor/meteor'
import * as _ from 'underscore'
import { Users, UserId } from '../../lib/collections/Users'
import { CoreSystem } from '../../lib/collections/CoreSystem'
import { Credentials, resolveCredentials } from './lib/credentials'
import { logNotAllowed, allowOnlyFields } from './lib/lib'
import { allowAccessToCoreSystem, allowAccessToCurrentUser, allowAccessToOrganization, allowAccessToSystemStatus } from './lib/security'
import { Settings } from '../../lib/Settings'
import { triggerWriteAccess } from './lib/securityVerify'

export namespace SystemReadAccess {
	/** Handles read access for all organization content (segments, parts, pieces etc..) */
	export function coreSystem (cred: Credentials): boolean {
		const access = allowAccessToCoreSystem(cred)
		if (!access.read) return logNotAllowed('CoreSystem', access.reason)

		return true
	}
	export function currentUser (userId: UserId, cred: Credentials): boolean {
		const access = allowAccessToCurrentUser(cred, userId)
		if (!access.read) return logNotAllowed('Current user', access.reason)

		return true
	}
}
export namespace SystemWriteAccess {
	// These functions throws if access is not allowed.

	export function coreSystem (cred0: Credentials) {
		triggerWriteAccess()
		if (!Settings.enableUserAccounts) return true

		const cred = resolveCredentials(cred0)
		if (!cred.user) throw new Meteor.Error(403, `Not logged in`)
		if (!cred.organization) throw new Meteor.Error(500, `User has no organization`)
		const access = allowAccessToCoreSystem(cred)
		if (!access.update) throw new Meteor.Error(403, `Not allowed: ${access.reason}`)

		return true
	}
	export function migrations (cred0: Credentials) {
		return coreSystem(cred0)
	}
	export function system (cred0: Credentials) {
		return coreSystem(cred0)
	}
	export function systemStatusRead (cred0: Credentials) {
		// For reading only
		triggerWriteAccess()
		const access = allowAccessToSystemStatus(cred0)
		if (!access.read) throw new Meteor.Error(403, `Not allowed: ${access.reason}`)

		return true
	}
}
CoreSystem.allow({
	insert (): boolean {
		return false
	},
	update (userId, doc, fields, modifier) {
		const access = allowAccessToCoreSystem({ userId: userId })
		if (!access.update) return logNotAllowed('CoreSystem', access.reason)
		return allowOnlyFields(doc, fields, [
			'support', 'systemInfo', 'name'
		])
	},
	remove () {
		return false
	}
})
Users.allow({
	insert (userId, doc) {
		return false
	},
	update (userId, doc, fields, modifier) {
		return false
	},
	remove (userId, doc) {
		return false
	}
})
