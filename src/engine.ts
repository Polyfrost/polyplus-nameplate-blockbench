import * as EngineModule from '../engine/PolyPlus-nameplate-engine.js'
import { decodePng } from './material/png'
import { BundleIssue, CAPABILITIES } from './model'
import { placeholderPixels } from './gpu/placeholder'

const api = EngineModule.org.polyfrost.polyplus.nameplate.engine.js

type RawBlock = EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplateBlock
type RawPreview = EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplatePreview
type RawState = EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplateState
type RawShaders = EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplateShaders
type RawDraw = EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplateMaterialDraw
type RawSource = EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplateShaderSource
type RawLetterMotion = EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplateLetterMotion
type RawLayer = EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplateLayer

export type NameplateLayer = RawLayer

export type BundleBinary = Record<string, Uint8Array>

export interface TexturePixels {
    width: number
    height: number
    rgba: Uint8Array
}

export type TextureKind = 'bundle' | 'vanilla' | 'atlas'

export interface ShaderTexture {
    unit: number
    sampler: string
    kind: TextureKind
    id: string
    path: string
}

export interface ShaderUniform {
    name: string
    type: string
    offset: number
    count: number
}

export interface ShaderSource {
    key: string
    materialId: string
    vertex: string
    fragment: string
    resolution: string
    blend: string
    emissive: boolean
    outline: boolean
    tones: number
    inputs: string[]
    textures: ShaderTexture[]
    uniforms: ShaderUniform[]
}

export interface MaterialDraw {
    index: number
    layer: string
    key: string
    depth: string
    x: number
    y: number
    width: number
    mirrorX: boolean
    opacity: number
    area: Int32Array
    body: Int32Array
    clock: number
    cycle: number
    fps: number
    step: number
    seconds: number
    blend: string
    resolution: string
    emissive: boolean
    fallbackStill: boolean
    clip: Int32Array | null
    uniforms: Int32Array
}

export const UNIFORM_WORDS = Object.freeze({ area: 0, body: 4, clock: 8, inputs: 12, atlas: 28, tones: 44 })

export type NameplateBlock = RawBlock

export interface NameplateTagState {
    reactions: string[]
    oneShots: string[]
    starts: Int32Array
}

export interface NameplateBadgePose {
    dx: number
    dy: number
    opacity: number
    visible: boolean
}

export const STILL_BADGE: NameplateBadgePose = Object.freeze({ dx: 0, dy: 0, opacity: 255, visible: true })

export interface NameplateRecord {
    update(key: string, variant: string, frame: number, reactions: string[], timeMs: number, seed?: number): NameplateTagState
    fire(key: string, animation: string, frame: number): boolean
    clear(): void
}

export type IssueLevel = 'error' | 'warning' | 'info'

export type IssueValues = Readonly<Record<string, number>>

export type IssueNames = Readonly<Record<string, string>>

export interface EngineIssue extends BundleIssue {
    code?: string
    level?: IssueLevel
    values?: IssueValues
    names?: IssueNames
}

export interface MaterialLimits {
    maxCost: number
    outlineFactor: number
    toneCost: number
    maxNodes: number
    maxSamples: number
    maxInputs: number
    maxRepeat: number
    maxOctaves: number
    maxMargin: number
}

export interface NameplateEffectCost {
    layer: string
    material: string
    states: number
    shotStates: number
}

export interface NameplateLayerCost {
    id: string
    states: number
    margin: number
}

export interface NameplateFallbackCost {
    id: string
    material: string
    frames: number
    bytes: number
    animatedBytes: number
    frameBytes: number
    still: boolean
    rebuildMs?: number
    drift: boolean
    shotStates: number
}

export interface NameplateCost {
    quads: number
    cacheBytes: number
    cpu: number
    states: number
    totalStates: number
    margin: number
    layers: NameplateLayerCost[]
    flash: string | null
    flashTimes: number | null
    flashPixels: number | null
    issues: EngineIssue[]
    warnings: EngineIssue[]
    infos: EngineIssue[]
    materialBuildOps: number
    fallbacks: NameplateFallbackCost[]
    fallbackBytes: number
    textCpu: number
    effects: NameplateEffectCost[]
}

