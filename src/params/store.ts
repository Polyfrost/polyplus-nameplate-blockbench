import { readMaterials } from '../material/state'
import { MaterialsState, paramNamesOf } from '../material/types'
import { readNameplate } from '../palette/state'

export const MAX_PARAMS = 64

export function materialsReading(state: MaterialsState, name: string): string[] {
    return Object.keys(state.graphs).filter((id) => paramNamesOf(state.graphs[id]).includes(name))
}

export function renameInGraphs(state: MaterialsState, renames: Map<string, string>) {
    for (const graph of Object.values(state.graphs)) {
        for (const node of graph.nodes ?? []) {
            const to = node?.type === 'Param' ? renames.get(String(node.set?.name)) : undefined
            if (to !== undefined) node.set = { ...node.set, name: to }
        }
    }
}

export function projectParamValues(): Record<string, number> {
    const params: Record<string, number> = { ...readMaterials().params }
    for (const variant of Object.values(readNameplate().variants)) {
        for (const [name, value] of Object.entries(variant.params ?? {})) if (!(name in params)) params[name] = value
    }
    return params
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function formulaReads(manifestText: string | undefined, name: string): boolean {
    if (!manifestText) return false
    return new RegExp(`variant_param\\s*\\(\\s*\\\\?['"]${escapeRegExp(name)}\\\\?['"]\\s*\\)`).test(manifestText)
}
