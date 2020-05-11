import * as React from 'react'
import * as _ from 'underscore'
import { Translated, translateWithTracker } from '../../lib/ReactMeteorData/react-meteor-data'
import { translate } from 'react-i18next'
import { RundownPlaylist } from '../../../lib/collections/RundownPlaylists'
import { Segment } from '../../../lib/collections/Segments'
import { Part, Parts } from '../../../lib/collections/Parts'
import { Rundown } from '../../../lib/collections/Rundowns'
import { AdLibPiece } from '../../../lib/collections/AdLibPieces'
import { RundownBaselineAdLibPieces } from '../../../lib/collections/RundownBaselineAdLibPieces'
import { AdLibListItem, IAdLibListItem } from './AdLibListItem'
import * as ClassNames from 'classnames'
import { mousetrapHelper } from '../../lib/mousetrapHelper'

import * as faTh from '@fortawesome/fontawesome-free-solid/faTh'
import * as faList from '@fortawesome/fontawesome-free-solid/faList'
import * as faTimes from '@fortawesome/fontawesome-free-solid/faTimes'
import * as FontAwesomeIcon from '@fortawesome/react-fontawesome'

import { RundownViewKbdShortcuts } from '../RundownView'

import { Spinner } from '../../lib/Spinner'
import { literal, normalizeArray, unprotectString, protectString } from '../../../lib/lib'
import { RundownAPI } from '../../../lib/api/rundown'
import { MeteorReactComponent } from '../../lib/MeteorReactComponent'
import { ShowStyleBase } from '../../../lib/collections/ShowStyleBases'
import { PieceGeneric } from '../../../lib/collections/Pieces'
import { IOutputLayer, ISourceLayer } from 'tv-automation-sofie-blueprints-integration'
import { PubSub, meteorSubscribe } from '../../../lib/api/pubsub'
import { doUserAction, UserAction } from '../../lib/userAction'
import { NotificationCenter, NoticeLevel, Notification } from '../../lib/notifications/notifications'
import { ShelfInspector } from './Inspector/ShelfInspector'
import { PartInstances } from '../../../lib/collections/PartInstances'
import { AdlibSegmentUi, AdLibPieceUi } from './AdLibPanel'
import { MeteorCall } from '../../../lib/api/methods'
import { PieceUi } from '../SegmentTimeline/SegmentTimelineContainer'
import { RundownUtils } from '../../lib/rundown'

interface IListViewPropsHeader {
	onSelectAdLib: (piece: IAdLibListItem) => void
	onToggleAdLib: (piece: IAdLibListItem, queue: boolean, e: ExtendedKeyboardEvent) => void
	onToggleSticky: (item: IAdLibListItem, e: any) => void
	selectedPiece: AdLibPieceUi | PieceUi | undefined
	searchFilter: string | undefined
	showStyleBase: ShowStyleBase
	rundownAdLibs: Array<AdLibPieceUi>
	playlist: RundownPlaylist
}

interface IListViewStateHeader {
	outputLayers: {
		[key: string]: IOutputLayer
	}
	sourceLayers: {
		[key: string]: ISourceLayer
	}
}