export interface NameplateLimits {
    quads: number
    cacheBytes: number
    fallbackBytes: number
    cpu: number
    margin: number
    states: number
    flashes: number
    flashArea: number
}

export interface NameplatePreview {
    id: string
    fps: number
    loop: number
    variants: string[]
    reactions: string[]
    oneShots: string[]
    ownsBackground(variant: string): boolean
    paint(variant: string, block: NameplateBlock, frame: number, seed: number, state?: NameplateTagState | null, detail?: NameplateDetail): NameplateLayer[]
    badgePose(frame: number, seed: number, state?: NameplateTagState | null, detail?: NameplateDetail): NameplateBadgePose
    platePose(variant: string, block: NameplateBlock, frame: number, seed: number, state?: NameplateTagState | null, detail?: NameplateDetail): NameplateBadgePose
    badgeFollow(variant: string, block: NameplateBlock, frame: number, seed: number, state?: NameplateTagState | null, detail?: NameplateDetail): NameplateBadgePose
    badgeSpot(variant: string, block: NameplateBlock): [number, number] | null
    cost(flash: boolean): NameplateCost
    record(): NameplateRecord
    hasMaterials: boolean
    materials(variant: string, block: NameplateBlock, frame: number, seed: number, state?: NameplateTagState | null, detail?: NameplateDetail): MaterialDraw[]
    shaders(): ShaderSource[]
    shader(key: string): ShaderSource | null
    texture(path: string): TexturePixels | null
    letters?(variant: string, block: NameplateBlock, frame: number, seed: number, glyphX: Int32Array, glyphWidth: Int32Array, state?: NameplateTagState | null, detail?: NameplateDetail): NameplateLetters | null
    movesLetters(): boolean
    effects(): NameplateEffectInfo[]
    paramCurve(layer: string, param: string, variant: string, from: number, count: number, state?: NameplateTagState | null): number[]
}

export interface NameplateEffectInfo {
    layer: string
    material: string
    reads: string[]
    animated: string[]
    states: number
    shotStates: number
    toneSlots: number | null
}

export interface NameplateLetters {
    mode: string
    count: number
    moving: boolean
    dx: Int32Array
    dy: Int32Array
    opacity: Int32Array
    color: Int32Array
    shadow: Int32Array
    outline: Int32Array
    scale: Float64Array
    rotation: Int32Array
}

export interface LoadedBundle {
    preview: NameplatePreview | null
    skipped: string | null
    issues: EngineIssue[]
    measure?: (flash: boolean) => NameplateCost | null
    draft?: () => NameplatePreview | null
}

export interface LayerBounds {
    minX: number
    minY: number
    width: number
    height: number
}

export type LineAlign = 'left' | 'center' | 'right'

export type NameplateDetail = 'full' | 'reduced'

export interface BlockRect {
    x0: number
    y0: number
    x1: number
    y1: number
}

const rawStates = new WeakMap<NameplateTagState, RawState>()

function wrapState(raw: RawState): NameplateTagState {
    const state: NameplateTagState = {
        reactions: Array.from(raw.reactions),
        oneShots: Array.from(raw.oneShots),
        starts: Int32Array.from(raw.starts),
    }
    rawStates.set(state, raw)
    return state
}

function wrapRecord(preview: RawPreview): NameplateRecord {
    const raw = new api.NameplateRecord(preview)
    return {
        update: (key, variant, frame, reactions, timeMs, seed) => wrapState(raw.update(key, variant, frame, reactions, timeMs, seed ?? 0)),
        fire: (key, animation, frame) => raw.fire(key, animation, frame),
        clear: () => raw.clear(),
    }
}

type RawIssue = EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplateIssue

const LEVELS: ReadonlySet<string> = new Set<IssueLevel>(['error', 'warning', 'info'])

function frozenEntries<T>(raw: unknown, accept: (value: unknown) => value is T): Readonly<Record<string, T>> {
    const entries: Record<string, T> = {}
    if (raw && typeof raw === 'object') {
        for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
            if (accept(value)) entries[name] = value
        }
    }
    return Object.freeze(entries)
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isString = (value: unknown): value is string => typeof value === 'string'

