import { sanitizeLayerId, uniqueLayerId } from '../elements/ids'
import { firstBodyUuid, freeLayerName, placeNode } from '../elements/nodes'
import { readNameplate } from '../palette/state'
import { effectType } from './element'
import { instantiate, starterByKey, STARTERS } from './starters'
import { defineDesignAction } from '../util/actions'
import { dialogButtons } from '../util/dialogs'
import { commitMaterials, readMaterials } from './state'
import { MaterialsState } from './types'

export const ACTION_ADD_EFFECT = 'polyplus_nameplate_add_effect'
const EFFECT_DIALOG = 'polyplus_nameplate_effect_dialog'
export const STARTER_PREFIX = 'starter:'

export function freeMaterialId(state: MaterialsState, base: string): string {
    return uniqueLayerId(sanitizeLayerId(base), new Set(Object.keys(state.graphs)))
}

export function addStarterMaterial(state: MaterialsState, key: string): string | null {
    const starter = starterByKey(key)
    if (!starter) return null
    const id = freeMaterialId(state, starter.id)
    const made = instantiate(starter, id, readNameplate().palette.slots)
    state.graphs[id] = made.graph
    Object.assign(state.params, made.params)
    Object.assign(state.ranges, made.ranges)
    return id
}

export function materialChoices(current = ''): Record<string, string> {
    const options: Record<string, string> = {}
    const state = readMaterials()
    for (const id of Object.keys(state.graphs)) options[id] = `Graph: ${id}`
    if (current && !(current in options)) options[current] = `${current} (missing)`
    for (const starter of STARTERS) options[`${STARTER_PREFIX}${starter.key}`] = `New from starter: ${starter.name}`
    return options
}

export function addEffect(choice: string, onBody = true): any | null {
    const type = effectType()
    if (!type) return null
    const elements: any[] = []
    let created: any = null
    const ok = commitMaterials(
        'Add effect',
        (state) => {
            const starterKey = choice.startsWith(STARTER_PREFIX) ? choice.slice(STARTER_PREFIX.length) : ''
            const material = starterKey ? addStarterMaterial(state, starterKey) : choice in state.graphs ? choice : null
            if (!material) return false
            const starter = starterKey ? starterByKey(starterKey) : null
            const element = new type({
                name: freeLayerName(starter?.id ?? material),
                depth: starter?.depth ?? 'background',
                material,
                of: onBody && (starter?.wantsBody || starter?.depth !== 'behind') ? firstBodyUuid() : '',
            })
            placeNode(element)
            element.init()
            elements.push(element)
            element.select()
            created = element
        },
        { elements, outliner: true, selection: true },
    )
    return ok ? created : null
}

export function startAddEffect() {
    const options: Record<string, string> = {}
    for (const starter of STARTERS) options[`${STARTER_PREFIX}${starter.key}`] = starter.name
    for (const id of Object.keys(readMaterials().graphs)) options[id] = `Graph already in this nameplate: ${id}`
    const descriptions = STARTERS.map((starter) => `**${starter.name}**: ${starter.description}`).join('\n\n')
    const dialog: Dialog = new Dialog({
        id: EFFECT_DIALOG,
        title: 'Add Effect',
        width: 520,
        form: {
            intro: { type: 'info', text: `An effect paints light or pattern from a graph. Start from one of these, then tune it in the Inspector.\n\n${descriptions}` },
            choice: { type: 'select', label: 'Start from', options, value: `${STARTER_PREFIX}${STARTERS[0].key}` },
        },
        ...dialogButtons('Create', 'Cancel'),
        onButton(index: number) {
            if (index !== 0) return
            const result: any = dialog.getFormResult()
            addEffect(String(result.choice ?? ''))
        },
    } as any)
    dialog.show()
}

export function registerEffectActions(): () => void {
    const action = defineDesignAction(
        ACTION_ADD_EFFECT,
        {
            name: 'Add Effect',
            description: 'A glow, shimmer or sparkle',
            icon: 'auto_awesome',
            click() {
                startAddEffect()
            },
        },
        'edit',
    )
    return () => action.delete()
}
