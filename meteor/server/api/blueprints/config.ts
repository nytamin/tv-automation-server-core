import * as _ from 'underscore'
import { ConfigItemValue, ConfigManifestEntry, IConfigItem } from 'tv-automation-sofie-blueprints-integration'
import { Studios, Studio, StudioId } from '../../../lib/collections/Studios'
import { Meteor } from 'meteor/meteor'
import { getShowStyleCompound, ShowStyleVariantId } from '../../../lib/collections/ShowStyleVariants'
import { protectString } from '../../../lib/lib'

/**
 * This whole ConfigRef logic will need revisiting for a multi-studio context, to ensure that there are strict boundaries across who can give to access to what.
 * Especially relevant for multi-user.
 */
export namespace ConfigRef {
	export function getStudioConfigRef (studioId: StudioId, configKey: string): string {
		return '${studio.' + studioId + '.' + configKey + '}'
	}
	export function getShowStyleConfigRef (showStyleVariantId: ShowStyleVariantId, configKey: string): string {
		return '${showStyle.' + showStyleVariantId + '.' + configKey + '}'
	}
	export function retrieveRefs (stringWithReferences: string, modifier?: (str: string) => string, bailOnError?: boolean): string {
		if (!stringWithReferences) return stringWithReferences

		const refs = stringWithReferences.match(/\$\{[^}]+\}/g) || []
		_.each(refs, (ref) => {
			if (ref) {
				let value = retrieveRef(ref, bailOnError) + ''
				if (value) {
					if (modifier) value = modifier(value)
					stringWithReferences = stringWithReferences.replace(ref, value)
				}
			}
		})
		return stringWithReferences
	}
	function retrieveRef (reference: string, bailOnError?: boolean): ConfigItemValue | string | undefined {
		if (!reference) return undefined
		let m = reference.match(/\$\{([^.}]+)\.([^.}]+)\.([^.}]+)\}/)
		if (m) {
			if (
				m[1] === 'studio' &&
				_.isString(m[2]) &&
				_.isString(m[3])
			) {
				const studioId: StudioId = protectString(m[2])
				const configId = m[3]
				const studio = Studios.findOne(studioId)
				if (studio) {
					const config = _.find(studio.config, (config) => config._id === configId)
					if (config) {
						return config.value
					} else {
						return undefined
					}
				} else if (bailOnError) throw new Meteor.Error(404,`Ref "${reference}": Studio "${studioId}" not found`)
			} else if (
				m[1] === 'showStyle' &&
				_.isString(m[2]) &&
				_.isString(m[3])
			) {
				const showStyleVariantId = protectString<ShowStyleVariantId>(m[2])
				const configId = m[3]
				const showStyleCompound = getShowStyleCompound(showStyleVariantId)
				if (showStyleCompound) {
					const config = _.find(showStyleCompound.config, (config) => config._id === configId)
					if (config) {
						return config.value
					} else {
						return undefined
					}
				} else if (bailOnError) throw new Meteor.Error(404,`Ref "${reference}": Showstyle variant "${showStyleVariantId}" not found`)
			}
		}
		return undefined
	}
}

export function compileStudioConfig (studio: Studio) {
	const res: {[key: string]: ConfigItemValue} = {}
	_.each(studio.config, (c) => {
		res[c._id] = c.value
	})

	// Expose special values as defined in the studio
	res['SofieHostURL'] = studio.settings.sofieUrl

	return res
}

export function findMissingConfigs (manifest: ConfigManifestEntry[] | undefined, config: IConfigItem[]) {
	const missingKeys: string[] = []
	if (manifest === undefined) {
		 return missingKeys
	}

	const configKeys = _.map(config, c => c._id)
	_.each(manifest, m => {
		if (m.required && configKeys.indexOf(m.id) === -1) {
			missingKeys.push(m.name)
		}
	})

	return missingKeys
}