export function wrapIssue(raw: RawIssue): EngineIssue {
    const level = String(raw.level ?? '')
    return {
        path: String(raw.path ?? ''),
        message: String(raw.message ?? ''),
        code: raw.code ? String(raw.code) : undefined,
        level: LEVELS.has(level) ? (level as IssueLevel) : undefined,
        values: frozenEntries(raw.values, isFiniteNumber),
        names: frozenEntries(raw.names, isString),
    }
}

export function materialLimits(): MaterialLimits {
    return api.NameplateMaterialLimits
}

export function materialNodeCost(type: string, variant: number): number | null {
    try {
        const cost = api.nameplateMaterialNodeCost(type, variant)
        return cost >= 0 ? cost : null
    } catch (error) {
        console.error('[polyplus_nameplate] reading a material node cost failed', error)
        return null
    }
}

function issuesOf(raw: ArrayLike<RawIssue> | null | undefined): EngineIssue[] {
    return Array.from(raw ?? []).map(wrapIssue)
}

function textCpuOf(preview: RawPreview): number {
    try {
        return new api.NameplateLetterMotion(preview).cost
    } catch (error) {
        console.error('[polyplus_nameplate] measuring letter programs failed', error)
        return 0
    }
}

function effectsOf(preview: RawPreview): NameplateEffectCost[] {
    try {
        return Array.from(api.nameplateEffects(preview)).map((effect) => ({ layer: effect.layer, material: effect.material, states: effect.states, shotStates: effect.shotStates }))
    } catch (error) {
        console.error('[polyplus_nameplate] reading effect states failed', error)
        return []
    }
}

function wrapCost(raw: EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplateCost, preview: RawPreview): NameplateCost {
    return {
        quads: raw.quads,
        cacheBytes: raw.cacheBytes,
        cpu: raw.cpu,
        states: raw.states,
        totalStates: raw.totalStates,
        margin: raw.margin,
        layers: Array.from(raw.layers).map((layer) => ({ id: layer.id, states: layer.states, margin: layer.margin })),
        flash: raw.flash ?? null,
        flashTimes: raw.flashTimes ?? null,
        flashPixels: raw.flashPixels ?? null,
        issues: issuesOf(raw.issues),
        warnings: issuesOf(raw.warnings),
        infos: issuesOf(raw.infos),
        materialBuildOps: raw.materialBuildOps,
        fallbacks: Array.from(raw.fallbacks ?? []).map((entry) => ({
            id: entry.id,
            material: entry.material,
            frames: entry.frames,
            bytes: entry.bytes,
            animatedBytes: entry.animatedBytes,
            frameBytes: entry.frameBytes,
            still: entry.still,
            rebuildMs: typeof entry.rebuildMs === 'number' && Number.isFinite(entry.rebuildMs) ? entry.rebuildMs : undefined,
            drift: entry.drift === true,
            shotStates: typeof entry.shotStates === 'number' ? entry.shotStates : 0,
        })),
        fallbackBytes: raw.fallbackBytes ?? 0,
        textCpu: textCpuOf(preview),
        effects: effectsOf(preview),
    }
}

function shownState(state: NameplateTagState | null | undefined, detail: NameplateDetail | undefined): RawState | null {
    if (detail === 'reduced') return api.nameplateState(state ? state.reactions : [], true)
    return state ? rawStates.get(state) ?? null : null
}

function wrapSource(raw: RawSource): ShaderSource {
    return {
        key: raw.key,
        materialId: raw.materialId,
        vertex: raw.vertex,
        fragment: raw.fragment,
        resolution: raw.resolution,
        blend: raw.blend,
        emissive: raw.emissive,
        outline: raw.outline,
        tones: raw.tones,
        inputs: Array.from(raw.inputs),
        textures: Array.from(raw.textures).map((texture) => ({ unit: texture.unit, sampler: texture.sampler, kind: texture.kind as TextureKind, id: texture.id, path: texture.path })),
        uniforms: Array.from(raw.uniforms).map((uniform) => ({ name: uniform.name, type: uniform.type, offset: uniform.offset, count: uniform.count })),
    }
}

