import * as _ from 'underscore'
import { TimelineObjGeneric, TimelineComplete } from '../../lib/collections/Timeline'
import { DBRundown, RundownImportVersions } from '../../lib/collections/Rundowns'
import { DBSegment } from '../../lib/collections/Segments'
import { Part, DBPart } from '../../lib/collections/Parts'
import { Piece } from '../../lib/collections/Pieces'
import { DBRundownPlaylist } from '../../lib/collections/RundownPlaylists'
import { PieceInstance } from '../../lib/collections/PieceInstances'
const cloneOrg = require('fast-clone')

// About snapshot testing: https://jestjs.io/docs/en/snapshot-testing

type Data =
	| undefined
	| TimelineObjGeneric
	| TimelineComplete
	| DBRundownPlaylist
	| DBRundown
	| DBSegment
	| DBPart
	| Piece
	| PieceInstance
/**
 * Remove certain fields from data that change often, so that it can be used in snapshots
 * @param data
 */
export function fixSnapshot(data: Data | Array<Data>, sortData?: boolean) {
	if (_.isArray(data)) {
		let dataArray = _.map(data, fixSnapshot)
		if (sortData) {
			dataArray.sort((a: Data, b: Data) => {
				if (!a && b) return 1
				if (a && !b) return -1

				if (!a || !b) return 0

				if (a['rank'] < b['rank']) return 1
				if (a['rank'] > b['rank']) return -1

				if (a['_id'] < b['_id']) return 1
				if (a['_id'] > b['_id']) return -1

				if (a['id'] < b['id']) return 1
				if (a['id'] > b['id']) return -1

				return 0
			})
		}
		return dataArray
	} else {
		let o = cloneOrg(data)
		if (!o) return o
		if (isTimelineObj(o)) {
			delete o['modified']
			if (o.content) {
				delete o.content['modified']
				delete o.content['objHash']
			}
			if (o.metaData && o.metaData.versions && o.metaData.versions.core) {
				// re-write the core version so something static, so tests won't fail just because the version has changed
				o.metaData.versions.core = '0.0.0-test'
			}
		} else if (isPlaylist(o)) {
			delete o['created']
			delete o['modified']
		} else if (isRundown(o)) {
			delete o['created']
			delete o['modified']
			if (o.importVersions.core) {
				// re-write the core version so something static, so tests won't fail just because the version has changed
				o.importVersions.core = '0.0.0-test'
			}
			// } else if (isPiece(o)) {
			// } else if (isPart(o)) {
			// } else if (isSegment(o)) {
			// } else if (isPieceInstance(o)) {
		} else if (isTimelineComplete(o)) {
			delete o.updated
		}
		return o
	}
}
function isTimelineComplete(o): o is TimelineComplete {
	const o2 = o as TimelineComplete
	return !!(o2.timeline && o2._id && o2.updated)
}
function isTimelineObj(o): o is TimelineObjGeneric {
	return o.enable && o._id && o.id && o.studioId
}
function isPlaylist(o): o is DBRundownPlaylist {
	return o._id && _.has(o, 'currentPartInstanceId')
}
function isRundown(o): o is DBRundown {
	return o._id && _.has(o, 'playlistId')
}
function isSegment(o): o is DBSegment {
	return o._id && _.has(o, 'rundownId') && _.has(o, 'externalId') && _.has(o, 'name')
}
function isPart(o): o is Part {
	return o._id && _.has(o, 'rundownId') && _.has(o, 'externalId') && _.has(o, 'segmentId') && _.has(o, 'title')
}
function isPiece(o): o is Piece {
	return o._id && _.has(o, 'rundownId') && _.has(o, 'externalId') && _.has(o, 'partId')
}
