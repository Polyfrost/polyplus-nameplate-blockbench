import { addToMenu, defineAction, disposeMenuBarAction } from '../util/actions'
import { disposeAll, disposeAllSafe } from '../util/teardown'
import { refreshChecks, scheduleChecks, stopChecks } from './checks'
import { openColors } from './colors'
import { COSMETIC_FORMATS, CosmeticKind } from './data'
import { openReactions, openSettings } from './dialogs'
import { exportCosmetic } from './export'
import { registerCosmeticImport } from './import'
import { cosmeticFormatIds, KIND_SPECS, newCosmeticProject, registerCosmeticFormats, unregisterCosmeticFormats } from './formats'
import { registerCosmeticPanel, syncCosmeticPanel, unregisterCosmeticPanel } from './panel'
import { stopDuo } from './duoPreview'
import { stopPetPlay } from './petPreview'
import { stopLive } from './livePreview'
import { applyPreview, clearPreview } from './preview'
import { INDEX_PIXELS_PROPERTY, INDEX_PROPERTY, PALETTE_PROPERTY, RIG_PROPERTY, SPRING_PROPERTY } from './project'
import { openSpringDialog } from './springDialog'
import { cosmeticState, isCosmeticActive, seedReferences } from './state'
import { registerTextureGuard } from './textureGuard'
import { KIND_REGISTRATIONS } from './kinds'

type Undo = () => void

const EDIT_EVENTS = ['finish_edit', 'undo', 'redo', 'add_animation', 'update_keyframe_selection', 'finished_edit']
const SWITCH_EVENTS = ['select_project', 'select_mode']
const LEAVE_EVENTS = ['unselect_project', 'close_project']

const undos: Undo[] = []
const newActions: Array<[Action, string]> = []

function formatAction(id: string, name: string, icon: string, click: () => void, description: string): Action {
    return defineAction(id, { name, icon, click, description, category: 'edit', condition: () => isCosmeticActive() })
}

function registerNewActions() {
    for (const kind of Object.keys(KIND_SPECS) as CosmeticKind[]) {
        const spec = KIND_SPECS[kind]!
        const action = defineAction(`polyplus_cosmetic_new_${kind}`, {
            name: `New ${spec.name}`,
            description: spec.description,
            icon: spec.icon,
            click: () => {
                newCosmeticProject(kind)
            },
        }, 'file')
        newActions.push([action, 'file'])
    }
}

export function registerCosmetics() {
    const properties = [
        new Property(Group, 'object', SPRING_PROPERTY, { default: { enabled: false } }),
        new Property(Texture, 'boolean', PALETTE_PROPERTY, { default: false }),
        new Property(Texture, 'string', INDEX_PROPERTY, { default: '' }),
        new Property(Texture, 'string', INDEX_PIXELS_PROPERTY, { default: '' }),
        new Property(Group, 'boolean', RIG_PROPERTY, { default: false }),
        new Property(Cube, 'boolean', RIG_PROPERTY, { default: false }),
    ]
    undos.push(() => disposeAll(properties))
    cosmeticState.register()
    undos.push(() => cosmeticState.unregister())
    registerCosmeticFormats()
    undos.push(unregisterCosmeticFormats)
    registerNewActions()
    undos.push(() => {
        for (const [action, path] of newActions.splice(0)) disposeMenuBarAction(action, path)
    })
    const actions = [
        formatAction('polyplus_cosmetic_settings', 'Cosmetic Settings', 'settings', () => openSettings(), 'ID, attach point and controllers'),
        formatAction('polyplus_cosmetic_reactions', 'Reactions', 'bolt', () => openReactions(), 'What the cosmetic does when its wearer does something'),
        formatAction('polyplus_cosmetic_spring', 'Spring Settings', 'waves', () => openSpringDialog(), 'Make the selected groups swing'),
        formatAction('polyplus_cosmetic_colors', 'Palette Colors', 'palette', () => openColors(), 'Colors, colorways and palette painting'),
        formatAction('polyplus_cosmetic_export', 'Export Cosmetic', 'archive', () => void exportCosmetic(), 'Export the cosmetic zip for PolyPlus'),
    ]
    undos.push(() => disposeAll(actions))
    undos.push(addToMenu((Group.prototype as any).menu, actions[2], '', 'group menu'))
    undos.push(addToMenu((MenuBar as any).menus?.file, actions[4], 'export', 'export menu'))
    undos.push(registerCosmeticImport())
    for (const registration of KIND_REGISTRATIONS) undos.push(registration())
    registerCosmeticPanel()
    undos.push(unregisterCosmeticPanel)
    undos.push(registerTextureGuard())
    const listeners = [
        ...EDIT_EVENTS.map((name) => Blockbench.on(name as any, () => {
            if (isCosmeticActive()) scheduleChecks()
        })),
        ...SWITCH_EVENTS.map((name) => Blockbench.on(name as any, () => {
            if (!isCosmeticActive()) {
                stopLive()
                stopDuo()
                stopPetPlay()
                clearPreview()
                return
            }
            syncCosmeticPanel()
            applyPreview()
            refreshChecks()
        })),
        ...LEAVE_EVENTS.map((name) => Blockbench.on(name as any, () => {
            stopLive()
            stopDuo()
            stopPetPlay()
            clearPreview()
        })),
    ]
    undos.push(() => disposeAll(listeners))
    const parsed = Codecs.project.on('parsed', () => {
        seedReferences()
    })
    undos.push(() => parsed.delete())
    undos.push(cosmeticState.on(scheduleChecks))
    undos.push(stopChecks, clearPreview, () => stopLive(), () => stopDuo(), () => stopPetPlay())
}

export function unregisterCosmetics() {
    disposeAllSafe(undos.splice(0).reverse(), 'unregistering cosmetics failed')
}

export { COSMETIC_FORMATS, cosmeticFormatIds }