function wrapDraw(raw: RawDraw): MaterialDraw {
    return {
        index: raw.index,
        layer: raw.layer,
        key: raw.key,
        depth: raw.depth,
        x: raw.x,
        y: raw.y,
        width: raw.width,
        mirrorX: raw.mirrorX,
        opacity: raw.opacity,
        area: Int32Array.from(raw.area),
        body: Int32Array.from(raw.body),
        clock: raw.clock,
        cycle: raw.cycle,
        fps: raw.fps,
        step: raw.step,
        seconds: raw.seconds,
        blend: raw.blend,
        resolution: raw.resolution,
        emissive: raw.emissive,
        fallbackStill: raw.fallbackStill,
        clip: raw.clip ? Int32Array.from(raw.clip) : null,
        uniforms: Int32Array.from(raw.uniforms),
    }
}

const layerDraws = new WeakMap<NameplateLayer, MaterialDraw>()
let materialDrawsWanted: () => boolean = () => false

export function setMaterialDrawsWanted(wanted: (() => boolean) | null) {
    materialDrawsWanted = wanted ?? (() => false)
}

export function materialDrawOf(layer: NameplateLayer): MaterialDraw | null {
    return layerDraws.get(layer) ?? null
}

function attachDraws(layers: NameplateLayer[], draws: MaterialDraw[]): NameplateLayer[] {
    if (!draws.length) return layers
    const byIndex = new Map(draws.map((draw) => [`${draw.index}:${draw.mirrorX}`, draw]))
    for (const layer of layers) {
        const draw = byIndex.get(`${layer.index}:${layer.mirrorX}`) ?? draws.find((candidate) => candidate.index === layer.index)
        if (draw) layerDraws.set(layer, draw)
    }
    return layers
}

function shaderCount(shaders: RawShaders): number {
    try {
        return shaders.count
    } catch (error) {
        console.error('[polyplus_nameplate] reading effect shaders failed', error)
        return 0
    }
}

function poseOf(pose: EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplateBadgePose): NameplateBadgePose {
    return { dx: pose.dx, dy: pose.dy, opacity: pose.opacity, visible: pose.visible }
}

