import { walkNodes } from '../elements/nodes'
import { BADGE_TYPE } from '../model'

export function isBadgeNode(node: any): boolean {
    return !!node && node.type === BADGE_TYPE
}

export function badgeNode(): any | null {
    let found: any | null = null
    walkNodes((node) => {
        if (!found && isBadgeNode(node)) found = node
    })
    return found
}
