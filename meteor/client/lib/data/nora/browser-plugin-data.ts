import { NoraPayload, NoraContent } from 'tv-automation-sofie-blueprints-integration'
import { InternalIBlueprintPieceGeneric } from '../../../../lib/collections/Pieces'
import { generateMosPluginItemXml } from '../../parsers/mos/mosXml2Js'

export { createMosObjectXmlStringNoraBluePrintPiece }

function createMosObjectXmlStringNoraBluePrintPiece(piece: InternalIBlueprintPieceGeneric): string {
	if (!piece.content || !piece.content.payload) {
		throw new Error('Not a Nora blueprint piece')
	}
	const noraContent = piece.content as NoraContent

	return generateMosPluginItemXml(noraContent.externalPayload)
}