function wrapPreview(raw: RawPreview, textures: ReadonlyMap<string, TexturePixels> = new Map()): NameplatePreview {
    const shaders = new api.NameplateShaders(raw, 'es300')
    const hasMaterials = shaderCount(shaders) > 0
    let sources: ShaderSource[] | null = null
    const materials = (
        variant: string,
        block: NameplateBlock,
        frame: number,
        seed: number,
        state?: NameplateTagState | null,
        detail?: NameplateDetail,
    ): MaterialDraw[] => {
        if (!hasMaterials) return []
        return Array.from(shaders.draws(variant, block, frame, seed, shownState(state, detail), detail ?? 'full')).map(wrapDraw)
    }
    const shaderList = (): ShaderSource[] => {
        if (!hasMaterials) return []
        sources ??= Array.from(shaders.sources()).map(wrapSource)
        return sources
    }
    let effectList: NameplateEffectInfo[] | null = null
    const effects = (): NameplateEffectInfo[] => {
        if (effectList) return effectList
        const slots = new Map<string, number>()
        if (hasMaterials) {
            try {
                for (const source of Array.from(shaders.sources())) slots.set(source.materialId, source.toneSlots.length)
            } catch (error) {
                console.error('[polyplus_nameplate] reading effect colors failed', error)
            }
        }
        effectList = Array.from(api.nameplateEffects(raw)).map((effect) => ({
            layer: effect.layer,
            material: effect.material,
            reads: Array.from(effect.reads),
            animated: Array.from(effect.animated),
            states: effect.states,
            shotStates: effect.shotStates,
            toneSlots: slots.has(effect.material) ? slots.get(effect.material)! : null,
        }))
        return effectList
    }
    const paramCurve = (layer: string, param: string, variant: string, from: number, count: number, state?: NameplateTagState | null): number[] =>
        Array.from(api.nameplateParamCurve(raw, layer, param, variant, from, count, 0, state ? rawStates.get(state) ?? null : null, false))
    let letterMotion: RawLetterMotion | null | undefined
    const motion = (): RawLetterMotion | null => {
        if (letterMotion === undefined) {
            try {
                letterMotion = new api.NameplateLetterMotion(raw)
            } catch (error) {
                console.error('[polyplus_nameplate] reading the letter program failed', error)
                letterMotion = null
            }
        }
        return letterMotion
    }
    const letters = (
        variant: string,
        block: NameplateBlock,
        frame: number,
        seed: number,
        glyphX: Int32Array,
        glyphWidth: Int32Array,
        state?: NameplateTagState | null,
        detail?: NameplateDetail,
    ): NameplateLetters | null => {
        const letterMotion = motion()
        if (!letterMotion || !letterMotion.canMove) return null
        const out = letterMotion.letters(variant, block, frame, seed, glyphX, glyphWidth, shownState(state, detail))
        return {
            mode: letterMotion.mode(variant),
            count: out.count,
            moving: out.moving,
            dx: out.dx,
            dy: out.dy,
            opacity: out.opacity,
            color: out.color,
            shadow: out.shadow,
            outline: out.outline,
            scale: out.scale,
            rotation: out.rotation,
        }
    }
    return {
        id: raw.id,
        fps: raw.fps,
        loop: raw.loop,
        variants: Array.from(raw.variants),
        reactions: Array.from(raw.reactions),
        oneShots: Array.from(raw.oneShots),
        ownsBackground: (variant) => raw.ownsBackground(variant),
        paint(variant, block, frame, seed, state, detail) {
            raw.detail = detail ?? 'full'
            const layers = Array.from(raw.paint(variant, block, frame, seed, shownState(state, detail)))
            if (!hasMaterials || !materialDrawsWanted()) return layers
            try {
                return attachDraws(layers, materials(variant, block, frame, seed, state, detail))
            } catch (error) {
                console.error('[polyplus_nameplate] preparing effects for the graphics card failed', error)
                return layers
            }
        },
        badgePose: (frame, seed, state, detail) => poseOf(raw.badgePose(frame, seed, shownState(state, detail))),
        platePose: (variant, block, frame, seed, state, detail) => poseOf(raw.platePose(variant, block, frame, seed, shownState(state, detail))),
        badgeFollow: (variant, block, frame, seed, state, detail) => poseOf(raw.badgeFollow(variant, block, frame, seed, shownState(state, detail))),
        badgeSpot(variant, block) {
            const spot = raw.badgeSpot(variant, block)
            return spot ? [spot[0], spot[1]] : null
        },
        cost: (flash) => wrapCost(api.nameplateCost(raw, flash), raw),
        record: () => wrapRecord(raw),
        hasMaterials,
        materials,
        shaders: shaderList,
        shader: (key) => shaderList().find((source) => source.key === key) ?? null,
        texture: (path) => textures.get(path) ?? null,
        letters,
        movesLetters: () => !!motion()?.canMove,
        effects,
        paramCurve,
    }
}

export function nameplateLimits(): NameplateLimits {
    return api.NameplateLimits
}

export const ENGINE_CAPABILITIES: string[] = Array.from(new Set([...CAPABILITIES, api.NameplateLayout.capability].filter(Boolean)))

export function stateOf(reactions: string[], reduced = false): NameplateTagState {
    return wrapState(api.nameplateState(reactions, reduced))
}

export function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

interface Unbudgeted {
    measure: (flash: boolean) => NameplateCost | null
    draft: () => NameplatePreview | null
}

type RawFile = EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplateFile
type RawBinary = EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplateBinary
type RawPixels = EngineModule.org.polyfrost.polyplus.nameplate.engine.js.NameplatePixels

interface RawAssets {
    binaries: RawBinary[]
    pixels: RawPixels[]
    textures: Map<string, TexturePixels>
}

interface DecodedTexture {
    raw: RawPixels
    pixels: TexturePixels
}

let binarySource: (() => BundleBinary) | null = null
const decoded = new WeakMap<Uint8Array, DecodedTexture | null>()

