import { layerNodes, primarySelectedNode } from '../elements/nodes'
import { pictureUuidsOf } from '../elements/pictures'
import { isNameplateActive } from '../format'
import { FORMAT_ID } from '../model'
import { DESIGN_MODE } from '../navigate'
import { frameCountOf } from '../palette/sprites'
import { pluginToolbar } from '../toolbar'
import { addToMenu, defineAction } from '../util/actions'
import { disposeAll, dropToolbar } from '../util/teardown'

const HIDDEN_PANELS = ['color', 'palette', 'textures', 'variable_placeholders', 'bone', 'transform', 'element', 'collections']
const TEXTURE_EDITOR = 'uv'
const PICTURE_MENU = 'polyplus_nameplate_picture_menu'
const PICTURE_TOOLBAR = 'polyplus_nameplate_picture'
const CLEAR_PICTURE = 'polyplus_nameplate_clear_picture'
const SELECTION_EVENTS = ['update_selection', 'select_texture', 'update_texture_selection', 'add_texture', 'finished_edit', 'undo', 'redo']
const DESIGN_LABEL = 'Design'
const LAYERS_PANEL = 'outliner'
const PICTURE_LAYERS_PANEL = 'layers'
const PICTURE_LAYERS_LABEL = 'Picture Layers'
const LAYERS_LABEL = 'Layers'
const ELEMENT_COUNTER = 'cube_counter'

const wrapped = new Map<Panel, ConditionResolvable>()
const editor: { listeners: Deletable[], wanted: boolean | null, layered: boolean | null, action: Action | null, clear: Action | null, removeClearMenu: (() => void) | null, removeToolbar: (() => void) | null } = {
    listeners: [],
    wanted: null,
    layered: null,
    action: null,
    clear: null,
    removeClearMenu: null,
    removeToolbar: null,
}
const counter: { item: BarItem | null, original: ConditionResolvable | undefined } = { item: null, original: undefined }
let originalName: string | null = null
let originalLayersTitle: string | null = null
let originalPictureLayersTitle: string | null = null

function refreshInterface() {
    try {
        updateInterfacePanels()
    } catch (error) {
        console.error('[polyplus_nameplate] could not refresh the side panels', error)
    }
}

function textureEditorWanted(): boolean {
    const node = primarySelectedNode()
    if (node) return pictureUuidsOf(node).length > 0
    const selected = typeof Texture === 'undefined' ? undefined : Texture.selected
    if (!selected) return false
    return !layerNodes().some((entry) => pictureUuidsOf(entry).includes(selected.uuid))
}

function pictureHasLayers(): boolean {
    return typeof Texture !== 'undefined' && !!(Texture.selected as any)?.layers_enabled
}

function syncTextureEditor() {
    if (!isNameplateActive()) {
        editor.wanted = null
        editor.layered = null
        return
    }
    const wanted = textureEditorWanted()
    const layered = pictureHasLayers()
    if (wanted === editor.wanted && layered === editor.layered) return
    editor.wanted = wanted
    editor.layered = layered
    refreshInterface()
}

function hidePanel(id: string, keep: () => boolean) {
    const panel = Panels[id]
    if (!panel || wrapped.has(panel)) return
    const original = panel.condition
    wrapped.set(panel, original)
    panel.condition = ((context?: unknown) =>
        (!isNameplateActive() || keep()) && (Condition as any)(original, context)) as ConditionResolvable
}

function hideElementCounter() {
    const item = BarItems[ELEMENT_COUNTER]
    if (!item || counter.item) return
    const original = item.condition
    counter.item = item
    counter.original = original
    item.condition = ((context?: unknown) => !isNameplateActive() && (Condition as any)(original, context)) as ConditionResolvable
}

function restoreElementCounter() {
    if (counter.item) counter.item.condition = counter.original
    counter.item = null
    counter.original = undefined
}

function openPictureMenu(event?: Event) {
    const texture = typeof Texture === 'undefined' ? undefined : Texture.selected
    if (!texture) return
    ;(editor.clear as any)?.setName(clearLabel(texture))
    try {
        texture.showContextMenu(event as MouseEvent)
    } catch (error) {
        console.error('[polyplus_nameplate] could not open the picture menu', error)
    }
}

function clearLabel(texture: Texture): string {
    if ((texture as any).layers_enabled) return 'Clear layer'
    return frameCountOf(texture) > 1 ? 'Clear all frames' : 'Clear picture'
}

function clearPicture() {
    const texture = Texture.selected
    if (!texture) return
    const layer = TextureLayer.selected as any
    if (layer?.in_limbo && layer.texture === texture) layer.resolveLimbo(false)
    ;(texture as any).edit((canvas: HTMLCanvasElement, { ctx }: any) => ctx.clearRect(0, 0, canvas.width, canvas.height), { edit_name: clearLabel(texture) })
}

function addClearPicture() {
    if (editor.clear) return
    editor.clear = defineAction(CLEAR_PICTURE, {
        name: 'Clear picture',
        description: 'Erase every pixel, so you can paint from empty',
        icon: 'fa-eraser',
        category: 'textures',
        condition: () => isNameplateActive() && typeof Texture !== 'undefined' && !!Texture.selected,
        click: clearPicture,
    })
    editor.removeClearMenu = addToMenu((Texture.prototype as any).menu, editor.clear, '#apply')
}

