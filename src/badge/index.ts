import { defineNameTextType, NameTextType } from '../elements/classes'
import { isNameTextNode, isPinnedNode, NAME_TEXT_TYPE, nameTextNode, rootNodes } from '../elements/nodes'
import { deleteSelectedLayers } from '../elements/pictures'
import { isNameplateActive } from '../format'
import { BADGE_TYPE } from '../model'
import { selectInspectorTarget } from '../inspector/selection'
import { ensurePlateNode, isPlateNode, plateNode } from '../plate'
import { createPinned, knownUuid } from '../plate/pinned'
import { BadgeType, defineBadgeType } from './element'
import { disposeAll } from '../util/teardown'
import { badgeNode, isBadgeNode } from './node'
import { hasProject } from '../util/project'

export { BADGE_CHANNELS, BADGE_NAME } from './element'
export { badgeNode, isBadgeNode } from './node'

const ADD_LABEL = 'Add PolyPlus badge'
const ADD_NAME_LABEL = 'Add name text row'
const NAME_PINNED_MESSAGE = 'The name text can\'t be deleted. Style it in the Inspector.'
const BADGE_PINNED_MESSAGE = 'The badge can\'t be deleted. To hide it, add a Visible keyframe on its row in Animate. The reviewer then sees a warning.'
const PLATE_PINNED_MESSAGE = 'The Whole nameplate row can\'t be deleted. If you don\'t need it, leave it empty.'
const PINNED_MESSAGE_MS = 6000
const ANIMATE_DELETE_MESSAGE = 'Layers can only be deleted on the Design tab.'
const SETUP_EVENTS = ['select_project', 'setup_project', 'new_project', 'load_project', 'select_mode']
const ORDER_EVENTS = ['finished_edit', 'undo', 'redo']

let badgeType: BadgeType | null = null
let nameType: NameTextType | null = null
let pendingRow: ReturnType<typeof setTimeout> | null = null
let pendingPinned: ReturnType<typeof setTimeout> | null = null
const listeners: Deletable[] = []

export function ensureBadgeNode(): any | null {
    return badgeNode() ?? createPinned(BADGE_TYPE, ADD_LABEL, nameTextNode() ? 1 : 0, knownUuid(BADGE_TYPE))
}

export function ensureNameTextNode(): any | null {
    return nameTextNode() ?? createPinned(NAME_TEXT_TYPE, ADD_NAME_LABEL, 0)
}

function pinTop() {
    if (!isNameplateActive() || typeof Outliner === 'undefined') return
    const name = nameTextNode()
    const badge = badgeNode()
    const wanted = [name, badge, plateNode()].filter((node) => !!node)
    const root = rootNodes()
    if (wanted.every((node, index) => root[index] === node)) return
    try {
        wanted.forEach((node, index) => node.addTo('root', index))
    } catch (error) {
        console.error('[polyplus_nameplate] could not keep the pinned rows at the top', error)
    }
}

function ensurePinned() {
    if (!isNameplateActive() || !hasProject()) return
    ensureNameTextNode()
    ensureBadgeNode()
    ensurePlateNode()
    pinTop()
}

function queuePinned() {
    if (pendingPinned) clearTimeout(pendingPinned)
    pendingPinned = setTimeout(() => {
        pendingPinned = null
        ensurePinned()
    }, 0)
}

function queueBadgeRow() {
    if (pendingRow) clearTimeout(pendingRow)
    pendingRow = setTimeout(() => {
        pendingRow = null
        showBadgeRow()
    }, 0)
}

function showBadgeRow() {
    if (!isNameplateActive() || typeof Modes === 'undefined' || !Modes.animate) return
    const animation = BBAnimation.selected
    const node = ensureBadgeNode()
    if (!animation || !node) return
    try {
        ;(animation.getBoneAnimator(node) as any)?.addToTimeline?.(true)
    } catch (error) {
        console.error('[polyplus_nameplate] could not show the badge row', error)
    }
}

function showPinnedMessage(nodes: any[]) {
    const pinned = nodes.filter(isPinnedNode)
    const parts = [pinned.some(isNameTextNode) ? NAME_PINNED_MESSAGE : '', pinned.some(isBadgeNode) ? BADGE_PINNED_MESSAGE : '', pinned.some(isPlateNode) ? PLATE_PINNED_MESSAGE : '']
    Blockbench.showQuickMessage(parts.filter(Boolean).join(' '), PINNED_MESSAGE_MS)
}

function guardDelete(): Deletable | null {
    if (typeof SharedActions === 'undefined') return null
    return SharedActions.add('delete', {
        subject: 'nameplate_pinned',
        priority: -0.5,
        condition: () => isNameplateActive() && (Modes.edit || Modes.paint) && (Outliner.selected as any[]).some(isPinnedNode),
        run(event: Event) {
            const picked = (Outliner.selected as any[]).slice()
            for (const node of picked) if (isPinnedNode(node)) node.unselect()
            const rest = (Outliner.selected as any[]).length > 0 || !!Group.first_selected
            if (rest) deleteSelectedLayers(event)
            else showPinnedMessage(picked)
        },
    } as any)
}

function hintDeleteInAnimate(): Deletable | null {
    if (typeof SharedActions === 'undefined') return null
    return SharedActions.add('delete', {
        subject: 'nameplate_animate',
        priority: -1,
        condition: () => {
            if (!isNameplateActive() || !Modes.animate || Prop.active_panel !== 'outliner') return false
            return (Outliner.selected as any[]).length > 0 || !!Group.first_selected
        },
        run() {
            const selected = Outliner.selected as any[]
            if (selected.length > 0 && selected.every(isPinnedNode)) showPinnedMessage(selected)
            else Blockbench.showQuickMessage(ANIMATE_DELETE_MESSAGE, 2500)
        },
    } as any)
}

export function registerBadge() {
    if (badgeType) return
    badgeType = defineBadgeType([
        { name: 'Badge look...', icon: 'format_color_text', click: () => selectInspectorTarget('badge') },
    ])
    ;(badgeType.type as any).behavior = { ...(OutlinerElement as any).behavior, parent_types: ['root'] }
    try {
        nameType = defineNameTextType(NAME_TEXT_TYPE, [
            { name: 'Name text look...', icon: 'format_color_text', click: () => selectInspectorTarget('name') },
        ])
    } catch (error) {
        console.error('[polyplus_nameplate] name text row registration failed', error)
    }
    for (const guard of [guardDelete(), hintDeleteInAnimate()]) if (guard) listeners.push(guard)
    listeners.push(
        Blockbench.on('select_mode', queueBadgeRow),
        Blockbench.on('select_animation', queueBadgeRow),
        ...SETUP_EVENTS.map((name) => Blockbench.on(name as any, queuePinned)),
        ...ORDER_EVENTS.map((name) => Blockbench.on(name as any, pinTop)),
    )
    queuePinned()
}

export function unregisterBadge() {
    if (pendingRow) clearTimeout(pendingRow)
    pendingRow = null
    if (pendingPinned) clearTimeout(pendingPinned)
    pendingPinned = null
    disposeAll(listeners)
    nameType?.dispose()
    nameType = null
    badgeType?.dispose()
    badgeType = null
}
