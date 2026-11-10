import { watchBrush } from '../brush'
import { layerNodes, primarySelectedNode } from '../elements/nodes'
import { pictureUuidsOf } from '../elements/pictures'
import { isNameplateActive, onFormatActivation, onFormatDeactivation } from '../format'
import { DESIGN_MODE, goMode, showTexture, textureOf } from '../navigate'
import { FORMAT_ID, SPRITE_TYPE } from '../model'
import { addPanelToolbar, hideCorePanels, labelDesignTab, refreshPanels, restoreCorePanels, restoreDesignTab } from './chrome'
import { registerColorsPanel } from './colors'
import { retainEvents } from './events'
import { registerLayerProperties } from './layer'
import { registerInspector } from '../inspector'
import { libraryOpenAction } from '../library/panel'
import { registerNameplatePanel } from './nameplate'
import { registerStage } from './stage'
import { STYLE, STYLE_ID } from './style'
import { pluginToolbar } from '../toolbar'
import { registerLayout } from '../layout'
import { injectStyle } from '../util/style'
import { disposeAll, disposeAllSafe, dropToolbar } from '../util/teardown'

const OUTLINER_TOOLBAR = 'polyplus_nameplate_layers'

const handles: {
    style: (() => void) | null
    listeners: Deletable[]
    cleanups: Array<() => void>
    toolbar: Toolbar | null
    library: Action | null
    ownedPicture: string
} = { style: null, listeners: [], cleanups: [], toolbar: null, library: null, ownedPicture: '' }

function inDesign(): boolean {
    return isNameplateActive() && typeof Modes !== 'undefined' && Modes.id === DESIGN_MODE
}

function onModeChange(event: any) {
    if (isNameplateActive() && event?.mode?.id === 'edit') {
        goMode('design')
        return
    }
    refreshPanels()
}

function openSelectedTexture() {
    if (!inDesign()) return
    const node = primarySelectedNode()
    if (node?.type === SPRITE_TYPE) showTexture(textureOf(node))
}

function ownsTexture(node: any, uuid: string): boolean {
    return pictureUuidsOf(node).includes(uuid)
}

function selectTextureOwner(event: any) {
    if (!inDesign()) return
    const texture = event?.texture as Texture | undefined
    if (!texture || ownsTexture(primarySelectedNode(), texture.uuid)) return
    const owner = (Outliner.elements as any[]).find((node) => node.type === SPRITE_TYPE && node.texture === texture.uuid)
    if (!owner) return
    owner.select()
}

function closeOrphanedPicture() {
    if (!inDesign()) return
    const texture = Texture.selected
    const owned = !!texture && layerNodes().some((node) => ownsTexture(node, texture.uuid))
    const orphaned = !!texture && !owned && texture.uuid === handles.ownedPicture
    handles.ownedPicture = owned ? texture.uuid : ''
    if (!orphaned || primarySelectedNode()) return
    unselectTextures()
    refreshPanels()
}

function outlinerToolbar(): Toolbar {
    return pluginToolbar(OUTLINER_TOOLBAR, {
        name: 'Nameplate Layers',
        condition: { formats: [FORMAT_ID], modes: [DESIGN_MODE, 'animate'] },
        children: [
            'polyplus_nameplate_add_body',
            'polyplus_nameplate_add_sprite',
            'polyplus_nameplate_add_effect',
            'polyplus_nameplate_add_path',
            'polyplus_nameplate_add_emitter',
            'polyplus_nameplate_add_group',
            '_',
            'polyplus_nameplate_library_open',
        ],
    })
}

export function registerDesign() {
    if (handles.style) return

    handles.style = injectStyle(STYLE_ID, STYLE)

    handles.library = libraryOpenAction()
    const toolbar = outlinerToolbar()
    handles.toolbar = toolbar
    const registrations = [
        retainEvents,
        watchBrush,
        registerStage,
        registerColorsPanel,
        registerLayerProperties,
        registerInspector,
        registerNameplatePanel,
        () => addPanelToolbar('outliner', toolbar, 'outliner'),
        registerLayout,
        () => onFormatActivation(() => {
            labelDesignTab()
            refreshPanels()
        }),
        () => onFormatDeactivation(() => {
            restoreDesignTab()
            refreshPanels()
        }),
    ]
    for (const register of registrations) handles.cleanups.push(register())
    hideCorePanels()
    const events: [keyof BlockbenchEventMap, (event: any) => void][] = [
        ['select_mode', onModeChange],
        ['update_selection', openSelectedTexture],
        ['select_texture', selectTextureOwner],
        ['update_selection', closeOrphanedPicture],
        ['select_texture', closeOrphanedPicture],
        ['finished_edit', closeOrphanedPicture],
    ]
    for (const [name, listener] of events) handles.listeners.push(Blockbench.on(name, listener))
    if (isNameplateActive()) {
        labelDesignTab()
        if (Modes.edit) goMode('design')
    }
    refreshPanels()
}

export function unregisterDesign() {
    if (!handles.style) return
    disposeAll(handles.listeners)
    restoreDesignTab()
    restoreCorePanels()
    disposeAllSafe(handles.cleanups, 'design unregistration failed', true)
    if (handles.toolbar) dropToolbar(handles.toolbar)
    handles.toolbar = null
    handles.library?.delete()
    handles.library = null
    handles.style()
    handles.style = null
}