const AdLibListView = translate()(class AdLibListView extends React.Component<Translated<IListViewPropsHeader>, IListViewStateHeader> {
	table: HTMLTableElement

	constructor(props: Translated<IListViewPropsHeader>) {
		super(props)

		this.state = {
			outputLayers: {},
			sourceLayers: {}
		}
	}

	static getDerivedStateFromProps(props: IListViewPropsHeader, state) {
		let tOLayers: {
			[key: string]: IOutputLayer
		} = {}
		let tSLayers: {
			[key: string]: ISourceLayer
		} = {}

		if (props.showStyleBase && props.showStyleBase.outputLayers && props.showStyleBase.sourceLayers) {
			props.showStyleBase.outputLayers.forEach((outputLayer) => {
				tOLayers[outputLayer._id] = outputLayer
			})
			props.showStyleBase.sourceLayers.forEach((sourceLayer) => {
				tSLayers[sourceLayer._id] = sourceLayer
			})

			return _.extend(state, {
				outputLayers: tOLayers,
				sourceLayers: tSLayers
			})
		} else {
			return state
		}
	}

	renderGlobalAdLibs() {
		const { t } = this.props
		const itemList: (IAdLibListItem &
		{
			isSticky?: boolean,
			layer?: ISourceLayer,
			sourceLayerId?: string,
			outputLayerId?: string
		})[] = []

		return (
			<tbody id={'adlib-panel__list-view__globals'} key='globals' className={ClassNames('adlib-panel__list-view__list__segment')}>
				{
					itemList.concat(this.props.rundownAdLibs).concat(this.props.showStyleBase.sourceLayers.filter(i => i.isSticky)
						.map(layer => literal<IAdLibListItem & { layer: ISourceLayer, isSticky: boolean }>({
							_id: protectString(layer._id),
							hotkey: layer.activateStickyKeyboardHotkey ? layer.activateStickyKeyboardHotkey.split(',')[0] : '',
							name: t('Last {{layerName}}', { layerName: (layer.abbreviation || layer.name) }),
							status: RundownAPI.PieceStatusCode.UNKNOWN,
							layer: layer,
							isSticky: true,
							sourceLayerId: layer._id,
							externalId: '',
							outputLayerId: ''
						})))
						.map((item) => {
							if (!item.isHidden) {
								if (item.isSticky && item.layer &&
									(!this.props.searchFilter || item.name.toUpperCase().indexOf(this.props.searchFilter.toUpperCase()) >= 0)
								) {
									return (
										<AdLibListItem
											key={unprotectString(item._id)}
											adLibListItem={item}
											selected={this.props.selectedPiece && RundownUtils.isAdLibPiece(this.props.selectedPiece) &&
												this.props.selectedPiece._id === item._id || false}
											layer={item.layer}
											onToggleAdLib={this.props.onToggleSticky}
											onSelectAdLib={this.props.onSelectAdLib}
											playlist={this.props.playlist}
										/>
									)
								} else if (item.sourceLayerId && item.outputLayerId &&
									(!this.props.searchFilter || item.name.toUpperCase().indexOf(this.props.searchFilter.toUpperCase()) >= 0)
								) {
									return (
										<AdLibListItem
											key={unprotectString(item._id)}
											adLibListItem={item}
											selected={this.props.selectedPiece && RundownUtils.isAdLibPiece(this.props.selectedPiece) &&
												this.props.selectedPiece._id === item._id || false}
											layer={this.state.sourceLayers[item.sourceLayerId]}
											outputLayer={this.state.outputLayers[item.outputLayerId]}
											onToggleAdLib={this.props.onToggleAdLib}
											onSelectAdLib={this.props.onSelectAdLib}
											playlist={this.props.playlist}
										/>
									)
								} else {
									return null
								}
							} else {
								return null
							}
						})
				}
			</tbody>
		)
	}

	setTableRef = (el) => {
		this.table = el
	}

	render() {
		return (
			<div className='adlib-panel__list-view__list adlib-panel__list-view__list--no-segments'>
				<table className='adlib-panel__list-view__list__table' ref={this.setTableRef}>
					{this.renderGlobalAdLibs()}
				</table>
				<ShelfInspector selected={this.props.selectedPiece} />
			</div>
		)
	}
})

interface IToolbarPropsHeader {
	onFilterChange?: (newFilter: string | undefined) => void
}

interface IToolbarStateHader {
	searchInputValue: string
}

const AdLibPanelToolbar = translate()(class AdLibPanelToolbar extends React.Component<Translated<IToolbarPropsHeader>, IToolbarStateHader> {
	searchInput: HTMLInputElement

	constructor(props: Translated<IToolbarPropsHeader>) {
		super(props)

		this.state = {
			searchInputValue: ''
		}
	}

	setSearchInputRef = (el: HTMLInputElement) => {
		this.searchInput = el
	}

	searchInputChanged = (e?: React.ChangeEvent<HTMLInputElement>) => {
		this.setState({
			searchInputValue: this.searchInput.value
		})

		this.props.onFilterChange && typeof this.props.onFilterChange === 'function' &&
			this.props.onFilterChange(this.searchInput.value)
	}

	clearSearchInput = () => {
		this.searchInput.value = ''

		this.searchInputChanged()
	}

	render() {
		const { t } = this.props
		return (
			<div className='adlib-panel__list-view__toolbar adlib-panel__list-view__toolbar--no-segments'>
				<div className='adlib-panel__list-view__toolbar__filter'>
					<input className='adlib-panel__list-view__toolbar__filter__input' type='text'
						ref={this.setSearchInputRef}
						placeholder={t('Search...')}
						onChange={this.searchInputChanged} />
					{this.state.searchInputValue !== '' &&
						<div className='adlib-panel__list-view__toolbar__filter__clear' onClick={this.clearSearchInput}>
							<FontAwesomeIcon icon={faTimes} />
						</div>
					}
				</div>
				<div className='adlib-panel__list-view__toolbar__buttons' style={{ 'display': 'none' }}>
					<button className='action-btn'>
						<FontAwesomeIcon icon={faList} />
					</button>
					<button className='action-btn'>
						<FontAwesomeIcon icon={faTh} />
					</button>
				</div>
			</div>
		)
	}
})

