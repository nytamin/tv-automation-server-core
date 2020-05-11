import { ControllerAbstract, LONGPRESS_TIME } from './lib'
import { PrompterViewInner } from '../PrompterView'

const LOCALSTORAGE_MODE = 'prompter-controller-arrowkeys'

/**
 * This class handles control of the prompter using Keyboard keys sent from a contour shuttle
 * Up: shift + control + alt + [1-7]
 * Down: shift + control + alt + [1-7]
 * Supports Up / Down arrow keys
 * Supports Left / Right arrow keys
 * Supports Page-up / Page-down keys
 */
export class ShuttleKeyboardController extends ControllerAbstract {

	private _destroyed: boolean = false
	private _prompterView: PrompterViewInner

	private static readonly _speedMap = [0, 1, 2, 3, 5, 7, 9, 30]
	private static readonly _speedStepMap = [...ShuttleKeyboardController._speedMap.slice(1).reverse().map(i => i * -1), ...ShuttleKeyboardController._speedMap.slice()]
	private static readonly SPEEDMAP_NEUTRAL_POSITION = 7

	private _updateSpeedHandle: number | null = null
	private _lastSpeed = 0
	private _lastSpeedMapPosition = ShuttleKeyboardController.SPEEDMAP_NEUTRAL_POSITION
	private _currentPosition = 0

	constructor (view: PrompterViewInner) {
		super(view)

		this._prompterView = view
	}
	public destroy () {
		this._destroyed = true
	}
	public onKeyDown (e: KeyboardEvent) {
		let speed = -1
		let newSpeedStep = this._lastSpeedMapPosition
		let inverse = false

		// contour mode needs ctrl + alt + number to work
		// filter on ctrl and alt, fail early
		if (e.ctrlKey && e.altKey) {
			// pause if Digit9 (shuttle centred)
			if (e.shiftKey && e.code === 'Digit9') {
				speed = 0
			}
			switch (e.code) {
				case 'F1':
					speed = ShuttleKeyboardController._speedMap[1]
					break
				case 'F2':
					speed = ShuttleKeyboardController._speedMap[2]
					break
				case 'F3':
					speed = ShuttleKeyboardController._speedMap[3]
					break
				case 'F4':
					speed = ShuttleKeyboardController._speedMap[4]
					break
				case 'F5':
					speed = ShuttleKeyboardController._speedMap[5]
					break
				case 'F6':
					speed = ShuttleKeyboardController._speedMap[6]
					break
				case 'F7':
					speed = ShuttleKeyboardController._speedMap[7]
					break
			}
			switch (e.key) {
				case '-':
					newSpeedStep--
					newSpeedStep = Math.max(0, Math.min(newSpeedStep, ShuttleKeyboardController._speedStepMap.length - 1))
					this._lastSpeedMapPosition = newSpeedStep
					speed = ShuttleKeyboardController._speedStepMap[this._lastSpeedMapPosition]
					if (speed < 0) {
						inverse = true
					}
					speed = Math.abs(speed)
					break
				case '+':
					newSpeedStep++
					newSpeedStep = Math.max(0, Math.min(newSpeedStep, ShuttleKeyboardController._speedStepMap.length - 1))
					this._lastSpeedMapPosition = newSpeedStep
					speed = ShuttleKeyboardController._speedStepMap[this._lastSpeedMapPosition]
					if (speed < 0) {
						inverse = true
					}
					speed = Math.abs(speed)
					break
			}

			// buttons
			if (e.shiftKey) {
				switch (e.code) {
					case 'PageDown':
					case 'F8':
						// jump to next segment
						this._lastSpeed = 0
						this._lastSpeedMapPosition = ShuttleKeyboardController.SPEEDMAP_NEUTRAL_POSITION
						this._prompterView.scrollToFollowing()
						return
					case 'PageUp':
					case 'F9':
						// jump to previous segment
						this._lastSpeed = 0
						this._lastSpeedMapPosition = ShuttleKeyboardController.SPEEDMAP_NEUTRAL_POSITION
						this._prompterView.scrollToPrevious()
						return
					case 'F10':
						// jump to top
						this._lastSpeed = 0
						this._lastSpeedMapPosition = ShuttleKeyboardController.SPEEDMAP_NEUTRAL_POSITION
						window.scrollTo(0, 0)
						return
					case 'F11':
						// jump to live
						this._lastSpeed = 0
						this._lastSpeedMapPosition = ShuttleKeyboardController.SPEEDMAP_NEUTRAL_POSITION
						this._prompterView.scrollToLive()
						return
					case 'F12':
						// jump to next
						this._lastSpeed = 0
						this._lastSpeedMapPosition = ShuttleKeyboardController.SPEEDMAP_NEUTRAL_POSITION
						this._prompterView.scrollToNext()
						return
				}
			}
		}

		// return on false key events
		if (speed === -1) {
			return
		} else {
			// handle valid key inputs
			e.preventDefault()

			// reverse direction if shiftkey is pressed
			if (e.shiftKey || inverse) {
				speed *= -1
			}
		}


		// update flag for comparison on next iteration
		this._lastSpeed = speed
		this._updateScrollPosition()
	}
	public onKeyUp (e: KeyboardEvent) {
		// Nothing
	}
	public onMouseKeyDown (e: MouseEvent) {
		// Nothing
	}
	public onMouseKeyUp (e: MouseEvent) {
		// Nothing
	}
	public onWheel (e: WheelEvent) {
		// Nothing
	}

	private _updateScrollPosition () {
		if (this._updateSpeedHandle !== null) return
		this._updateSpeedHandle = null

		// update scroll position
		window.scrollBy(0, this._lastSpeed)

		let scrollPosition = window.scrollY
		// check for reached end-of-scroll:
		if (this._currentPosition !== undefined && scrollPosition !== undefined) {
			if (this._currentPosition === scrollPosition) {
				// We tried to move, but haven't
				this._lastSpeed = 0
				this._lastSpeedMapPosition = ShuttleKeyboardController.SPEEDMAP_NEUTRAL_POSITION
			}
			this._currentPosition = scrollPosition
		}

		// create recursive loop
		if (this._lastSpeed !== 0) {
			this._updateSpeedHandle = window.requestAnimationFrame(() => {
				this._updateSpeedHandle = null
				this._updateScrollPosition()
			})
		}
	}
}
