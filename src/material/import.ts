import { segmentLayerId, segmentMaterialId, segmentTextureId } from '../util/bundlePath'
import { cloneJson, isRecord } from '../util/json'
import { toBase64 } from './png'
import { emptyMaterials, guessRange, MATERIAL_ID, MaterialGraph, materialPath, MaterialsState, textureIdsOf, texturePath } from './types'

type Json = any

export interface MaterialLayerPlan {
    kind: 'material'
    id: string
    of: string | null
    sprite: null
    props: Record<string, unknown>
}

export interface MaterialImportContext {
    keep(path: Array<string | { id: string }>, value: unknown, label: string): void
}

export function isMaterialFilePath(path: string): boolean {
    return segmentMaterialId(path) !== null
}

export function materialIdsOf(layers: Record<string, Json>): string[] {
    const ids: string[] = []
    for (const layer of Object.values(layers)) {
        if (isRecord(layer) && layer.kind === 'material' && typeof layer.material === 'string' && !ids.includes(layer.material)) ids.push(layer.material)
    }
    return ids
}

export function planMaterials(others: Record<string, string>, manifest: Json, layers: Record<string, Json>, change: (note: string) => void): MaterialsState {
    const state = emptyMaterials()
    const used = materialIdsOf(layers)
    for (const [path, text] of Object.entries(others)) {
        const materialId = segmentMaterialId(path)
        if (materialId === null) continue
        try {
            const graph = JSON.parse(text)
            if (!isRecord(graph) || !Array.isArray(graph.nodes)) {
                change(`${path} is not a graph and was left out`)
                continue
            }
            state.graphs[materialId] = graph as MaterialGraph
            if (!used.includes(materialId)) change(`${path} is not used by any effect; it stays in the project and exports once an effect uses it`)
        } catch {
            change(`${path} is not valid JSON and was left out`)
        }
    }
    if (isRecord(manifest?.params)) {
        for (const [name, value] of Object.entries(manifest.params)) {
            if (typeof value === 'number' && isFinite(value)) {
                state.params[name] = value
                state.ranges[name] = guessRange(name, value)
            }
        }
    }
    return state
}

export function addMaterialTextures(state: MaterialsState, binary: Record<string, Uint8Array>, change: (note: string) => void): MaterialsState {
    const result = cloneJson(state)
    const wanted = new Set<string>()
    for (const graph of Object.values(result.graphs)) for (const id of textureIdsOf(graph)) wanted.add(id)
    for (const [path, bytes] of Object.entries(binary)) {
        const textureId = segmentTextureId(path)
        if (textureId === null) continue
        if (!wanted.has(textureId)) {
            change(`${path} is not used by any graph and was left out`)
            continue
        }
        result.textures[textureId] = toBase64(bytes)
    }
    return result
}

export function missingMaterialFiles(files: Record<string, string>, binary: Record<string, Uint8Array>): string[] {
    const layers: Record<string, Json> = {}
    for (const [path, text] of Object.entries(files)) {
        if (segmentLayerId(path) === null) continue
        try {
            layers[path] = JSON.parse(text)
        } catch {
            continue
        }
    }
    const missing: string[] = []
    for (const id of materialIdsOf(layers)) {
        if (!MATERIAL_ID.test(id)) continue
        const path = materialPath(id)
        if (!(path in files)) {
            missing.push(path)
            continue
        }
        let graph: MaterialGraph | undefined
        try {
            graph = JSON.parse(files[path])
        } catch {
            continue
        }
        for (const texture of textureIdsOf(graph)) {
            const png = texturePath(texture)
            if (!(png in binary) && !missing.includes(png)) missing.push(png)
        }
    }
    return missing
}
