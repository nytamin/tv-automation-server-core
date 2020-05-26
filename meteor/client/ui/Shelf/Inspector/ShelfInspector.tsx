import * as React from 'react'
import * as _ from 'underscore'
import { IBlueprintPieceGeneric } from 'tv-automation-sofie-blueprints-integration'
import { IModalAttributes, Modal } from '../../../lib/ui/containers/modals/Modal'
import renderItem from './ItemRenderers/ItemRendererFactory'
import { PieceUi } from '../../SegmentTimeline/SegmentTimelineContainer'
import { AdLibPieceUi } from '../AdLibPanel'
import { ShowStyleBase } from '../../../../lib/collections/ShowStyleBases'

export { ShelfInspector }

interface IShelfInspectorProps {
	selected: AdLibPieceUi | PieceUi | undefined
	showStyleBase: ShowStyleBase
}

class ShelfInspector extends React.Component<IShelfInspectorProps> {
	constructor(props: IShelfInspectorProps) {
		super(props)
	}

	shouldComponentUpdate(nextProps: IShelfInspectorProps) {
		if (_.isEqual(nextProps, this.props)) return false
		return true
	}

	render() {
		const { selected, showStyleBase } = this.props
		const content = selected && renderItem(selected, showStyleBase)

		return (
			<div className='rundown-view__shelf__contents__pane shelf-inspector'>
				{content}
			</div>
		)
	}
}
