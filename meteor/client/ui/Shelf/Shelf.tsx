import * as React from 'react'
import { translate } from 'react-i18next'

import * as ClassNames from 'classnames'
import * as _ from 'underscore'
import * as mousetrap from 'mousetrap'

import * as faBars from '@fortawesome/fontawesome-free-solid/faBars'
import * as FontAwesomeIcon from '@fortawesome/react-fontawesome'

import { AdLibPanel } from './AdLibPanel'
import { GlobalAdLibPanel } from './GlobalAdLibPanel'
import { Translated } from '../../lib/ReactMeteorData/ReactMeteorData'
import { SegmentUi } from '../SegmentTimeline/SegmentTimelineContainer'
import { Rundown } from '../../../lib/collections/Rundowns'
import { RundownViewKbdShortcuts } from '../RundownView'
import { HotkeyHelpPanel } from './HotkeyHelpPanel'
import { ShowStyleBase } from '../../../lib/collections/ShowStyleBases'
import { getElementDocumentOffset } from '../../utils/positions'
import { RundownLayout, RundownLayoutBase, RundownLayoutType, DashboardLayout, DashboardLayoutFilter, RundownLayoutFilter, DashboardLayoutActionButton } from '../../../lib/collections/RundownLayouts'
import { OverflowingContainer } from './OverflowingContainer'
import { UIStateStorage } from '../../lib/UIStateStorage'
import { RundownLayoutsAPI } from '../../../lib/api/rundownLayouts'
import { DashboardPanel } from './DashboardPanel'
import { ensureHasTrailingSlash } from '../../lib/lib'
import { ErrorBoundary } from '../../lib/ErrorBoundary'
import { DashboardActionButton } from './DashboardActionButton'
import { DashboardActionButtonGroup } from './DashboardActionButtonGroup'
import { IBlueprintPieceGeneric, IBlueprintAdLibPieceDB, IBlueprintPieceDB } from 'tv-automation-sofie-blueprints-integration'
import { ExternalFramePanel } from './ExternalFramePanel'
import { TimelineDashboardPanel } from './TimelineDashboardPanel'
import { ShelfRundownLayout } from './ShelfRundownLayout'
import { ShelfDashboardLayout } from './ShelfDashboardLayout'
import { Bucket } from '../../../lib/collections/Buckets'

export enum ShelfTabs {
	ADLIB = 'adlib',
	ADLIB_LAYOUT_FILTER = 'adlib_layout_filter',
	GLOBAL_ADLIB = 'global_adlib',
	SYSTEM_HOTKEYS = 'system_hotkeys'
}
export interface IShelfProps {
	isExpanded: boolean
	segments: Array<SegmentUi>
	liveSegment?: SegmentUi
	rundown: Rundown
	buckets?: Array<Bucket>
	showStyleBase: ShowStyleBase
	studioMode: boolean
	hotkeys: Array<{
		key: string
		label: string
	}>
	rundownLayout?: RundownLayoutBase
	fullViewport?: boolean

	onChangeExpanded: (value: boolean) => void
	onRegisterHotkeys: (hotkeys: Array<{
		key: string
		label: string
	}>) => void
	onChangeBottomMargin?: (newBottomMargin: string) => void
}

interface IState {
	shelfHeight: string
	overrideHeight: number | undefined
	moving: boolean
	selectedTab: string | undefined
	shouldQueue: boolean
	selectedPiece: IBlueprintPieceDB | IBlueprintAdLibPieceDB | undefined
}

const CLOSE_MARGIN = 45
export const DEFAULT_TAB = ShelfTabs.ADLIB

export class ShelfBase extends React.Component<Translated<IShelfProps>, IState> {
	private _mouseStart: {
		x: number
		y: number
	} = {
		x: 0,
		y: 0
	}
	private _mouseOffset: {
		x: number
		y: number
	} = {
		x: 0,
		y: 0
	}
	private _mouseDown: number

	private bindKeys: Array<{
		key: string
		up?: (e: KeyboardEvent) => any
		down?: (e: KeyboardEvent) => any
		label: string
		global?: boolean
	}> = []

