import { BADGE_TYPE, BODY_TYPE, PLATE_TYPE, SPRITE_TYPE } from '../model'
import { isMotionNode } from '../motion/types'
import { isEffectNode } from '../material/types'
import { sanitizeLayerId, uniqueLayerId } from './ids'

export const GROUP_TYPE = 'group'
export const NAME_TEXT_TYPE = 'nameplate_name_text'

export function isNameTextNode(node: any): boolean {
    return !!node && node.type === NAME_TEXT_TYPE
}

export function isPinnedNode(node: any): boolean {
    return !!node && (node.type === NAME_TEXT_TYPE || node.type === BADGE_TYPE || node.type === PLATE_TYPE)
}

export function nameTextNode(): any | null {
    let found: any | null = null
    walkNodes((node) => {
        if (!found && isNameTextNode(node)) found = node
    })
    return found
}

export function selectedPinnedNode(): any | null {
    const selected = (typeof Outliner !== 'undefined' && Outliner ? Outliner.selected : []) as any[]
    const first = selected[0]
    return isPinnedNode(first) ? first : null
}

export function isLayerNode(node: any): boolean {
    return !!node && (node.type === BODY_TYPE || node.type === SPRITE_TYPE || isMotionNode(node) || isEffectNode(node))
}

export function isGroupNode(node: any): boolean {
    return !!node && node.type === GROUP_TYPE
}

export function rootNodes(): any[] {
    const root = (typeof Outliner !== 'undefined' && Outliner ? Outliner.root : null) as any
    return Array.isArray(root) ? root : []
}

export function walkNodes(
    visit: (node: any, parent: any | null) => void,
    nodes: any[] = rootNodes(),
    parent: any | null = null,
) {
    for (const node of nodes) {
        visit(node, parent)
        if (isGroupNode(node) && Array.isArray(node.children)) walkNodes(visit, node.children, node)
    }
}

export function layerNodes(): any[] {
    const result: any[] = []
    walkNodes(node => {
        if (isLayerNode(node)) result.push(node)
    })
    return result
}

export function selectedLayerNodes(): any[] {
    const selected = (typeof Outliner !== 'undefined' && Outliner ? Outliner.selected : []) as any[]
    return selected.filter(isLayerNode)
}

export function usedLayerNames(): Set<string> {
    const used = new Set<string>()
    walkNodes(node => {
        if (isGroupNode(node) || isLayerNode(node)) used.add(sanitizeLayerId(node.name))
    })
    return used
}

export function freeLayerName(base: string): string {
    return uniqueLayerId(sanitizeLayerId(base), usedLayerNames())
}

export function firstBodyUuid(): string {
    return layerNodes().find((node) => node.type === BODY_TYPE)?.uuid ?? ''
}

export function placeNode(element: any) {
    const group = typeof Group !== 'undefined' ? Group.first_selected : undefined
    if (group) {
        element.addTo(group, 0)
        ;(group as any).isOpen = true
        return
    }
    const anchor = Outliner.selected[0] as any
    if (anchor) {
        const siblings: any[] = anchor.getParentArray()
        element.addTo(anchor.parent, Math.max(0, siblings.indexOf(anchor)))
        return
    }
    element.addTo('root', 0)
}

export function findNode(uuid: string): any | null {
    let found: any | null = null
    walkNodes(node => {
        if (!found && (isLayerNode(node) || isGroupNode(node)) && node.uuid === uuid) found = node
    })
    return found
}

export function groupNodes(): any[] {
    const result: any[] = []
    walkNodes(node => {
        if (isGroupNode(node)) result.push(node)
    })
    return result
}

export function primarySelectedNode(): any | null {
    const layer = selectedLayerNodes()[0]
    if (layer) return layer
    const group = typeof Group !== 'undefined' ? Group.first_selected : undefined
    return isGroupNode(group) ? group : null
}

export function selectedNodeUuids(): Set<string> {
    const result = new Set<string>()
    for (const node of selectedLayerNodes()) result.add(node.uuid)
    const groups = (typeof Group !== 'undefined' ? Group.multi_selected : null) as any[] | null
    if (Array.isArray(groups)) {
        for (const group of groups) {
            if (isGroupNode(group)) result.add(group.uuid)
        }
    }
    return result
}
