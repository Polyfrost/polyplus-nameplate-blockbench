import type { LayerData } from '../model'
import { stringifyJson } from '../util/bundleJson'
import { cloneJson, isRecord } from '../util/json'
import { fromBase64 } from './png'
import {
    isMaterialLayer,
    MATERIAL_CAPABILITY,
    materialPath,
    MaterialsState,
    textureIdsOf,
    texturePath,
} from './types'

const decodedTextures = new Map<string, Uint8Array>()
const MAX_DECODED = 32

function bytesOf(data: string): Uint8Array {
    const hit = decodedTextures.get(data)
    if (hit) return hit
    const bytes = fromBase64(data)
    decodedTextures.set(data, bytes)
    while (decodedTextures.size > MAX_DECODED) decodedTextures.delete(decodedTextures.keys().next().value as string)
    return bytes
}

export function usesMaterials(layers: LayerData[]): boolean {
    return layers.some(isMaterialLayer)
}

export function materialBinary(materials: MaterialsState | undefined, ids?: Iterable<string>): Record<string, Uint8Array> {
    const binary: Record<string, Uint8Array> = {}
    if (!materials) return binary
    const textures = new Set<string>()
    for (const id of ids ?? Object.keys(materials.graphs)) for (const texture of textureIdsOf(materials.graphs[id])) textures.add(texture)
    for (const id of textures) {
        const data = materials.textures[id]
        if (data) binary[texturePath(id)] = bytesOf(data)
    }
    return binary
}

export function applyMaterials(
    layers: LayerData[],
    materials: MaterialsState | undefined,
    manifest: Record<string, unknown>,
    files: Record<string, string>,
): Record<string, Uint8Array> {
    const used: string[] = []
    for (const layer of layers) {
        if (isMaterialLayer(layer) && layer.material && materials?.graphs[layer.material] && !used.includes(layer.material)) used.push(layer.material)
    }
    if (usesMaterials(layers)) {
        const requires = Array.isArray(manifest.requires) ? (manifest.requires as string[]) : []
        if (!requires.includes(MATERIAL_CAPABILITY)) requires.push(MATERIAL_CAPABILITY)
        manifest.requires = requires
    }
    const params: Record<string, number> = isRecord(manifest.params) ? { ...(manifest.params as Record<string, number>) } : {}
    if (materials) Object.assign(params, cloneJson(materials.params))
    if (Object.keys(params).length > 0) manifest.params = params
    else delete manifest.params
    for (const id of used) files[materialPath(id)] = stringifyJson(materials!.graphs[id])
    return materialBinary(materials, used)
}
