import { ensureBadgeNode, ensureNameTextNode } from '../badge'
import { isNameplateActive } from '../format'
import { hasProject } from '../util/project'

export type InspectorTarget = 'name' | 'badge'

let refresh: (() => void) | null = null

export function setInspectorRefresh(next: (() => void) | null) {
    refresh = next
}

export function selectInspectorTarget(target: InspectorTarget): void {
    if (!hasProject() || !isNameplateActive()) return
    const node = target === 'name' ? ensureNameTextNode() : ensureBadgeNode()
    if (!node) return
    try {
        if (typeof node.clickSelect === 'function') node.clickSelect(undefined, false)
        else node.select()
        node.showInOutliner?.()
    } catch (error) {
        console.error(`[polyplus_nameplate] could not select the ${target === 'name' ? 'name text' : 'badge'}`, error)
    }
    try {
        refresh?.()
    } catch (error) {
        console.error('[polyplus_nameplate] inspector refresh failed', error)
    }
}
