import { Random } from 'meteor/random'
import { Meteor } from 'meteor/meteor'
import { setMeteorMethods, Methods } from '../methods'
import { BucketsAPI } from '../../lib/api/buckets'
import { Buckets, Bucket } from '../../lib/collections/Buckets'
import { literal } from '../../lib/lib'
import { ClientAPI } from '../../lib/api/client'
import { BucketSecurity } from '../security/buckets'

function createNewBucket(name: string) {
	const newBucket = literal<Bucket>({
		_id: Random.id(),
		name: name
	})

	Buckets.insert(newBucket)

	return newBucket
}

function removeBucket(id: string) {
	Buckets.remove(id)
}

let methods: Methods = {}
methods[BucketsAPI.methods.createBucket] = function (name: string) {
	check(name, String)

	return ClientAPI.responseSuccess(createNewBucket(name))
}
methods[BucketsAPI.methods.removeBucket] = function (id: string) {
	check(id, String)

	if (BucketSecurity.allowWriteAccess(this.connection.userId)) {
		removeBucket(id)
		return ClientAPI.responseSuccess()
	}
	throw new Meteor.Error(403, 'Access denied')
}
// Apply methods:
setMeteorMethods(methods)