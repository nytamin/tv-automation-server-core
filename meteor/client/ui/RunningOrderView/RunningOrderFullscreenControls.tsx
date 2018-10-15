import * as _ from 'underscore'
import * as React from 'react'
import * as $ from 'jquery'
import * as VelocityReact from 'velocity-react'

import Lottie from 'react-lottie'

// @ts-ignore Not recognized by Typescript
import * as Fullscreen_MouseOut from './Fullscreen_MouseOut.json'
// @ts-ignore Not recognized by Typescript
import * as Fullscreen_MouseOver from './Fullscreen_MouseOver.json'
// @ts-ignore Not recognized by Typescript
import * as Windowed_MouseOut from './Windowed_MouseOut.json'
// @ts-ignore Not recognized by Typescript
import * as Windowed_MouseOver from './Windowed_MouseOver.json'
// @ts-ignore Not recognized by Typescript
import * as On_Air_MouseOut from './On_Air_MouseOut.json'
// @ts-ignore Not recognized by Typescript
import * as On_Air_MouseOver from './On_Air_MouseOver.json'

interface IProps {
	isFollowingOnAir: boolean
	onFollowOnAir: () => void
}

interface IState {
	isFullscreen: boolean
	fullScreenHover: boolean
	onAirHover: boolean
}

export class RunningOrderFullscreenControls extends React.Component<IProps, IState> {

	throttledRefreshFullScreenState: () => void

	fullscreenOut: any
	fullscreenOver: any
	windowedOut: any
	windowedOver: any
	onAirOut: any
	onAirOver: any

	animationTemplate: any = {
		loop: false,
		autoplay: true,
		animationData: {},
		rendererSettings: {
			preserveAspectRatio: 'xMidYMid meet'
		}
	}

	constructor (props) {
		super(props)

		this.state = {
			isFullscreen: this.checkFullScreen(),
			fullScreenHover: false,
			onAirHover: false
		}

		this.fullscreenOut = _.extend(_.clone(this.animationTemplate), {
			animationData: Fullscreen_MouseOut
		})
		this.fullscreenOver = _.extend(_.clone(this.animationTemplate), {
			animationData: Fullscreen_MouseOver
		})
		this.windowedOut = _.extend(_.clone(this.animationTemplate), {
			animationData: Windowed_MouseOut
		})
		this.windowedOver = _.extend(_.clone(this.animationTemplate), {
			animationData: Windowed_MouseOver
		})
		this.onAirOut = _.extend(_.clone(this.animationTemplate), {
			animationData: On_Air_MouseOut
		})
		this.onAirOver = _.extend(_.clone(this.animationTemplate), {
			animationData: On_Air_MouseOver
		})

		this.throttledRefreshFullScreenState = _.throttle(this.refreshFullScreenState, 500)
	}

	componentDidMount () {
		$(window).on('resize', this.throttledRefreshFullScreenState)
	}

	componentWillUnmount () {
		$(window).off('resize', this.throttledRefreshFullScreenState)
	}

	checkFullScreen () {
		// @ts-ignore TypeScript doesn't have vendor-prefixed fullscreen flags
		return document.fullScreen || document.mozFullScreen || document.webkitIsFullScreen ||
				screen.height === window.innerHeight ||
				false // This will return true or false depending on if it's full screen or not.
	}

	refreshFullScreenState = () => {
		if (this.state.isFullscreen !== this.checkFullScreen()) {
			this.setState({
				isFullscreen: this.checkFullScreen()
			})
		}
	}

	requestFullscreen () {
		const docElm = document.documentElement
		if (docElm) {
			if (docElm.requestFullscreen) {
				return docElm.requestFullscreen()
				// @ts-ignore TS doesn't understand Gecko vendor prefixes
			} else if (docElm.mozRequestFullScreen) {
				// @ts-ignore TS doesn't understand Gecko vendor prefixes
				return docElm.mozRequestFullScreen()
				// @ts-ignore TS doesn't understand Gecko vendor prefixes
			} else if (docElm.webkitRequestFullScreen) {
				// @ts-ignore TS doesn't understand Webkit special/old ALLOW_KEYBOARD_INPUT
				return docElm.webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT)
			}
		}
	}

	exitFullscreen () {
		if (document.exitFullscreen) {
			return document.exitFullscreen()
			// @ts-ignore TS doesn't understand Gecko vendor prefixes
		} else if (document.mozExitFullscreen) {
			// @ts-ignore TS doesn't understand Gecko vendor prefixes
			return document.mozExitFullscreen()
			// @ts-ignore TS doesn't understand Webkit vendor prefixes
		} else if (document.webkitExitFullscreen) {
			// @ts-ignore TS doesn't understand Webkit vendor prefixes
			return document.webkitExitFullscreen()
		}
	}

	onFullscreenClick = (e: React.MouseEvent<HTMLDivElement>) => {
		// @ts-ignore TS doesn't have requestFullscreen promise
		if (!this.state.isFullscreen) {
			const promise = this.requestFullscreen()
			setTimeout(() => {
				this.setState({
					isFullscreen: this.checkFullScreen()
				})
			}, 150)
		} else {
			const promise = this.exitFullscreen()
			setTimeout(() => {
				this.setState({
					isFullscreen: this.checkFullScreen()
				})
			}, 150)
		}
	}

	onFullscreenMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
		this.setState({
			fullScreenHover: true
		})
	}

	onFullscreenMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
		this.setState({
			fullScreenHover: false
		})
	}

	onOnAirClick = (e: React.MouseEvent<HTMLDivElement>) => {
		if (typeof this.props.onFollowOnAir === 'function') {
			this.props.onFollowOnAir()
		}
	}

	onOnAirMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
		this.setState({
			onAirHover: true
		})
	}

	onOnAirMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
		this.setState({
			onAirHover: false
		})
	}

	render () {
		const { t } = this.props

		return (
			<div className='running-order__fullscreen-controls'>
				<div className='running-order__fullscreen-controls__button' onMouseEnter={this.onFullscreenMouseEnter} onMouseLeave={this.onFullscreenMouseLeave} onClick={this.onFullscreenClick} tabIndex={0}>
					{ !this.state.isFullscreen ? (this.state.fullScreenHover ?
						<Lottie options={this.windowedOver} isStopped={false} isPaused={false} /> :
						<Lottie options={this.windowedOut} isStopped={false} isPaused={false} />
					) : (this.state.fullScreenHover ?
						<Lottie options={this.fullscreenOver} isStopped={false} isPaused={false} /> :
						<Lottie options={this.fullscreenOut} isStopped={false} isPaused={false} />) }
				</div>
				<VelocityReact.VelocityTransitionGroup
					enter={{ animation: 'fadeIn', easing: 'ease-out', duration: 250 }}
					leave={{ animation: 'fadeOut', easing: 'ease-in', duration: 500 }}>
				{ !this.props.isFollowingOnAir &&
					<div className='running-order__fullscreen-controls__button' onMouseEnter={this.onOnAirMouseEnter} onMouseLeave={this.onOnAirMouseLeave} onClick={this.onOnAirClick} tabIndex={0}>
						{this.state.onAirHover ?
							<Lottie options={this.onAirOver} isStopped={false} isPaused={false} /> :
							<Lottie options={this.onAirOut} isStopped={false} isPaused={false} />}
					</div>
				}
				</VelocityReact.VelocityTransitionGroup>
			</div>
		)
	}
}