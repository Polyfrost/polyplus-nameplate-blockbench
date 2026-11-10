import { cloneJson, isRecord } from '../util/json'
import { defineProjectState } from '../util/projectState'
import { emptyMaterials, MaterialGraph, MATERIALS_ASPECT, MATERIALS_PROPERTY, MaterialsState, ParamRange } from './types'

function isGraph(value: unknown): value is MaterialGraph {
    return isRecord(value) && Array.isArray(value.nodes)
}

function isRange(value: unknown): value is ParamRange {
    return isRecord(value) && [value.min, value.max, value.step].every((part) => typeof part === 'number' && isFinite(part))
}

export function normalizeMaterials(raw: unknown): MaterialsState {
    const state = emptyMaterials()
    if (!isRecord(raw)) return state
    if (isRecord(raw.graphs)) {
        for (const [id, graph] of Object.entries(raw.graphs)) if (isGraph(graph)) state.graphs[id] = cloneJson(graph)
    }
    if (isRecord(raw.textures)) {
        for (const [id, data] of Object.entries(raw.textures)) if (typeof data === 'string') state.textures[id] = data
    }
    if (isRecord(raw.params)) {
        for (const [name, value] of Object.entries(raw.params)) if (typeof value === 'number' && isFinite(value)) state.params[name] = value
    }
    if (isRecord(raw.ranges)) {
        for (const [name, range] of Object.entries(raw.ranges)) {
            if (isRange(range)) state.ranges[name] = { label: String(range.label ?? name), min: range.min, max: range.max, step: range.step }
        }
    }
    return state
}

const store = defineProjectState<MaterialsState>({
    property: MATERIALS_PROPERTY,
    aspect: MATERIALS_ASPECT,
    listenerFailure: 'material listener failed',
    empty: emptyMaterials,
    parse: normalizeMaterials,
})

export const readMaterials = store.read
export const writeMaterials = store.write
export const onMaterialsChanged = store.on
export const notifyMaterialsChanged = store.notify
export const registerMaterialsState = store.register
export const unregisterMaterialsState = store.unregister

export function materialsAspect(): Record<string, boolean> {
    return { [MATERIALS_ASPECT]: true }
}

export function commitMaterials(label: string, change: (state: MaterialsState) => void | false, aspects: Record<string, unknown> = {}): boolean {
    const committed = store.commit(label, change, { aspects })
    if (committed && typeof Blockbench !== 'undefined') Blockbench.dispatchEvent('update_selection', {} as any)
    return committed
}
