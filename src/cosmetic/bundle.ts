import { stringifyJson } from '../util/bundleJson'
import { cloneJson, isRecord } from '../util/json'
import { CosmeticData, CosmeticKind, CosmeticPalette, defaultCosmetic, isCosmeticKind, normalizeCosmetic, ReactionData, SIGNAL_FREE_ON } from './data'
import { BUNDLE_PARTS } from './parts'

export const MANIFEST = 'manifest.json'
export const PALETTES = 'palettes.json'
export const FORMAT = 1
export const ANIMATION_VERSION = '1.8.0'
export const CONTROLLER_VERSION = '1.10.0'
export const GEOMETRY_VERSION = '1.12.0'
export const RIG_PARTS_KEY = 'polyplus:rig_parts'

export interface BundleTexture {
    id: string
    png: Uint8Array
    index: Uint8Array | null
}

export interface CosmeticSources {
    geometry: Record<string, unknown> | null
    animations: Record<string, unknown>
    controllers: Record<string, unknown>
    textures: BundleTexture[]
}

export interface BundleFiles {
    files: Record<string, string>
    binary: Record<string, Uint8Array>
}

export interface BundlePart {
    write(data: CosmeticData, manifest: Record<string, unknown>, out: BundleFiles): void
    read(manifest: Record<string, any>, data: CosmeticData, input: BundleFiles, dropped: string[], changed: string[]): void
}

export function emptySources(): CosmeticSources {
    return { geometry: null, animations: {}, controllers: {}, textures: [] }
}

export const geometryPath = (id: string) => `models/${id}.geo.json`
export const animationPath = (id: string) => `animations/${id}.animation.json`
export const controllerPath = (id: string) => `animation_controllers/${id}.animation_controllers.json`
export const texturePath = (id: string) => `textures/${id}.png`
export const indexPath = (id: string) => `textures/${id}.idx.png`

function paletteFile(palette: CosmeticPalette): Record<string, unknown> {
    return {
        slots: palette.slots.map((slot) => ({
            id: slot.id,
            name: slot.name,
            ramp: slot.ramp,
            ...(slot.interpolate !== undefined ? { interpolate: slot.interpolate } : {}),
            ...(slot.customizable ? { customizable: true } : {}),
        })),
        colorways: cloneJson(palette.colorways),
    }
}

function reactionJson(reaction: ReactionData): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (!SIGNAL_FREE_ON.includes(reaction.on)) out.signal = reaction.signal
    out.on = reaction.on
    if (reaction.play) out.play = reaction.play
    if (reaction.restart) out.restart = true
    if (reaction.blend > 0) out.blend = reaction.blend
    if (reaction.speed !== null) out.speed = reaction.speed
    if (reaction.palette) out.palette = reaction.palette
    if (reaction.effect) out.effect = reaction.effect
    return out
}

function attachJson(data: CosmeticData): Record<string, unknown> | null {
    if (data.kind === 'emote') return null
    const { rig, bone, replaces } = data.attach
    const defaultRig = data.kind === 'pet' ? 'actor' : 'player'
    if (rig === defaultRig && !bone && !replaces) return null
    return { rig, ...(bone ? { bone } : {}), ...(replaces ? { replaces } : {}) }
}

export function manifestOf(data: CosmeticData, sources: CosmeticSources, requires: readonly string[]): Record<string, unknown> {
    const manifest: Record<string, unknown> = { format: FORMAT, kind: data.kind, id: data.id, requires: [...requires] }
    if (sources.geometry) manifest.geometry = data.id
    if (sources.textures.length) manifest.textures = sources.textures.map((texture) => (texture.index ? { id: texture.id, palette: true } : texture.id))
    if (data.palette.slots.length) manifest.palettes = true
    if (Object.keys(sources.animations).length) manifest.animations = [data.id]
    if (Object.keys(sources.controllers).length) manifest.animationControllers = [data.id]
    if (data.controllers.length) manifest.controllers = [...data.controllers]
    const attach = attachJson(data)
    if (attach) manifest.attach = attach
    if (data.reactions.length) manifest.reactions = data.reactions.map(reactionJson)
    return manifest
}

