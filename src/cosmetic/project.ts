import { EngineIssue, issueMessage } from '../engine'
import { decodePng, fromBase64, toBase64 } from '../material/png'
import { pictureStem, sanitizeId, uniqueId } from '../palette/ids'
import { readTexturePixels } from '../util/texture'
import { isRecord } from '../util/json'
import { BundleTexture, CosmeticSources, emptySources, GEOMETRY_VERSION, RIG_PARTS_KEY } from './bundle'
import type { CosmeticData } from './data'
import { indexPixels } from './indexed'
import { encodePng } from './png'
import { pictureTextureIds } from './effects'
import { applySprings, groupSpring, SpringParams } from './springs'

export const SPRING_PROPERTY = 'polyplus_spring'
export const PALETTE_PROPERTY = 'polyplus_palette'
export const RIG_PROPERTY = 'polyplus_rig'
export const INDEX_PROPERTY = 'polyplus_palette_index'
export const INDEX_PIXELS_PROPERTY = 'polyplus_palette_index_pixels'

export interface ProjectSources {
    sources: CosmeticSources
    issues: EngineIssue[]
    textureIds: Map<string, string>
    guessed: Set<string>
}

function asObject(compiled: unknown): Record<string, any> | null {
    if (typeof compiled === 'string') {
        try {
            return JSON.parse(compiled)
        } catch {
            return null
        }
    }
    return isRecord(compiled) ? compiled : null
}

export function groupSprings(): Record<string, SpringParams> {
    const out: Record<string, SpringParams> = {}
    for (const group of Group.all) {
        const spring = groupSpring((group as any)[SPRING_PROPERTY])
        if (spring) out[group.name] = spring
    }
    return out
}

const BONE_CONTENT = ['cubes', 'locators', 'texture_meshes', 'poly_mesh']

function hasContent(bone: Record<string, any>): boolean {
    return BONE_CONTENT.some((key) => {
        const value = bone[key]
        return Array.isArray(value) ? value.length > 0 : isRecord(value) && Object.keys(value).length > 0
    })
}

export function detachRig(model: Record<string, any>, rig: Set<string>) {
    if (!rig.size || !Array.isArray(model.bones)) return
    const names = new Set(model.bones.filter(isRecord).map((bone) => bone.name))
    model.bones = model.bones.filter((bone: any) => {
        if (!isRecord(bone) || !rig.has(bone.name)) return true
        if (!hasContent(bone)) return false
        const part = bone.name
        bone.name = uniqueId(`${part}_parts`, (candidate) => names.has(candidate))
        names.add(bone.name)
        bone.parent = part
        bone[RIG_PARTS_KEY] = true
        delete bone.rotation
        return true
    })
}

function rigGroups(): Group[] {
    return Group.all.filter((group) => (group as any)[RIG_PROPERTY] === true)
}

export function isRigReference(element: any): boolean {
    if (element?.[RIG_PROPERTY] === true) return true
    const parent = element?.parent
    return parent instanceof Group && (parent as any)[RIG_PROPERTY] === true && element.name === parent.name
}

function compileWithoutReference(): unknown {
    const hidden = Outliner.elements.filter((element: any) => element.export !== false && isRigReference(element))
    for (const element of hidden) (element as any).export = false
    try {
        return (Codecs as any).bedrock?.compile({ raw: true })
    } finally {
        for (const element of hidden) (element as any).export = true
    }
}

function geometryOf(data: CosmeticData): Record<string, unknown> | null {
    const groups = rigGroups()
    const rig = new Set(groups.map((group) => group.name))
    const own = Group.all.filter((group) => !groups.includes(group))
    const loose = Outliner.elements.filter((element: any) => !isRigReference(element))
    if (!own.length && !loose.length) return null
    const compiled = asObject(compileWithoutReference())
    if (!compiled) return null
    const file = Array.isArray(compiled['minecraft:geometry'])
        ? compiled
        : { format_version: GEOMETRY_VERSION, 'minecraft:geometry': [compiled] }
    const model = file['minecraft:geometry'][0]
    if (isRecord(model)) {
        model.description = { ...(isRecord(model.description) ? model.description : {}), identifier: `geometry.${data.id}` }
        detachRig(model, rig)
    }
    return applySprings(file, groupSprings())
}

function animationsOf(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const animation of Animator.animations ?? []) {
        const compiled = (animation as any).compileBedrockAnimation?.()
        if (compiled) out[animation.name] = compiled
    }
    return out
}

function renamedStateAnimation(compiled: unknown, key: unknown, name: string): unknown {
    if (typeof compiled === 'string') return compiled === key ? name : compiled
    if (isRecord(compiled)) {
        const entries = Object.entries(compiled)
        if (entries.length === 1 && entries[0][0] === key) return Object.assign(Object.create(Object.getPrototypeOf(compiled)), { [name]: entries[0][1] })
    }
    return compiled
}

export function withFullAnimationNames(compiled: unknown, controller: any, names: ReadonlyMap<string, string>): unknown {
    if (!isRecord(compiled) || !isRecord(compiled.states) || !Array.isArray(controller?.states)) return compiled
    for (const state of controller.states) {
        const out = compiled.states[state?.name]
        const selected: any[] = Array.isArray(state?.animations) ? state.animations : []
        if (!isRecord(out) || !Array.isArray(out.animations) || out.animations.length !== selected.length) continue
        out.animations = out.animations.map((entry: unknown, i: number) => {
            const name = typeof selected[i]?.animation === 'string' ? names.get(selected[i].animation) : undefined
            return name ? renamedStateAnimation(entry, selected[i].key, name) : entry
        })
    }
    return compiled
}