	constructor (props: Translated<IShelfProps>) {
		super(props)

		this.state = {
			moving: false,
			shelfHeight: localStorage.getItem('rundownView.shelf.shelfHeight') || '50vh',
			overrideHeight: undefined,
			selectedTab: UIStateStorage.getItem(`rundownView.${props.rundown._id}`, 'shelfTab', undefined) as (string | undefined),
			shouldQueue: false,
			selectedPiece: undefined
		}

		const { t } = props

		this.bindKeys = [
			{
				key: RundownViewKbdShortcuts.RUNDOWN_TOGGLE_SHELF,
				up: this.keyToggleShelf,
				label: t('Toggle Shelf')
			},
			// {
			// 	key: RundownViewKbdShortcuts.RUNDOWN_RESET_FOCUS,
			// 	up: this.keyBlurActiveElement,
			// 	label: t('Escape from filter search'),
			// 	global: true
			// }
		]
	}

	componentDidMount () {
		let preventDefault = (e) => {
			e.preventDefault()
			e.stopImmediatePropagation()
			e.stopPropagation()
		}
		_.each(this.bindKeys, (k) => {
			const method = k.global ? mousetrap.bindGlobal : mousetrap.bind
			if (k.up) {
				method(k.key, (e: KeyboardEvent) => {
					preventDefault(e)
					if (k.up) k.up(e)
				}, 'keyup')
				method(k.key, (e: KeyboardEvent) => {
					preventDefault(e)
				}, 'keydown')
			}
			if (k.down) {
				method(k.key, (e: KeyboardEvent) => {
					preventDefault(e)
					if (k.down) k.down(e)
				}, 'keydown')
			}
		})

		this.props.onRegisterHotkeys(this.bindKeys)
		this.restoreDefaultTab()
	}

	componentWillUnmount () {
		_.each(this.bindKeys, (k) => {
			if (k.up) {
				mousetrap.unbind(k.key, 'keyup')
				mousetrap.unbind(k.key, 'keydown')
			}
			if (k.down) {
				mousetrap.unbind(k.key, 'keydown')
			}
		})
	}

	componentDidUpdate (prevProps: IShelfProps, prevState: IState) {
		if ((prevProps.isExpanded !== this.props.isExpanded) || (prevState.shelfHeight !== this.state.shelfHeight)) {
			if (this.props.onChangeBottomMargin && typeof this.props.onChangeBottomMargin === 'function') {
				// console.log(this.state.expanded, this.getHeight())
				this.props.onChangeBottomMargin(this.getHeight() || '0px')
			}
		}

		this.restoreDefaultTab()
	}

	restoreDefaultTab () {
		if (this.state.selectedTab === undefined && this.props.rundownLayout && RundownLayoutsAPI.isRundownLayout(this.props.rundownLayout)) {
			const defaultTab = this.props.rundownLayout.filters.find(i => (i as RundownLayoutFilter).default)
			if (defaultTab) {
				this.setState({
					selectedTab: `${ShelfTabs.ADLIB_LAYOUT_FILTER}_${defaultTab._id}`
				})
			}
		}
	}

	getHeight (): string {
		const top = parseFloat(this.state.shelfHeight.substr(0, this.state.shelfHeight.length - 2))
		return this.props.isExpanded ? (100 - top).toString() + 'vh' : '0px'
	}

	getTop (newState?: boolean): string | undefined {
		return this.state.overrideHeight ?
			((this.state.overrideHeight / window.innerHeight) * 100) + 'vh' :
			((newState !== undefined ? newState : this.props.isExpanded) ?
				this.state.shelfHeight
				:
				undefined)
	}

	getStyle () {
		return {
			'top': this.getTop(),
			'transition': this.state.moving ? '' : '0.5s top ease-out'
		}
	}

	keyBlurActiveElement = () => {
		this.blurActiveElement()
	}

	keyToggleShelf = () => {
		this.toggleShelf()
	}

	blurActiveElement = () => {
		try {
			// @ts-ignore
			document.activeElement.blur()
		} catch (e) {
			// do nothing
		}
	}

	toggleShelf = () => {
		this.blurActiveElement()
		this.props.onChangeExpanded(!this.props.isExpanded)
	}

