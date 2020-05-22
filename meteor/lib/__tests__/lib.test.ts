import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { testInFiber } from '../../__mocks__/helpers/jest'
import { setLoggerLevel } from '../../server/api/logger'
import {
	getHash,
	MeteorPromiseCall,
	waitForPromise,
	getCurrentTime,
	systemTime,
	saveIntoDb,
	sumChanges,
	anythingChanged,
	literal,
	applyClassToDocument,
	formatDateAsTimecode,
	formatDurationAsTimecode,
	formatDateTime,
	removeNullyProperties,
	objectPathGet,
	objectPathSet,
	stringifyObjects,
	rateLimit,
	rateLimitAndDoItLater,
	rateLimitIgnore,
	getRank,
	partial,
	partialExceptId,
	escapeHtml,
	protectString,
	mongoFindOptions
} from '../lib'
import { Timeline, TimelineObjType, TimelineObjGeneric } from '../collections/Timeline'
import { TSR } from 'tv-automation-sofie-blueprints-integration'

// require('../../../../../server/api/ingest/mosDevice/api.ts') // include in order to create the Meteor methods needed

describe('lib/lib', () => {

	testInFiber('getHash', () => {
		const h0 = getHash('abc')
		const h1 = getHash('abcd')
		const h2 = getHash('abc')

		expect(h0).toEqual(h2)
		expect(h0).not.toEqual(h1)
	})
	testInFiber('MeteorPromiseCall', () => {
		// set up method:
		Meteor.methods({
			'myMethod': (value: any) => {
				// Do an async operation, to ensure that asynchronous operations work:
				const v = waitForPromise(new Promise(resolve => {
					setTimeout(() => {
						resolve(value)
					}, 10)
				}))
				return v
			}
		})
		const pValue: any = MeteorPromiseCall('myMethod', 'myValue').catch(e => { throw e })
		expect(pValue).toHaveProperty('then') // be a promise
		const value = waitForPromise(pValue)
		expect(value).toEqual('myValue')
	})
	testInFiber('getCurrentTime', () => {
		systemTime.diff = 5439
		expect(getCurrentTime() / 1000).toBeCloseTo((Date.now() - 5439) / 1000, 1)
	})
	testInFiber('saveIntoDb', () => {

		Timeline.insert({
			_id: protectString('abc'),
			id: 'abc',
			enable: {
				start: 0
			},
			layer: 'L1',
			content: { deviceType: TSR.DeviceType.ABSTRACT },
			objectType: TimelineObjType.MANUAL,
			studioId: protectString('myStudio'),
			classes: ['abc'] // to be removed
		})
		Timeline.insert({
			_id: protectString('abc2'),
			id: 'abc2',
			enable: {
				start: 0
			},
			layer: 'L1',
			content: { deviceType: TSR.DeviceType.ABSTRACT },
			objectType: TimelineObjType.MANUAL,
			studioId: protectString('myStudio')
		})
		Timeline.insert({
			_id: protectString('abc10'),
			id: 'abc10',
			enable: {
				start: 0
			},
			layer: 'L1',
			content: { deviceType: TSR.DeviceType.ABSTRACT },
			objectType: TimelineObjType.MANUAL,
			studioId: protectString('myStudio2')
		})

		const options = {
			beforeInsert: jest.fn((o) => o),
			beforeUpdate: jest.fn((o, pre) => o),
			beforeRemove: jest.fn((o) => o),
			beforeDiff: jest.fn((o, oldObj) => o),
			// insert: jest.fn((o) => o),
			// update: jest.fn((id, o,) => { return undefined }),
			// remove: jest.fn((o) => { return undefined }),
			afterInsert: jest.fn((o) => { return undefined }),
			afterUpdate: jest.fn((o) => { return undefined }),
			afterRemove: jest.fn((o) => { return undefined }),
		}

		const changes = saveIntoDb(Timeline, {
			studioId: protectString('myStudio')
		}, [
			{
				_id: protectString('abc'),
				id: 'abc',
				enable: {
					start: 0
				},
				layer: 'L2', // changed property
				content: { deviceType: TSR.DeviceType.ABSTRACT },
				objectType: TimelineObjType.MANUAL,
				studioId: protectString('myStudio')
			},
			{ // insert object
				_id: protectString('abc3'),
				id: 'abc3',
				enable: {
					start: 0
				},
				layer: 'L1',
				content: { deviceType: TSR.DeviceType.ABSTRACT },
				objectType: TimelineObjType.MANUAL,
				studioId: protectString('myStudio')
			}
			// remove abc2
		], options)

		expect(Timeline.find({
			studioId: protectString('myStudio')
		}).count()).toEqual(2)
		const abc = Timeline.findOne(protectString('abc')) as TimelineObjGeneric
		expect(abc).toBeTruthy()
		expect(abc.classes).toEqual(undefined)
		expect(abc.layer).toEqual('L2')

		expect(Timeline.find({
			studioId: protectString('myStudio2')
		}).count()).toEqual(1)

		expect(options.beforeInsert).toHaveBeenCalledTimes(1)
		expect(options.beforeUpdate).toHaveBeenCalledTimes(1)
		expect(options.beforeRemove).toHaveBeenCalledTimes(1)
		expect(options.beforeDiff).toHaveBeenCalledTimes(1)
		// expect(options.insert).toHaveBeenCalledTimes(1)
		// expect(options.update).toHaveBeenCalledTimes(1)
		// expect(options.remove).toHaveBeenCalledTimes(1)
		expect(options.afterInsert).toHaveBeenCalledTimes(1)
		expect(options.afterUpdate).toHaveBeenCalledTimes(1)
		expect(options.afterRemove).toHaveBeenCalledTimes(1)

		expect(changes).toMatchObject({
			added: 1,
			updated: 1,
			removed: 1
		})
		expect(sumChanges({
			added: 1,
			updated: 2,
			removed: 3
		},changes)).toMatchObject({
			added: 2,
			updated: 3,
			removed: 4
		})
	})
	testInFiber('anythingChanged', () => {
		expect(anythingChanged({
			added: 0,
			updated: 0,
			removed: 0,
		})).toBeFalsy()
		expect(anythingChanged({
			added: 1,
			updated: 0,
			removed: 0,
		})).toBeTruthy()
		expect(anythingChanged({
			added: 0,
			updated: 9,
			removed: 0,
		})).toBeTruthy()
		expect(anythingChanged({
			added: 0,
			updated: 0,
			removed: 547,
		})).toBeTruthy()
	})
	testInFiber('literal', () => {
		const obj = literal<TimelineObjGeneric>({
			_id: protectString('abc'),
			id: 'abc',
			enable: {
				start: 0
			},
			layer: 'L1',
			content: { deviceType: TSR.DeviceType.ABSTRACT },
			objectType: TimelineObjType.MANUAL,
			studioId: protectString('myStudio'),
		})
		expect(obj).toEqual({
			_id: protectString('abc'),
			id: 'abc',
			enable: {
				start: 0
			},
			layer: 'L1',
			content: { deviceType: TSR.DeviceType.ABSTRACT },
			objectType: TimelineObjType.MANUAL,
			studioId: protectString('myStudio'),
		})
		const layer: string | number = obj.layer // just to check typings
		expect(layer).toBeTruthy()
	})
	testInFiber('applyClassToDocument', () => {
		class MyClass {
			public publ: string
			private priv: string
			constructor (from) {
				Object.keys(from).forEach(key => {
					this[key] = from[key]
				})
			}
			getPriv () { return this.priv }
			getPubl () { return this.publ }
		}
		const doc = applyClassToDocument(MyClass, {
			priv: 'aaa',
			publ: 'bbb'
		})
		expect(doc.getPriv()).toEqual('aaa')
		expect(doc.getPubl()).toEqual('bbb')
	})
	testInFiber('formatDateAsTimecode', () => {
		const d = new Date('2019-01-01 13:04:15.145')
		expect(d.getMilliseconds()).toEqual(145)
		expect(formatDateAsTimecode(d)).toEqual('13:04:15:03')
	})
	testInFiber('formatDurationAsTimecode', () => {
		expect(formatDurationAsTimecode((2 * 3600 + 5 * 60 + 7) * 1000 + 500)).toEqual('02:05:07:12')
	})
	testInFiber('formatDateTime', () => {
		expect(formatDateTime(1556194064374)).toMatch(/2019-04-\d{2} \d{2}:\d{2}:\d{2}/)
	})
	testInFiber('removeNullyProperties', () => {
		expect(removeNullyProperties({
			a: 1,
			b: 2,
			c: null,
			e: undefined,
			f: {
				a: 1,
				b: 2,
				c: null,
				e: undefined
			}
		})).toEqual({
			a: 1,
			b: 2,
			e: undefined,
			f: {
				a: 1,
				b: 2,
				e: undefined
			}
		})
	})
	testInFiber('objectPathGet', () => {
		expect(objectPathGet({
			a: 1,
			b: {
				c: 1,
				d: {
					e: 2
				}
			}
		}, 'b.d.e')).toEqual(2)
	})
	testInFiber('objectPathSet', () => {
		const o: any = {
			a: 1,
			b: {
				c: 1,
				d: {
					e: 2
				}
			}
		}
		objectPathSet(o, 'b.d.f', 42)
		expect(o.b.d.f).toEqual(42)
	})
	testInFiber('stringifyObjects', () => {
		const o: any = {
			a: 1,
			b: {
				c: '1',
				d: {
					e: 2
				}
			}
		}
		expect(stringifyObjects(o)).toEqual(stringifyObjects(o))
	})
	testInFiber('rateLimit', () => {
		const f0 = jest.fn()
		const f1 = jest.fn()
		rateLimit('test', f0, f1, 500)
		rateLimit('test', f0, f1, 500)
		rateLimit('test', f0, f1, 500)
		expect(f0).toHaveBeenCalledTimes(1)
		expect(f1).toHaveBeenCalledTimes(2)
	})
	testInFiber('rateLimitAndDoItLater', () => {
		const f0 = jest.fn()
		rateLimitAndDoItLater('test', f0, 10)
		rateLimitAndDoItLater('test', f0, 10)
		rateLimitAndDoItLater('test', f0, 10)
		rateLimitAndDoItLater('test', f0, 10)
		expect(f0).toHaveBeenCalledTimes(1)
		waitForPromise(new Promise(resolve => setTimeout(resolve, 100)))
		expect(f0).toHaveBeenCalledTimes(4)
	})
	testInFiber('rateLimitIgnore', () => {
		const f0 = jest.fn()
		rateLimitIgnore('test', f0, 10)
		rateLimitIgnore('test', f0, 10)
		rateLimitIgnore('test', f0, 10)
		rateLimitIgnore('test', f0, 10)
		expect(f0).toHaveBeenCalledTimes(1)
		waitForPromise(new Promise(resolve => setTimeout(resolve, 100)))
		expect(f0).toHaveBeenCalledTimes(2)
	})
	testInFiber('mongowhere', () => {
		setLoggerLevel('debug')

		// mongoWhere is used my Collection mock
		const MyCollection = new Mongo.Collection<any>('mycollection')

		expect(MyCollection.findOne()).toBeFalsy()

		MyCollection.insert({
			_id: protectString('id0'),
			name: 'abc',
			rank: 0
		})
		MyCollection.insert({
			_id: protectString('id1'),
			name: 'abc',
			rank: 1
		})
		MyCollection.insert({
			_id: protectString('id2'),
			name: 'abcd',
			rank: 2
		})
		MyCollection.insert({
			_id: protectString('id3'),
			name: 'abcd',
			rank: 3
		})
		MyCollection.insert({
			_id: protectString('id4'),
			name: 'xyz',
			rank: 4
		})
		MyCollection.insert({
			_id: protectString('id5'),
			name: 'xyz',
			rank: 5
		})

		expect(MyCollection.find().fetch()).toHaveLength(6)

		expect(MyCollection.find({ _id: protectString('id3') }).fetch()).toHaveLength(1)
		expect(MyCollection.find({ _id: protectString('id99') }).fetch()).toHaveLength(0)

		expect(MyCollection.find({ name: 'abcd' }).fetch()).toHaveLength(2)
		expect(MyCollection.find({ name: 'xyz' }).fetch()).toHaveLength(2)
		expect(MyCollection.find({ name: { $in: ['abc', 'xyz'] } }).fetch()).toHaveLength(4)

		expect(MyCollection.find({ rank: { $gt: 2 } }).fetch()).toHaveLength(3)
		expect(MyCollection.find({ rank: { $gte: 2 } }).fetch()).toHaveLength(4)

		expect(MyCollection.find({ rank: { $lt: 3 } }).fetch()).toHaveLength(3)
		expect(MyCollection.find({ rank: { $lte: 3 } }).fetch()).toHaveLength(4)

	})
	testInFiber('getRank', () => {

		const objs: {_rank: number}[] = [
			{ _rank: 0 },
			{ _rank: 10 },
			{ _rank: 20 },
			{ _rank: 21 },
			{ _rank: 22 },
			{ _rank: 23 },
		]

		// First:
		expect(getRank(null, objs[0])).toEqual(-0.5)
		// Insert two:
		expect(getRank(null, objs[0], 0, 2)).toEqual(-0.6666666666666667)
		expect(getRank(null, objs[0], 1, 2)).toEqual(-0.33333333333333337)

		// Center:
		expect(getRank(objs[1], objs[2])).toEqual(15)
		// Insert three:
		expect(getRank(objs[1], objs[2], 0, 3)).toEqual(12.5)
		expect(getRank(objs[1], objs[2], 1, 3)).toEqual(15)
		expect(getRank(objs[1], objs[2], 2, 3)).toEqual(17.5)

		// Last:
		expect(getRank(objs[5], undefined)).toEqual(23.5)
		// Insert three:
		expect(getRank(objs[5], undefined, 0, 3)).toEqual(23.25)
		expect(getRank(objs[5], undefined, 1, 3)).toEqual(23.5)
		expect(getRank(objs[5], undefined, 2, 3)).toEqual(23.75)

		// Insert in empty list
		expect(getRank(undefined, undefined)).toEqual(0.5)

		// Insert three:
		expect(getRank(undefined, undefined, 0, 2)).toEqual(0.3333333333333333)
		expect(getRank(undefined, undefined, 1, 2)).toEqual(0.6666666666666666)

	})
	testInFiber('partial', () => {
		const o = {
			a: 1,
			b: 'asdf',
			c: {
				d: 1
			},
			e: null,
			f: undefined
		}
		expect(partial(o)).toEqual(o) // The function only affects typings
	})
	testInFiber('partialExceptId', () => {
		const o = {
			_id: protectString('myId'),
			a: 1,
			b: 'asdf',
			c: {
				d: 1
			},
			e: null,
			f: undefined,
		}
		expect(partialExceptId(o)).toEqual(o) // The function only affects typings
	})
	testInFiber('formatDateTime', () => {

		if (process.platform === 'win32') {
			// Due to a bug in how timezones are handled in Windows & Node, we just have to skip these tests when running tests locally..
			expect(0).toEqual(0)
			return
		}

		expect(new Date().getTimezoneOffset()).toBe(0) // Timezone is UTC

		expect(formatDateTime(1578295344070)).toBe('2020-01-06 07:22:24')
		expect(formatDateTime(1578389166594)).toBe('2020-01-07 09:26:06')
		expect(formatDateTime(2579299201000)).toBe('2051-09-26 00:00:01')
		expect(formatDateTime(2579299200000)).toBe('2051-09-26 00:00:00')
		expect(formatDateTime(2579299344070)).toBe('2051-09-26 00:02:24')
	})
	testInFiber('escapeHtml', () => {
		expect(escapeHtml(`<div>Hello & goodbye! Please use '"'-signs!</div>`))
		.toBe(`&lt;div&gt;Hello &amp; goodbye! Please use &#039;&quot;&#039;-signs!&lt;/div&gt;`)

	})

	describe('mongoFindOptions', () => {
		const rawDocs = [1,2,3,4,5,6,7]

		test('nothing', () => {
			expect(mongoFindOptions(rawDocs)).toEqual(rawDocs)
			expect(mongoFindOptions(rawDocs, {})).toEqual(rawDocs)
		})
		test('range', () => {
			expect(mongoFindOptions(rawDocs, { limit: 4 })).toEqual([1,2,3,4])
			expect(mongoFindOptions(rawDocs, { skip: 4 })).toEqual([5,6,7])
			expect(mongoFindOptions(rawDocs, { skip: 2, limit: 3 })).toEqual([3,4,5])
		})
		test('transform', () => {
			expect(() => mongoFindOptions(rawDocs, { transform: () => 1})).toThrowError('options.transform not implemented')
		})

		const rawDocs2 = [
			{
				_id: 1,
				val: 'a',
				val2: 'c'
			},
			{
				_id: 2,
				val: 'x',
				val2: 'c'
			},
			{
				_id: 3,
				val: 'n',
				val2: 'b'
			},
		]

		test('fields', () => {
			expect(() => mongoFindOptions(rawDocs, { fields: { val: 0, val2: 1 } })).toThrowError('options.fields cannot contain both include and exclude rules')
			expect(() => mongoFindOptions(rawDocs, { fields: { _id: 0, val2: 1 } })).not.toThrowError()
			expect(() => mongoFindOptions(rawDocs, { fields: { _id: 1, val: 0 } })).not.toThrowError()

			expect(mongoFindOptions(rawDocs2, { fields: { val: 0 } })).toEqual([
				{
					_id: 1,
					val2: 'c'
				},
				{
					_id: 2,
					val2: 'c'
				},
				{
					_id: 3,
					val2: 'b'
				},
			])
			expect(mongoFindOptions(rawDocs2, { fields: { val: 0, _id: 0 } })).toEqual([
				{
					val2: 'c'
				},
				{
					val2: 'c'
				},
				{
					val2: 'b'
				},
			])
			expect(mongoFindOptions(rawDocs2, { fields: { val: 1 } })).toEqual([
				{
					_id: 1,
					val: 'a',
				},
				{
					_id: 2,
					val: 'x',
				},
				{
					_id: 3,
					val: 'n',
				},
			])
			expect(mongoFindOptions(rawDocs2, { fields: { val: 1, _id: 0 } })).toEqual([
				{
					val: 'a',
				},
				{
					val: 'x',
				},
				{
					val: 'n',
				},
			])
		})
		
		test('fields', () => {
			expect(mongoFindOptions(rawDocs2, { sort: { val: 1 } })).toEqual([
				{
					_id: 1,
					val: 'a',
					val2: 'c'
				},
				{
					_id: 3,
					val: 'n',
					val2: 'b'
				},
				{
					_id: 2,
					val: 'x',
					val2: 'c'
				},
			])
			expect(mongoFindOptions(rawDocs2, { sort: { val: -1 } })).toEqual([
				{
					_id: 2,
					val: 'x',
					val2: 'c'
				},
				{
					_id: 3,
					val: 'n',
					val2: 'b'
				},
				{
					_id: 1,
					val: 'a',
					val2: 'c'
				},
			])

			expect(mongoFindOptions(rawDocs2, { sort: { val2: 1, val: 1 } })).toEqual([
				{
					_id: 3,
					val: 'n',
					val2: 'b'
				},
				{
					_id: 1,
					val: 'a',
					val2: 'c'
				},
				{
					_id: 2,
					val: 'x',
					val2: 'c'
				},
			])
			expect(mongoFindOptions(rawDocs2, { sort: { val2: 1, val: -1 } })).toEqual([
				{
					_id: 3,
					val: 'n',
					val2: 'b'
				},
				{
					_id: 2,
					val: 'x',
					val2: 'c'
				},
				{
					_id: 1,
					val: 'a',
					val2: 'c'
				},
			])

		})
	})
})
