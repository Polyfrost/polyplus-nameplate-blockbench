import type { CosmeticDriver } from '../engine'
import { isRecord } from '../util/json'
import { three } from './rigScene'

export interface TextureTarget {
    project: number
    engine: number
}

interface Swap {
    material: any
    uniform: boolean
    original: any
    mine: any
}

const TEXTURE_SETTINGS = ['magFilter', 'minFilter', 'flipY', 'wrapS', 'wrapT', 'colorSpace', 'encoding', 'generateMipmaps', 'anisotropy', 'premultiplyAlpha']

let swaps: Swap[] = []

function manifestTextures(manifest: unknown): string[] {
    const entries = isRecord(manifest) && Array.isArray(manifest.textures) ? manifest.textures : []
    return entries.map((entry: unknown) => (typeof entry === 'string' ? entry : isRecord(entry) && typeof entry.id === 'string' ? entry.id : ''))
}

export function textureTargets(manifest: unknown, engineNames: readonly string[]): TextureTarget[] {
    const out: TextureTarget[] = []
    manifestTextures(manifest).forEach((id, project) => {
        const engine = id ? engineNames.indexOf(id) : -1
        if (engine >= 0) out.push({ project, engine })
    })
    return out
}

export function manifestOf(files: Readonly<Record<string, string>>): unknown {
    try {
        return JSON.parse(files['manifest.json'] ?? 'null')
    } catch {
        return null
    }
}

function materialOf(texture: Texture): any {
    const own = texture as any
    return own.getMaterial?.() ?? own.material ?? null
}

function canvasOf(width: number, height: number, rgba: Uint8Array): HTMLCanvasElement | null {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context || width <= 0 || height <= 0 || rgba.length < width * height * 4) return null
    const image = context.createImageData(width, height)
    image.data.set(rgba.subarray(0, width * height * 4))
    context.putImageData(image, 0, 0)
    return canvas
}

export function restoreTextures() {
    for (const swap of swaps.splice(0)) {
        if (swap.uniform) {
            if (swap.material.uniforms.map.value === swap.mine) swap.material.uniforms.map.value = swap.original
        } else if (swap.material.map === swap.mine) {
            swap.material.map = swap.original
            swap.material.needsUpdate = true
        }
        swap.mine.dispose?.()
    }
}

function paintedTextures(driver: CosmeticDriver, manifest: unknown, colorway: number): Swap[] {
    const T = three()
    if (colorway < 0 || !T || typeof document === 'undefined') return []
    const out: Swap[] = []
    for (const target of textureTargets(manifest, driver.textureNames())) {
        const texture = Texture.all[target.project]
        const material = texture ? materialOf(texture) : null
        const resolved = driver.texture(target.engine, colorway)
        if (!material || !resolved) continue
        const canvas = canvasOf(resolved.width, resolved.height, resolved.rgba)
        if (!canvas) continue
        const uniform = !!material.uniforms?.map
        const original = uniform ? material.uniforms.map.value : material.map
        const mine = new T.CanvasTexture(canvas)
        for (const key of TEXTURE_SETTINGS) if (original && key in original) mine[key] = original[key]
        mine.needsUpdate = true
        out.push({ material, uniform, original, mine })
    }
    return out
}

export function showColorway(driver: CosmeticDriver, manifest: unknown, colorway: number) {
    restoreTextures()
    for (const painted of paintedTextures(driver, manifest, colorway)) {
        const { material, uniform, mine } = painted
        if (uniform) material.uniforms.map.value = mine
        else {
            material.map = mine
            material.needsUpdate = true
        }
        swaps.push(painted)
    }
}

interface MeshSwap {
    object: any
    original: any
    mine: any
}

export function swapMaterials(roots: readonly any[], replacements: ReadonlyMap<any, any>): MeshSwap[] {
    const out: MeshSwap[] = []
    if (!replacements.size) return out
    for (const root of roots) {
        root?.traverse?.((object: any) => {
            const material = object.material
            if (!material) return
            const mine = Array.isArray(material) ? material.map((entry) => replacements.get(entry) ?? entry) : replacements.get(material) ?? material
            const changed = Array.isArray(material) ? mine.some((entry: any, i: number) => entry !== material[i]) : mine !== material
            if (!changed) return
            object.material = mine
            out.push({ object, original: material, mine })
        })
    }
    return out
}

export function restoreMaterials(swapped: MeshSwap[]) {
    for (const swap of swapped.splice(0)) {
        if (swap.object.material === swap.mine) swap.object.material = swap.original
    }
}

function paintedMaterial(painted: Swap): any {
    const mine = painted.material.clone()
    if (painted.uniform) mine.uniforms = { ...painted.material.uniforms, map: { value: painted.mine } }
    else mine.map = painted.mine
    mine.needsUpdate = true
    return mine
}

export class ColorwayPaint {
    private shown = -1
    private swapped: MeshSwap[] = []
    private made: any[] = []

    show(roots: readonly any[], driver: CosmeticDriver, manifest: unknown, colorway: number) {
        if (colorway === this.shown) return
        this.clear()
        this.shown = colorway
        const replacements = new Map<any, any>()
        for (const painted of paintedTextures(driver, manifest, colorway)) {
            const mine = paintedMaterial(painted)
            replacements.set(painted.material, mine)
            this.made.push(mine, painted.mine)
        }
        this.swapped = swapMaterials(roots, replacements)
    }

    clear() {
        restoreMaterials(this.swapped)
        for (const made of this.made.splice(0)) made.dispose?.()
        this.shown = -1
    }
}