interface IProps {
	playlist: RundownPlaylist
	showStyleBase: ShowStyleBase
	visible: boolean
	studioMode: boolean
	selectedPiece: AdLibPieceUi | PieceUi | undefined

	onSelectPiece?: (piece: AdLibPieceUi | PieceUi) => void
}

interface IState {
	selectedSegment: AdlibSegmentUi | undefined
	followLive: boolean
	filter: string | undefined
}
interface ITrackedProps {
	sourceLayerLookup: { [id: string]: ISourceLayer }
	rundownAdLibs: Array<AdLibPieceUi>
	currentRundown: Rundown | undefined
}

const HOTKEY_GROUP = 'GlobalAdLibPanel'

export const GlobalAdLibPanel = translateWithTracker<IProps, IState, ITrackedProps>((props: IProps, state: IState) => {
	const sourceLayerLookup = normalizeArray(props.showStyleBase && props.showStyleBase.sourceLayers, '_id')

	// a hash to store various indices of the used hotkey lists
	let sourceHotKeyUse = {}

	let rundownAdLibs: Array<AdLibPieceUi> = []
	let currentRundown: Rundown | undefined = undefined

	const sharedHotkeyList = _.groupBy(props.showStyleBase.sourceLayers, (item) => item.activateKeyboardHotkeys)

	if (props.playlist) {
		const rundowns = props.playlist.getRundowns()
		const rMap = normalizeArray(rundowns, '_id')
		currentRundown = rundowns[0]
		const partInstanceId = props.playlist.currentPartInstanceId || props.playlist.nextPartInstanceId
		if (partInstanceId) {
			const partInstance = PartInstances.findOne(partInstanceId)
			if (partInstance) {
				currentRundown = rMap[unprotectString(partInstance.rundownId)]
			}
		}

		let rundownAdLibItems = RundownBaselineAdLibPieces.find({ rundownId: currentRundown._id }, { sort: { sourceLayerId: 1, _rank: 1 } }).fetch()
		rundownAdLibItems.forEach((item) => {
			// automatically assign hotkeys based on adLibItem index
			const uiAdLib: AdLibPieceUi = _.clone(item)
			uiAdLib.isGlobal = true

			let sourceLayer = item.sourceLayerId && sourceLayerLookup[item.sourceLayerId]
			if (sourceLayer &&
				sourceLayer.activateKeyboardHotkeys &&
				sourceLayer.assignHotkeysToGlobalAdlibs
			) {
				let keyboardHotkeysList = sourceLayer.activateKeyboardHotkeys.split(',')
				const sourceHotKeyUseLayerId = (sharedHotkeyList[sourceLayer.activateKeyboardHotkeys][0]._id) || item.sourceLayerId
				if ((sourceHotKeyUse[sourceHotKeyUseLayerId] || 0) < keyboardHotkeysList.length) {
					uiAdLib.hotkey = keyboardHotkeysList[(sourceHotKeyUse[sourceHotKeyUseLayerId] || 0)]
					// add one to the usage hash table
					sourceHotKeyUse[sourceHotKeyUseLayerId] = (sourceHotKeyUse[sourceHotKeyUseLayerId] || 0) + 1
				}
			}

			if (sourceLayer && sourceLayer.isHidden) {
				uiAdLib.isHidden = true
			}

			// always add them to the list
			rundownAdLibs.push(uiAdLib)
		})
	}

	return {
		sourceLayerLookup,
		rundownAdLibs,
		currentRundown
	}
})(class AdLibPanel extends MeteorReactComponent<Translated<IProps & ITrackedProps>, IState> {
	usedHotkeys: Array<string> = []

	constructor(props: Translated<IProps & ITrackedProps>) {
		super(props)

		this.state = {
			selectedSegment: undefined,
			filter: undefined,
			followLive: true
		}
	}

	componentDidMount() {
		this.refreshKeyboardHotkeys()

		this.autorun(() => {
			if (this.props.currentRundown) {
				this.subscribe(PubSub.rundownBaselineAdLibPieces, {
					rundownId: this.props.currentRundown._id
				})
				this.subscribe(PubSub.showStyleBases, {
					_id: this.props.currentRundown.showStyleBaseId
				})
			}
		})
	}

	componentDidUpdate(prevProps: IProps & ITrackedProps) {
		mousetrapHelper.unbindAll(this.usedHotkeys, 'keyup', HOTKEY_GROUP)
		mousetrapHelper.unbindAll(this.usedHotkeys, 'keydown', HOTKEY_GROUP)
		this.usedHotkeys.length = 0

		this.refreshKeyboardHotkeys()
	}

	componentWillUnmount() {
		this._cleanUp()
		mousetrapHelper.unbindAll(this.usedHotkeys, 'keyup', HOTKEY_GROUP)
		mousetrapHelper.unbindAll(this.usedHotkeys, 'keydown', HOTKEY_GROUP)

		this.usedHotkeys.length = 0
	}

	refreshKeyboardHotkeys() {
		if (!this.props.studioMode) return

		let preventDefault = (e) => {
			e.preventDefault()
		}

		if (this.props.rundownAdLibs) {
			this.props.rundownAdLibs.forEach((item) => {
				if (item.hotkey) {
					mousetrapHelper.bind(item.hotkey, preventDefault, 'keydown', HOTKEY_GROUP)
					mousetrapHelper.bind(item.hotkey, (e: ExtendedKeyboardEvent) => {
						preventDefault(e)
						this.onToggleAdLib(item, false, e)
					}, 'keyup', HOTKEY_GROUP)
					this.usedHotkeys.push(item.hotkey)

					const sourceLayer = this.props.sourceLayerLookup[item.sourceLayerId]
					if (sourceLayer && sourceLayer.isQueueable) {
						const queueHotkey = [RundownViewKbdShortcuts.ADLIB_QUEUE_MODIFIER, item.hotkey].join('+')
						mousetrapHelper.bind(queueHotkey, preventDefault, 'keydown', HOTKEY_GROUP)
						mousetrapHelper.bind(queueHotkey, (e: ExtendedKeyboardEvent) => {
							preventDefault(e)
							this.onToggleAdLib(item, true, e)
						}, 'keyup', HOTKEY_GROUP)
						this.usedHotkeys.push(queueHotkey)
					}
				}
			})
		}

		if (this.props.sourceLayerLookup) {

			const clearKeyboardHotkeySourceLayers: { [hotkey: string]: ISourceLayer[] } = {}

			_.each(this.props.sourceLayerLookup, (sourceLayer) => {
				if (sourceLayer.clearKeyboardHotkey) {
					sourceLayer.clearKeyboardHotkey.split(',').forEach(hotkey => {
						if (!clearKeyboardHotkeySourceLayers[hotkey]) clearKeyboardHotkeySourceLayers[hotkey] = []
						clearKeyboardHotkeySourceLayers[hotkey].push(sourceLayer)
					})
				}

				if (sourceLayer.isSticky && sourceLayer.activateStickyKeyboardHotkey) {
					sourceLayer.activateStickyKeyboardHotkey.split(',').forEach(element => {
						mousetrapHelper.bind(element, preventDefault, 'keydown', HOTKEY_GROUP)
						mousetrapHelper.bind(element, (e: ExtendedKeyboardEvent) => {
							preventDefault(e)
							this.onToggleSticky(sourceLayer._id, e)
						}, 'keyup', HOTKEY_GROUP)
						this.usedHotkeys.push(element)
					})
				}
			})

			_.each(clearKeyboardHotkeySourceLayers, (sourceLayers, hotkey) => {
				mousetrapHelper.bind(hotkey, preventDefault, 'keydown', HOTKEY_GROUP)
				mousetrapHelper.bind(hotkey, (e: ExtendedKeyboardEvent) => {
					preventDefault(e)
					this.onClearAllSourceLayers(sourceLayers, e)
				}, 'keyup', HOTKEY_GROUP)
				this.usedHotkeys.push(hotkey)
			})
		}
	}

	onFilterChange = (filter: string) => {
		this.setState({
			filter
		})
	}

	onToggleStickyItem = (item: IAdLibListItem, e: any) => {
		this.onToggleSticky(unprotectString(item._id), e)
	}

	onToggleSticky = (sourceLayerId: string, e: any) => {
		if (this.props.currentRundown && this.props.playlist.currentPartInstanceId && this.props.playlist.active) {
			const { t } = this.props
			doUserAction(t, e, UserAction.START_STICKY_PIECE, (e) => MeteorCall.userAction.sourceLayerStickyPieceStart(e, this.props.playlist._id, sourceLayerId))
		}
	}

	onSelectAdLib = (piece: AdLibPieceUi) => {
		// console.log(aSLine)
		this.props.onSelectPiece && this.props.onSelectPiece(piece)
	}

	onToggleAdLib = (adlibPiece: AdLibPieceUi, queue: boolean, e: any) => {
		const { t } = this.props

		if (adlibPiece.invalid) {
			NotificationCenter.push(new Notification(t('Invalid AdLib'), NoticeLevel.WARNING, t('Cannot play this AdLib becasue it is marked as Invalid'), 'toggleAdLib'))
			return
		}
		if (adlibPiece.floated) {
			NotificationCenter.push(new Notification(t('Floated AdLib'), NoticeLevel.WARNING, t('Cannot play this AdLib becasue it is marked as Floated'), 'toggleAdLib'))
			return
		}
		if (queue && this.props.sourceLayerLookup && this.props.sourceLayerLookup[adlibPiece.sourceLayerId] &&
			!this.props.sourceLayerLookup[adlibPiece.sourceLayerId].isQueueable) {
			console.log(`Item "${adlibPiece._id}" is on sourceLayer "${adlibPiece.sourceLayerId}" that is not queueable.`)
			return
		}

		if (this.props.playlist && this.props.playlist.currentPartInstanceId && adlibPiece.isGlobal) {
			const { t } = this.props
			const currentPartInstanceId = this.props.playlist.currentPartInstanceId
			doUserAction(t, e, UserAction.START_GLOBAL_ADLIB, (e) => MeteorCall.userAction.baselineAdLibPieceStart(e, this.props.playlist._id, currentPartInstanceId, adlibPiece._id, queue || false))
		}
	}

	onClearAllSourceLayers = (sourceLayers: ISourceLayer[], e: any) => {
		// console.log(sourceLayer)
		const { t } = this.props
		if (this.props.playlist && this.props.playlist.currentPartInstanceId) {
			const { t } = this.props
			const currentPartInstanceId = this.props.playlist.currentPartInstanceId
			doUserAction(t, e, UserAction.CLEAR_SOURCELAYER, (e) => MeteorCall.userAction.sourceLayerOnPartStop(e, this.props.playlist._id, currentPartInstanceId, sourceLayers.map(sl => sl._id)))
		}
	}

	renderListView() {
		// let a = new AdLibPanelToolbar({
		// t: () => {},
		// onFilterChange: () => { console.log('a') }
		// })
		return (
			<React.Fragment>
				<AdLibPanelToolbar
					onFilterChange={this.onFilterChange} />
				<AdLibListView
					onSelectAdLib={this.onSelectAdLib}
					onToggleAdLib={this.onToggleAdLib}
					onToggleSticky={this.onToggleStickyItem}
					selectedPiece={this.props.selectedPiece}
					showStyleBase={this.props.showStyleBase}
					rundownAdLibs={this.props.rundownAdLibs}
					searchFilter={this.state.filter}
					playlist={this.props.playlist} />
			</React.Fragment>
		)
	}

	render() {
		if (this.props.visible) {
			if (!this.props.currentRundown) {
				return <Spinner />
			} else {
				return (
					<div className='adlib-panel super-dark'>
						{this.renderListView()}
					</div>
				)
			}
		}
		return null
	}
})