export function controllerSources(controllers: readonly any[], animations: readonly any[]): Record<string, unknown> {
    const names = new Map<string, string>()
    for (const animation of animations) if (typeof animation?.uuid === 'string' && typeof animation.name === 'string') names.set(animation.uuid, animation.name)
    const out: Record<string, unknown> = {}
    for (const controller of controllers) {
        const compiled = controller.compileForBedrock?.()
        if (compiled) out[controller.name] = withFullAnimationNames(compiled, controller, names)
    }
    return out
}

function controllersOf(): Record<string, unknown> {
    return controllerSources((AnimationController as any)?.all ?? [], Animator.animations ?? [])
}

function pngBytes(texture: Texture, pixels: { width: number, height: number, data: Uint8ClampedArray } | null): Uint8Array | null {
    const url: unknown = (texture as any).getDataURL?.() ?? texture.source
    if (typeof url === 'string' && url.startsWith('data:image/png;base64,')) return fromBase64(url.slice(url.indexOf(',') + 1))
    return pixels ? encodePng(pixels.width, pixels.height, pixels.data, 4) : null
}

export function isPaletteTexture(texture: Texture): boolean {
    return (texture as any)[PALETTE_PROPERTY] === true
}

export function readIndexMap(text: unknown, width: number, height: number): Uint8Array | null {
    if (typeof text !== 'string' || !text) return null
    try {
        const map = decodePng(fromBase64(text))
        if (map.width !== width || map.height !== height) return null
        const out = new Uint8Array(width * height)
        for (let p = 0; p < out.length; p++) out[p] = map.rgba[p * 4]
        return out
    } catch {
        return null
    }
}

export function writeIndexMap(width: number, height: number, index: Uint8Array): string {
    return toBase64(encodePng(width, height, index, 1))
}

export function storedIndex(texture: Texture, width: number, height: number): Uint8Array | null {
    return readIndexMap((texture as any)[INDEX_PROPERTY], width, height)
}

export function readIndexPixels(text: unknown, width: number, height: number): Uint8Array | null {
    if (typeof text !== 'string' || !text) return null
    try {
        const picture = decodePng(fromBase64(text))
        return picture.width === width && picture.height === height ? picture.rgba : null
    } catch {
        return null
    }
}

export function writeIndexPixels(width: number, height: number, rgba: ArrayLike<number>): string {
    return toBase64(encodePng(width, height, rgba, 4))
}

export function storedIndexPixels(texture: Texture, width: number, height: number): Uint8Array | null {
    return readIndexPixels((texture as any)[INDEX_PIXELS_PROPERTY], width, height)
}

export function keepIndex(texture: Texture, width: number, height: number, index: Uint8Array, rgba: ArrayLike<number>) {
    ;(texture as any)[INDEX_PROPERTY] = writeIndexMap(width, height, index)
    ;(texture as any)[INDEX_PIXELS_PROPERTY] = writeIndexPixels(width, height, rgba)
}

function offPaletteIssue(id: string, x: number, y: number, count: number): EngineIssue {
    const values = { x, y, count }
    const names = { texture: id }
    const code = 'texture_index_off_palette'
    return { path: `textures/${id}.png`, code, level: 'error', values, names, message: issueMessage(code, values, names) }
}

function texturesOf(data: CosmeticData, issues: EngineIssue[], ids: Map<string, string>, guessed: Set<string>): BundleTexture[] {
    const taken = pictureTextureIds(data)
    const out: BundleTexture[] = []
    for (const texture of Texture.all) {
        const id = uniqueId(sanitizeId(pictureStem(texture.name)) || 'texture', (candidate) => taken.has(candidate))
        taken.add(id)
        ids.set(texture.uuid, id)
        const pixels = readTexturePixels(texture)
        const png = pngBytes(texture, pixels)
        if (!png) continue
        let index: Uint8Array | null = null
        if (isPaletteTexture(texture) && pixels && data.palette.slots.length) {
            const indexed = indexPixels(pixels.width, pixels.height, pixels.data, data.palette, storedIndex(texture, pixels.width, pixels.height), storedIndexPixels(texture, pixels.width, pixels.height))
            if (indexed.off) issues.push(offPaletteIssue(id, indexed.off.x, indexed.off.y, indexed.off.count))
            for (const key of indexed.guessed) guessed.add(key)
            index = encodePng(pixels.width, pixels.height, indexed.index, 1)
        }
        out.push({ id, png, index })
    }
    return out
}

export function projectSources(data: CosmeticData): ProjectSources {
    const sources = emptySources()
    const issues: EngineIssue[] = []
    const textureIds = new Map<string, string>()
    const guessed = new Set<string>()
    sources.geometry = geometryOf(data)
    sources.animations = animationsOf()
    sources.controllers = controllersOf()
    sources.textures = texturesOf(data, issues, textureIds, guessed)
    return { sources, issues, textureIds, guessed }
}