	dropHandle = (e: MouseEvent) => {
		document.removeEventListener('mouseup', this.dropHandle)
		document.removeEventListener('mouseleave', this.dropHandle)
		document.removeEventListener('mousemove', this.dragHandle)

		let stateChange = {
			moving: false,
			overrideHeight: undefined
		}

		let shouldBeExpanded: boolean = false

		if (Date.now() - this._mouseDown > 350) {
			if (this.state.overrideHeight && (window.innerHeight - this.state.overrideHeight > CLOSE_MARGIN)) {
				stateChange = _.extend(stateChange, {
					shelfHeight: (Math.max(0.1, 0, this.state.overrideHeight / window.innerHeight) * 100) + 'vh',
				})
				shouldBeExpanded = true
			} else {
				shouldBeExpanded = false
			}
		} else {
			shouldBeExpanded = !this.props.isExpanded
		}

		this.setState(stateChange)
		this.props.onChangeExpanded(shouldBeExpanded)
		this.blurActiveElement()

		localStorage.setItem('rundownView.shelf.shelfHeight', this.state.shelfHeight)
	}

	dragHandle = (e: MouseEvent) => {
		this.setState({
			overrideHeight: e.clientY - this._mouseOffset.y
		})
	}

	grabHandle = (e: React.MouseEvent<HTMLDivElement>) => {
		document.addEventListener('mouseup', this.dropHandle)
		document.addEventListener('mouseleave', this.dropHandle)
		document.addEventListener('mousemove', this.dragHandle)

		this._mouseStart.x = e.clientX
		this._mouseStart.y = e.clientY

		const handlePosition = getElementDocumentOffset(e.currentTarget)
		if (handlePosition) {
			this._mouseOffset.x = (handlePosition.left - window.scrollX) - this._mouseStart.x
			this._mouseOffset.y = (handlePosition.top - window.scrollY) - this._mouseStart.y
		}

		this._mouseDown = Date.now()

		this.setState({
			moving: true
		})
	}

	switchTab = (tab: string) => {
		this.setState({
			selectedTab: tab
		})

		UIStateStorage.setItem(`rundownView.${this.props.rundown._id}`, 'shelfTab', tab)
	}

	selectPiece = (piece: IBlueprintAdLibPieceDB | IBlueprintPieceDB) => {
		this.setState({
			selectedPiece: piece
		})
	}

	changeQueueAdLib = (shouldQueue: boolean, e: any) => {
		this.setState({
			shouldQueue
		})
	}

	render () {
		const { t, fullViewport } = this.props
		return (
			<div className={ClassNames('rundown-view__shelf dark', {
				'full-viewport': fullViewport
			})} style={fullViewport ? undefined : this.getStyle()}>
				{ !fullViewport && <div className='rundown-view__shelf__handle dark' tabIndex={0} onMouseDown={this.grabHandle}>
					<FontAwesomeIcon icon={faBars} />
				</div>}
				<ErrorBoundary>
				{
					(this.props.rundownLayout && RundownLayoutsAPI.isRundownLayout(this.props.rundownLayout)) ?
						<ShelfRundownLayout
							rundown={this.props.rundown}
							showStyleBase={this.props.showStyleBase}
							studioMode={this.props.studioMode}
							hotkeys={this.props.hotkeys}
							rundownLayout={this.props.rundownLayout}
							selectedTab={this.state.selectedTab}
							selectedPiece={this.state.selectedPiece}
							onSelectPiece={this.selectPiece}
							onSwitchTab={this.switchTab}
							/> :
					(this.props.rundownLayout && RundownLayoutsAPI.isDashboardLayout(this.props.rundownLayout)) ?
						<ShelfDashboardLayout
							rundown={this.props.rundown}
							showStyleBase={this.props.showStyleBase}
							studioMode={this.props.studioMode}
							rundownLayout={this.props.rundownLayout}
							shouldQueue={this.state.shouldQueue}
							onChangeQueueAdLib={this.changeQueueAdLib}
							/> :
						// ultimate fallback if not found
						<ShelfRundownLayout
							rundown={this.props.rundown}
							showStyleBase={this.props.showStyleBase}
							studioMode={this.props.studioMode}
							hotkeys={this.props.hotkeys}
							rundownLayout={undefined}
							selectedTab={this.state.selectedTab}
							selectedPiece={this.state.selectedPiece}
							onSelectPiece={this.selectPiece}
							onSwitchTab={this.switchTab}
							/>
				}
				</ErrorBoundary>
			</div>
		)
	}
}

export const Shelf = translate(undefined, {
	withRef: true
})(ShelfBase)
