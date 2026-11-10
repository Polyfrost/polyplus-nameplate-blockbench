import { badgeNode } from '../badge/node'
import { nameTextNode, walkNodes } from '../elements/nodes'
import { isNameplateActive } from '../format'
import { PLATE_TYPE } from '../model'
import { goMode } from '../navigate'
import { definePlateType, PlateType } from './element'
import { disposeAll } from '../util/teardown'
import { createPinned, knownUuid } from './pinned'

export { PLATE_CHANNELS, PLATE_NAME } from './element'

const ADD_LABEL = 'Add Whole nameplate row'

let plateType: PlateType | null = null
let pendingRow: ReturnType<typeof setTimeout> | null = null
const listeners: Deletable[] = []

export function isPlateNode(node: any): boolean {
    return !!node && node.type === PLATE_TYPE
}

export function plateNode(): any | null {
    let found: any | null = null
    walkNodes((node) => {
        if (!found && isPlateNode(node)) found = node
    })
    return found
}

export function ensurePlateNode(): any | null {
    const index = (nameTextNode() ? 1 : 0) + (badgeNode() ? 1 : 0)
    return plateNode() ?? createPinned(PLATE_TYPE, ADD_LABEL, index, knownUuid(PLATE_TYPE))
}

export function selectPlateRow() {
    goMode('animate')
    ensurePlateNode()?.select?.()
}

function showPlateRow() {
    if (!isNameplateActive() || typeof Modes === 'undefined' || !Modes.animate) return
    const animation = BBAnimation.selected
    const node = ensurePlateNode()
    if (!animation || !node) return
    try {
        ;(animation.getBoneAnimator(node) as any)?.addToTimeline?.(true)
    } catch (error) {
        console.error('[polyplus_nameplate] could not show the whole plate row', error)
    }
}

function queuePlateRow() {
    if (pendingRow) clearTimeout(pendingRow)
    pendingRow = setTimeout(() => {
        pendingRow = null
        showPlateRow()
    }, 0)
}

export function registerPlate() {
    if (plateType) return
    plateType = definePlateType([
        { name: 'Animate the whole nameplate', icon: 'movie', click: selectPlateRow },
    ])
    ;(plateType.type as any).behavior = { ...(OutlinerElement as any).behavior, parent_types: ['root'] }
    listeners.push(
        Blockbench.on('select_mode', queuePlateRow),
        Blockbench.on('select_animation', queuePlateRow),
    )
}

export function unregisterPlate() {
    if (pendingRow) clearTimeout(pendingRow)
    pendingRow = null
    disposeAll(listeners)
    plateType?.dispose()
    plateType = null
}
