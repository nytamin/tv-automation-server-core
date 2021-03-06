import { Meteor } from 'meteor/meteor'
import * as _ from 'underscore'
import { logger } from './logging'
import { PeripheralDeviceAPI } from './api/peripheralDevice'
import { systemTime } from './lib'
import { MeteorCall } from './api/methods'

if (Meteor.isServer) {
	// handled in systemTime
} else {
	// fetch time from server:
	let updateDiffTime = () => {
		let sentTime = Date.now()
		MeteorCall.peripheralDevice
			.getTimeDiff()
			.then((stat) => {
				let replyTime = Date.now()
				let diffTime = (sentTime + replyTime) / 2 - stat.currentTime

				systemTime.diff = diffTime
				systemTime.stdDev = Math.abs(sentTime - replyTime) / 2
				logger.debug(
					'time diff to server: ' +
						systemTime.diff +
						'ms (stdDev: ' +
						Math.floor(systemTime.stdDev * 10) / 10 +
						'ms)'
				)
				if (!stat.good) {
					Meteor.setTimeout(() => {
						updateDiffTime()
					}, 20 * 1000)
				} else if (!stat.good || systemTime.stdDev > 50) {
					Meteor.setTimeout(() => {
						updateDiffTime()
					}, 2000)
				}
			})
			.catch((err) => {
				logger.error(err)
			})
	}

	Meteor.startup(() => {
		Meteor.setInterval(() => {
			updateDiffTime()
		}, 3600 * 1000)
		updateDiffTime()
		// Meteor.setTimeout(() => {
		// 	updateDiffTime()
		// }, 2000)
	})
}