export function setBinarySource(source: (() => BundleBinary) | null) {
    binarySource = source
}

export function currentBinary(): BundleBinary {
    try {
        return binarySource?.() ?? {}
    } catch (error) {
        console.error('[polyplus_nameplate] reading bundle textures failed', error)
        return {}
    }
}

function pixelsOf(path: string, bytes: Uint8Array): DecodedTexture | null {
    if (decoded.has(bytes)) return decoded.get(bytes) ?? null
    let entry: DecodedTexture | null = null
    try {
        const png = decodePng(bytes)
        const rgba = new Uint8Array(png.rgba.buffer, png.rgba.byteOffset, png.rgba.byteLength)
        entry = { raw: new api.NameplatePixels(path, png.width, png.height, png.rgba as any), pixels: { width: png.width, height: png.height, rgba } }
    } catch {
        entry = null
    }
    decoded.set(bytes, entry)
    return entry
}

function assetsOf(binary: BundleBinary): RawAssets {
    const binaries: RawBinary[] = []
    const pixels: RawPixels[] = []
    const textures = new Map<string, TexturePixels>()
    for (const [path, bytes] of Object.entries(binary)) {
        binaries.push(new api.NameplateBinary(path, bytes as any))
        if (/\.png$/i.test(path)) {
            const entry = pixelsOf(path, bytes)
            if (entry) {
                pixels.push(entry.raw)
                textures.set(path, entry.pixels)
            }
        }
    }
    return { binaries, pixels, textures }
}

function withPlaceholders(raw: RawPreview, assets: RawAssets): RawPreview {
    try {
        const refs = Array.from(api.nameplateTextureRefs(raw)).filter((ref) => ref.kind !== 'bundle')
        if (!refs.length) return raw
        const extra = refs.map((ref) => {
            const art = placeholderPixels(ref.kind as TextureKind, ref.id, false)
            return new api.NameplatePixels(ref.path, art.width, art.height, art.rgba as any)
        })
        return api.nameplateWithTextures(raw, [...assets.pixels, ...extra])
    } catch (error) {
        console.error('[polyplus_nameplate] adding stand-in textures failed', error)
        return raw
    }
}

function unbudgeted(input: RawFile[], assets: RawAssets): Unbudgeted {
    let raw: RawPreview | null | undefined
    let wrapped: NameplatePreview | null = null
    const load = (): RawPreview | null => {
        if (raw !== undefined) return raw
        try {
            const loaded = api.nameplateLoadPreview(input, ENGINE_CAPABILITIES, assets.binaries, assets.pixels).preview ?? null
            raw = loaded ? withPlaceholders(loaded, assets) : null
        } catch (error) {
            console.error('[polyplus_nameplate] loading an over-budget nameplate failed', error)
            raw = null
        }
        return raw
    }
    return {
        measure(flash) {
            const preview = load()
            if (!preview) return null
            try {
                return wrapCost(api.nameplateCost(preview, flash), preview)
            } catch (error) {
                console.error('[polyplus_nameplate] measuring an over-budget nameplate failed', error)
                return null
            }
        },
        draft() {
            const preview = load()
            if (!preview) return null
            wrapped ??= wrapPreview(preview, assets.textures)
            return wrapped
        },
    }
}

export function loadBundle(files: Record<string, string>, binary?: BundleBinary): LoadedBundle {
    try {
        const input = Object.entries(files).map(([path, text]) => new api.NameplateFile(path, text))
        const assets = assetsOf(binary ?? currentBinary())
        const load = api.nameplateLoad(input, ENGINE_CAPABILITIES, assets.binaries, assets.pixels)
        const issues = issuesOf(load.issues)
        const raw = load.preview ? withPlaceholders(load.preview, assets) : null
        const skipped = load.skipped ?? null
        const fallback = !raw && !skipped && issues.length ? unbudgeted(input, assets) : null
        return {
            preview: raw ? wrapPreview(raw, assets.textures) : null,
            skipped,
            issues,
            measure: fallback?.measure,
            draft: fallback?.draft,
        }
    } catch (error) {
        return { preview: null, skipped: null, issues: [{ path: '', message: describe(error) }] }
    }
}

