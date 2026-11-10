import { allAnimations } from '../util/animation'
import { hasProject } from '../util/project'
import { undoEdit } from '../util/undo'

export function knownUuid(typeId: string): string | undefined {
    for (const animation of allAnimations()) {
        for (const [uuid, animator] of Object.entries<any>(animation?.animators ?? {})) {
            if (animator?.type === typeId) return uuid
        }
    }
    return undefined
}

export function createPinned(typeId: string, label: string, index: number, uuid?: string): any | null {
    const type = (OutlinerElement.types as any)[typeId]
    if (!type || !hasProject()) return null
    if (Undo.current_save) return null
    const tracked = Undo.history.length > 0
    const created: any[] = []
    const build = () => {
        const node = new type({}, uuid)
        node.addTo('root', index)
        node.init()
        created.push(node)
        return node
    }
    return tracked ? undoEdit({ elements: created, outliner: true }, label, build) : build()
}