export function buildBundle(data: CosmeticData, sources: CosmeticSources, requires: readonly string[] = []): BundleFiles {
    const out: BundleFiles = { files: {}, binary: {} }
    const manifest = manifestOf(data, sources, requires)
    if (sources.geometry) out.files[geometryPath(data.id)] = stringifyJson(sources.geometry)
    for (const texture of sources.textures) {
        out.binary[texturePath(texture.id)] = texture.png
        if (texture.index) out.binary[indexPath(texture.id)] = texture.index
    }
    if (data.palette.slots.length) out.files[PALETTES] = stringifyJson(paletteFile(data.palette))
    if (Object.keys(sources.animations).length) {
        out.files[animationPath(data.id)] = stringifyJson({ format_version: ANIMATION_VERSION, animations: sources.animations })
    }
    if (Object.keys(sources.controllers).length) {
        out.files[controllerPath(data.id)] = stringifyJson({ format_version: CONTROLLER_VERSION, animation_controllers: sources.controllers })
    }
    for (const part of BUNDLE_PARTS) part.write(data, manifest, out)
    out.files[MANIFEST] = stringifyJson(manifest)
    return out
}

function json(input: BundleFiles, path: string): any {
    const text = input.files[path]
    if (typeof text !== 'string') return null
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

function ids(value: unknown): string[] {
    if (typeof value === 'string') return [value]
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export interface ReadBundle {
    data: CosmeticData
    sources: CosmeticSources
    requires: string[]
    dropped: string[]
    changed: string[]
    merged: Record<string, string>
}

interface Merge {
    key: string
    path: (id: string) => string
    what: string
    target: Record<string, unknown>
}

function mergeFiles(input: BundleFiles, listed: unknown, into: string, merge: Merge, read: { merged: Record<string, string>, changed: string[] }) {
    const owners = new Map<string, string>()
    for (const id of new Set(ids(listed))) {
        const path = merge.path(id)
        const entries = json(input, path)?.[merge.key]
        if (!isRecord(entries)) continue
        read.merged[path] = into
        for (const [name, value] of Object.entries(entries)) {
            const first = owners.get(name)
            if (first !== undefined) {
                read.changed.push(`${merge.what} '${name}' is in both '${first}' and '${path}'. Only the one in '${first}' was kept`)
                continue
            }
            owners.set(name, path)
            merge.target[name] = value
        }
    }
}

export function readBundle(input: BundleFiles, kind?: CosmeticKind): ReadBundle {
    const manifest = json(input, MANIFEST)
    if (!isRecord(manifest)) throw new Error('The zip has no manifest.json')
    const resolved = kind ?? (isCosmeticKind(manifest.kind) ? manifest.kind : null)
    if (!resolved) throw new Error(`'${String(manifest.kind)}' is not a cosmetic type this plugin makes`)
    const base = defaultCosmetic(resolved, typeof manifest.id === 'string' ? manifest.id : undefined)
    const palette = manifest.palettes === true ? json(input, PALETTES) : null
    const raw: Record<string, unknown> = {
        ...base,
        controllers: ids(manifest.controllers),
        reactions: Array.isArray(manifest.reactions) ? manifest.reactions : [],
        attach: isRecord(manifest.attach) ? { ...base.attach, rig: 'player', ...manifest.attach } : base.attach,
        palette: isRecord(palette) ? palette : base.palette,
    }
    const data = normalizeCosmetic(raw, resolved)
    const sources = emptySources()
    const read = { merged: {} as Record<string, string>, changed: [] as string[] }
    for (const id of ids(manifest.geometry)) {
        sources.geometry = json(input, geometryPath(id))
        if (sources.geometry) read.merged[geometryPath(id)] = geometryPath(data.id)
    }
    mergeFiles(input, manifest.animations, animationPath(data.id), { key: 'animations', path: animationPath, what: 'Animation', target: sources.animations }, read)
    mergeFiles(input, manifest.animationControllers, controllerPath(data.id), { key: 'animation_controllers', path: controllerPath, what: 'Controller', target: sources.controllers }, read)
    if (Array.isArray(manifest.textures)) {
        for (const entry of manifest.textures) {
            const id = typeof entry === 'string' ? entry : isRecord(entry) && typeof entry.id === 'string' ? entry.id : null
            const png = id ? input.binary[texturePath(id)] : undefined
            if (!id || !png) continue
            const indexed = isRecord(entry) && entry.palette === true
            sources.textures.push({ id, png, index: indexed ? input.binary[indexPath(id)] ?? null : null })
        }
    }
    const dropped: string[] = []
    for (const part of BUNDLE_PARTS) part.read(manifest, data, input, dropped, read.changed)
    return { data, sources, requires: ids(manifest.requires), dropped: dropped.map((at) => `${MANIFEST}: ${at}`), ...read }
}