function removeClearPicture() {
    if (!editor.clear) return
    editor.removeClearMenu?.()
    editor.removeClearMenu = null
    editor.clear.delete()
    editor.clear = null
}

function addPictureToolbar() {
    const panel = Panels[TEXTURE_EDITOR]
    if (!panel || typeof panel.addToolbar !== 'function' || editor.action) return
    editor.action = defineAction(PICTURE_MENU, {
        name: 'Picture options',
        description: 'Rename, resize, snap to palette, save to the library and other options for this picture',
        icon: 'more_horiz',
        category: 'textures',
        condition: () => isNameplateActive() && typeof Texture !== 'undefined' && !!Texture.selected,
        click: (event?: Event) => openPictureMenu(event),
    })
    const toolbar = pluginToolbar(PICTURE_TOOLBAR, {
        children: ['import_texture', PICTURE_MENU],
        condition: { formats: [FORMAT_ID] },
    } as any)
    try {
        panel.addToolbar(toolbar, 0)
    } catch (error) {
        console.error('[polyplus_nameplate] could not add the picture toolbar', error)
        return
    }
    editor.removeToolbar = () => {
        const at = panel.toolbars.indexOf(toolbar)
        if (at >= 0) panel.toolbars.splice(at, 1)
        toolbar.label_node?.remove()
        toolbar.node?.remove()
        dropToolbar(toolbar)
    }
}

export function hideCorePanels() {
    if (typeof Panels === 'undefined') return
    for (const id of HIDDEN_PANELS) hidePanel(id, () => false)
    hidePanel(TEXTURE_EDITOR, textureEditorWanted)
    hidePanel(PICTURE_LAYERS_PANEL, pictureHasLayers)
    hideElementCounter()
    addPictureToolbar()
    addClearPicture()
    if (editor.listeners.length === 0) {
        for (const name of SELECTION_EVENTS) editor.listeners.push(Blockbench.on(name as any, syncTextureEditor))
    }
}

export function restoreCorePanels() {
    disposeAll(editor.listeners)
    editor.wanted = null
    editor.removeToolbar?.()
    editor.removeToolbar = null
    editor.action?.delete()
    editor.action = null
    removeClearPicture()
    restoreElementCounter()
    for (const [panel, original] of wrapped) panel.condition = original
    wrapped.clear()
    refreshInterface()
}

export function refreshPanels() {
    editor.wanted = isNameplateActive() ? textureEditorWanted() : null
    refreshInterface()
}

function designMode(): Mode | undefined {
    return typeof Modes === 'undefined' ? undefined : Modes.options[DESIGN_MODE]
}

function redrawTabs() {
    Modes.vue?.$forceUpdate()
}

function setPanelTitle(id: string, title: string) {
    const panel = typeof Panels === 'undefined' ? undefined : (Panels[id] as any)
    if (!panel) return
    panel.name = title
    const label = panel.handle?.querySelector('span')
    if (label) label.textContent = title
}

function labelLayersPanel() {
    const panel = typeof Panels === 'undefined' ? undefined : Panels[LAYERS_PANEL]
    if (!panel) return
    if (originalLayersTitle === null) originalLayersTitle = panel.name
    setPanelTitle(LAYERS_PANEL, LAYERS_LABEL)
    const pictures = Panels[PICTURE_LAYERS_PANEL]
    if (!pictures) return
    if (originalPictureLayersTitle === null) originalPictureLayersTitle = pictures.name
    setPanelTitle(PICTURE_LAYERS_PANEL, PICTURE_LAYERS_LABEL)
}

function restoreLayersPanel() {
    if (originalLayersTitle !== null) setPanelTitle(LAYERS_PANEL, originalLayersTitle)
    if (originalPictureLayersTitle !== null) setPanelTitle(PICTURE_LAYERS_PANEL, originalPictureLayersTitle)
    originalLayersTitle = null
    originalPictureLayersTitle = null
}

export function labelDesignTab() {
    labelLayersPanel()
    const mode = designMode()
    if (!mode) return
    if (originalName === null) originalName = mode.name
    mode.name = DESIGN_LABEL
    redrawTabs()
}

export function restoreDesignTab() {
    restoreLayersPanel()
    const mode = designMode()
    if (mode && originalName !== null) mode.name = originalName
    originalName = null
    redrawTabs()
}

export function addPanelToolbar(panelId: string, toolbar: Toolbar, after?: string): () => void {
    const panel = typeof Panels === 'undefined' ? undefined : Panels[panelId]
    if (!panel || typeof panel.addToolbar !== 'function') return () => {}
    const anchored = !!after && !!panel.node?.querySelector?.(`.toolbar[toolbar_id="${after}"]`)
    try {
        if (anchored) (panel as any).addToolbar(toolbar, after)
        else panel.addToolbar(toolbar)
    } catch (error) {
        console.error(`[polyplus_nameplate] could not add a toolbar to ${panelId}`, error)
        return () => {}
    }
    return () => {
        const at = panel.toolbars.indexOf(toolbar)
        if (at >= 0) panel.toolbars.splice(at, 1)
        toolbar.label_node?.remove()
        toolbar.node?.remove()
    }
}
