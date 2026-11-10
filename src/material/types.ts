import type { Channel, LayerBase } from '../model'

export const EFFECT_TYPE = 'nameplate_effect'
export const MATERIAL_CAPABILITY = 'materials'
export const MATERIALS_PROPERTY = 'nameplate_materials'
export const MATERIALS_ASPECT = 'nameplate_materials'
export const EFFECT_CHANNELS: Channel[] = ['position', 'opacity', 'visible']
export const MAX_MARGIN = 32
export const MATERIAL_ID = /^[a-z0-9_]{1,64}$/

export type Resolution = 'pixel' | 'smooth'
export type Blend = 'alpha' | 'additive'

export interface MaterialNode {
    id: string
    type: string
    in?: Record<string, unknown>
    set?: Record<string, unknown>
    [key: string]: unknown
}

export interface MaterialGraph {
    resolution?: Resolution
    margins?: number[]
    outline?: string | null
    emissive?: boolean
    toneHint?: string[]
    nodes: MaterialNode[]
    [key: string]: unknown
}

export interface ParamRange {
    label: string
    min: number
    max: number
    step: number
}

export function guessRange(name: string, value: number): ParamRange {
    const whole = Number.isInteger(value)
    const max = value <= 1 && value >= 0 && !whole ? 1 : Math.max(1, Math.ceil(Math.abs(value) * 2))
    const min = value < 0 ? -max : 0
    return { label: name, min, max, step: whole && Math.abs(value) >= 1 ? 1 : max <= 1 ? 0.01 : 0.1 }
}

export interface MaterialsState {
    graphs: Record<string, MaterialGraph>
    textures: Record<string, string>
    params: Record<string, number>
    ranges: Record<string, ParamRange>
}

export interface MaterialLayerData extends LayerBase {
    kind: 'material'
    material: string
    of: string | null
    drift?: boolean
    mirror?: boolean
    mirrorDelay?: number
    mirrorSeed?: boolean
}

export function emptyMaterials(): MaterialsState {
    return { graphs: {}, textures: {}, params: {}, ranges: {} }
}

export function isMaterialLayer(layer: { kind: string }): layer is MaterialLayerData {
    return layer.kind === 'material'
}

export function isEffectNode(node: any): boolean {
    return !!node && node.type === EFFECT_TYPE
}

export function texturePath(id: string): string {
    return `textures/${id}.png`
}

export function materialPath(id: string): string {
    return `materials/${id}.json`
}

export function textureIdsOf(graph: MaterialGraph | undefined): string[] {
    const ids: string[] = []
    for (const node of graph?.nodes ?? []) {
        if (node?.type !== 'BundleTexture') continue
        const id = node.set?.texture
        if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id)
    }
    return ids
}

export function paramNamesOf(graph: MaterialGraph | undefined): string[] {
    const names: string[] = []
    for (const node of graph?.nodes ?? []) {
        if (node?.type !== 'Param') continue
        const name = node.set?.name
        if (typeof name === 'string' && name && !names.includes(name)) names.push(name)
    }
    return names
}

export function outputNode(graph: MaterialGraph | undefined): MaterialNode | null {
    return graph?.nodes?.find((node) => node?.type === 'Output') ?? null
}

export function blendOf(graph: MaterialGraph | undefined): Blend {
    return outputNode(graph)?.set?.blend === 'additive' ? 'additive' : 'alpha'
}
