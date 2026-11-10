import { closeMaterialEditor, setDefaultContext, setTextureAdder } from './editor'
import { addProjectTexture, projectContext } from './project'
import { registerLayouts, unregisterLayouts } from './layout'
import { NODES_STYLE, NODES_STYLE_ID } from './style'
import { ensureStyle, removeStyle } from '../util/style'
import { registerMaterialUndo, unregisterMaterialUndo } from './undo'

export { openMaterialEditor } from './editor'

export function registerNodes() {
    setDefaultContext(projectContext)
    setTextureAdder(addProjectTexture)
    registerLayouts()
    registerMaterialUndo()
    ensureStyle(NODES_STYLE_ID, NODES_STYLE)
}

export function unregisterNodes() {
    closeMaterialEditor()
    unregisterMaterialUndo()
    unregisterLayouts()
    setDefaultContext(null)
    setTextureAdder(null)
    removeStyle(NODES_STYLE_ID)
}
