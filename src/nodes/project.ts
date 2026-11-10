import { currentBundle } from '../compile'
import { readLoop } from '../elements'
import { readMaterials, setMaterialTexture } from '../material'
import { fromBase64 } from '../material/png'
import { readNameplate } from '../palette'
import { slugSpriteId } from '../util/bundlePath'
import { ContextTexture, DEFAULT_LOOP, MaterialContext } from './context'

function pngSize(bytes: Uint8Array): [number, number] {
    if (bytes.length < 24) return [0, 0]
    const word = (at: number) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
    return [word(16), word(20)]
}

function materialTextures(): Record<string, ContextTexture> {
    const result: Record<string, ContextTexture> = {}
    for (const [id, data] of Object.entries(readMaterials().textures)) {
        let bytes: Uint8Array
        try {
            bytes = fromBase64(data)
        } catch {
            continue
        }
        const [width, height] = pngSize(bytes)
        result[id] = { width, height, png: () => bytes }
    }
    return result
}

function bundleFiles(): Record<string, string> {
    try {
        return currentBundle().files
    } catch {
        return {}
    }
}

export function projectContext(): MaterialContext {
    const nameplate = readNameplate()
    let loop = DEFAULT_LOOP
    try {
        loop = readLoop(nameplate.fps)?.length ?? DEFAULT_LOOP
    } catch {
        loop = DEFAULT_LOOP
    }
    const files = bundleFiles()
    const sprites: Record<string, string> = {}
    let params: Record<string, number> = {}
    for (const [path, text] of Object.entries(files)) {
        const spriteId = slugSpriteId(path)
        if (spriteId !== null) sprites[spriteId] = text
    }
    try {
        const manifest = JSON.parse(files['manifest.json'] ?? '{}')
        if (manifest?.params && typeof manifest.params === 'object') params = manifest.params
    } catch {
        params = {}
    }
    params = { ...readMaterials().params, ...params }
    return {
        slots: nameplate.palette.slots.map((slot) => ({ id: slot.id, name: slot.name, ramp: slot.ramp })),
        fps: nameplate.fps,
        loop,
        params,
        sprites,
        textures: materialTextures(),
    }
}

export function addProjectTexture(id: string, bytes: Uint8Array): boolean {
    return setMaterialTexture(id, bytes)
}