export function lineBlock(textWidth: number, nameX: number, nameWidth: number): NameplateBlock {
    return api.nameplateLineBlock(textWidth, nameX, nameWidth)
}

export function displayBlock(
    widths: number[],
    maxWidth: number,
    align: LineAlign,
    nameLine: number,
    nameX: number,
    nameWidth: number,
    badge: boolean,
): NameplateBlock {
    return api.nameplateDisplayBlock(Int32Array.from(widths), maxWidth, align, nameLine, nameX, nameWidth, badge)
}

export function placedBlock(block: NameplateBlock, prefixWidth: number, background: BlockRect): NameplateBlock {
    return block.placed(prefixWidth, background.x0, background.y0, background.x1, background.y1)
}

export function layerLeft(layer: NameplateLayer): number {
    return layer.mirrorX ? layer.x + layer.width - (layer.left + layer.rasterWidth) : layer.x + layer.left
}

export function layerTop(layer: NameplateLayer): number {
    return layer.y + layer.top
}

export function layerBounds(layers: NameplateLayer[]): LayerBounds {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const layer of layers) {
        if (layer.rasterWidth <= 0 || layer.rasterHeight <= 0) continue
        const left = layerLeft(layer)
        const top = layerTop(layer)
        minX = Math.min(minX, left)
        minY = Math.min(minY, top)
        maxX = Math.max(maxX, left + layer.rasterWidth)
        maxY = Math.max(maxY, top + layer.rasterHeight)
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, width: 1, height: 1 }
    return { minX, minY, width: maxX - minX, height: maxY - minY }
}

export type LayerDrawer = (ctx: CanvasRenderingContext2D, layers: NameplateLayer[], scale: number, originX: number, originY: number) => void

let layerDrawer: LayerDrawer | null = null

export function setLayerDrawer(drawer: LayerDrawer | null) {
    layerDrawer = drawer
}

export function rasterCanvas(layer: NameplateLayer): HTMLCanvasElement | null {
    if (layer.rasterWidth <= 0 || layer.rasterHeight <= 0) return null
    const raster = document.createElement('canvas')
    raster.width = layer.rasterWidth
    raster.height = layer.rasterHeight
    const rasterContext = raster.getContext('2d')
    if (!rasterContext) return null
    rasterContext.putImageData(new ImageData(new Uint8ClampedArray(layer.rgba), layer.rasterWidth, layer.rasterHeight), 0, 0)
    return raster
}

export interface RasterStyle {
    raster?: CanvasImageSource | null
    additive?: boolean
}

export function drawRasterLayer(
    ctx: CanvasRenderingContext2D,
    layer: NameplateLayer,
    scale: number,
    originX: number,
    originY: number,
    style: RasterStyle = {},
) {
    const raster = style.raster === undefined ? rasterCanvas(layer) : style.raster
    if (!raster) return
    const dx = originX + layerLeft(layer) * scale
    const dy = originY + layerTop(layer) * scale
    const dw = layer.rasterWidth * scale
    const dh = layer.rasterHeight * scale
    ctx.save()
    ctx.globalAlpha = layer.opacity / 255
    if (style.additive ?? layer.blend === 'additive') ctx.globalCompositeOperation = 'lighter'
    if (layer.mirrorX) {
        ctx.translate(dx + dw, dy)
        ctx.scale(-1, 1)
        ctx.drawImage(raster, 0, 0, dw, dh)
    } else {
        ctx.drawImage(raster, dx, dy, dw, dh)
    }
    ctx.restore()
}

export function drawLayers(
    ctx: CanvasRenderingContext2D,
    layers: NameplateLayer[],
    scale: number,
    originX: number,
    originY: number,
) {
    ctx.imageSmoothingEnabled = false
    if (layerDrawer) {
        try {
            layerDrawer(ctx, layers, scale, originX, originY)
            return
        } catch (error) {
            console.error('[polyplus_nameplate] drawing layers failed, showing plain pixels', error)
        }
    }
    for (const layer of layers) drawRasterLayer(ctx, layer, scale, originX, originY)
}
