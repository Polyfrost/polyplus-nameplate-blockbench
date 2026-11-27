import { Nameplates, OUT, SIGNALS } from '@plusrenderer/renderer/nameplate.js'
import { NameplateDrawer } from '@plusrenderer/renderer/nameplate-gl.js'
import { blockRow, NameplateBlock } from './block'
import { NameplateLayer } from './draw'
import { NameplatePreview, NameplateTagState, reactionSignal, stoppedEpisodes } from './load'
import { previewWearer } from './seed'

const COMBAT_SIGNAL = 'is_in_combat'

export interface TagJob {
    preview: NameplatePreview
    block: NameplateBlock
    variant: number
    frame: number
    seed: number
    state: NameplateTagState | null
    detail: number
    motion: number
    layers: NameplateLayer[]
}

export interface GlLayerImage {
    image: HTMLCanvasElement
    left: number
    top: number
    scale: number
}

export type GlLayers = ReadonlyMap<number, GlLayerImage>

export interface GlStage {
    width: number
    height: number
    originX: number
    originY: number
}

export interface DrawnBox {
    x0: number
    y0: number
    x1: number
    y1: number
    material: boolean
}

export type PlaceholderSource = (kind: string, id: string) => { width: number, height: number, rgba: Uint8Array }

export type GlLight = [number, number, number]

export interface AtlasSheet {
    width: number
    height: number
    rgba: Uint8Array
    sprites: Record<string, [number, number, number, number]>
}

export interface ReplayStep {
    frame: number
    on: string[]
    fire: string[]
}

export interface ReplayShot {
    name: string
    trigger: string
    signal: string | null
    keep: number
    appear: number | null
    length?: number
}

interface GlTag {
    nameplates: Nameplates
    drawer: NameplateDrawer
    assetId: number
    failed: boolean
}

interface PoseTag {
    nameplates: Nameplates
    assetId: number
}

export type PoseJob = Omit<TagJob, 'layers'>

interface Surface {
    canvas: HTMLCanvasElement
    gl: WebGL2RenderingContext
}

const FRONT_DEPTH = 'over_text'
const KEEP_TAGS = 2
const KEEP_IMAGE_SETS = 48
const KEEP_IMAGE_BYTES = 64 * 1024 * 1024
const MAX_SURFACE = 4096
const MAX_PIXEL_SCALE = 16
const ALIVE_SECONDS = 20
const MAX_REPLAY_SECONDS = 600

const jobs = new WeakMap<NameplateLayer, TagJob>()
const tags = new Map<NameplatePreview, GlTag>()
const poseTags = new Map<NameplatePreview, PoseTag | null>()
const jobIds = new WeakMap<TagJob, number>()
let nextJobId = 1
let surface: Surface | null | undefined
let placeholders: PlaceholderSource | null = null
let replayRule: () => boolean = () => false

export function setFullReplay(rule: (() => boolean) | null) {
    replayRule = rule ?? (() => false)
}

export function fullReplay(): boolean {
    try {
        return replayRule()
    } catch (error) {
        console.error('[polyplus_nameplate] checking the preview look failed', error)
        return false
    }
}

export function setPlaceholderSource(source: PlaceholderSource | null) {
    placeholders = source
}

export function placeholderSource(): PlaceholderSource | null {
    return placeholders
}

export function rememberJob(job: TagJob) {
    for (const layer of job.layers) jobs.set(layer, job)
}

export function tagJobOf(layer: NameplateLayer): TagJob | null {
    return jobs.get(layer) ?? null
}

function surfaceOf(): Surface | null {
    if (surface !== undefined) return surface
    surface = null
    if (typeof document === 'undefined') return surface
    try {
        const canvas = document.createElement('canvas')
        const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, stencil: true, antialias: false, preserveDrawingBuffer: true })
        if (gl) surface = { canvas, gl }
    } catch (error) {
        console.error('[polyplus_nameplate] WebGL2 is not available', error)
    }
    return surface
}

export function glAvailable(): boolean {
    return !!surfaceOf()
}

function disposeTag(tag: GlTag) {
    try {
        tag.drawer.dispose()
        tag.nameplates.free()
    } catch (error) {
        console.error('[polyplus_nameplate] releasing a preview on the graphics card failed', error)
    }
}

function textureNames(preview: NameplatePreview): Array<{ kind: string, name: string }> {
    const names: Array<{ kind: string, name: string }> = []
    for (const shader of preview.asset.shaders('es_300').shaders) {
        for (const sampler of shader.samplers) {
            const texture = sampler.texture
            if (texture.kind !== 'bundle' && !names.some((entry) => entry.kind === texture.kind && entry.name === texture.name)) names.push({ kind: texture.kind, name: texture.name })
        }
    }
    return names
}

export function packAtlas(names: readonly string[], art: (name: string) => { width: number, height: number, rgba: Uint8Array }): AtlasSheet | null {
    const unique = [...new Set(names)]
    if (!unique.length) return null
    const pictures = unique.map((name) => ({ name, ...art(name) }))
    const cellWidth = Math.max(1, ...pictures.map((picture) => picture.width))
    const cellHeight = Math.max(1, ...pictures.map((picture) => picture.height))
    const columns = Math.ceil(Math.sqrt(pictures.length))
    const rows = Math.ceil(pictures.length / columns)
    const width = columns * cellWidth
    const height = rows * cellHeight
    const rgba = new Uint8Array(width * height * 4)
    const sprites: AtlasSheet['sprites'] = {}
    pictures.forEach((picture, index) => {
        const x = (index % columns) * cellWidth
        const y = Math.floor(index / columns) * cellHeight
        const stride = picture.width * 4
        for (let row = 0; row < picture.height; row++) {
            rgba.set(picture.rgba.subarray(row * stride, (row + 1) * stride), ((y + row) * width + x) * 4)
        }
        sprites[picture.name] = [x, y, picture.width, picture.height]
    })
    return { width, height, rgba, sprites }
}

function freePoseTag(tag: PoseTag | null | undefined) {
    try {
        tag?.nameplates.free()
    } catch (error) {
        console.error('[polyplus_nameplate] releasing a preview replay failed', error)
    }
}

function poseTagOf(preview: NameplatePreview): PoseTag | null {
    if (preview.disposed) return null
    if (poseTags.has(preview)) return poseTags.get(preview) ?? null
    while (poseTags.size >= KEEP_TAGS) {
        const [oldest, tag] = poseTags.entries().next().value as [NameplatePreview, PoseTag | null]
        poseTags.delete(oldest)
        freePoseTag(tag)
    }
    let nameplates: Nameplates | null = null
    try {
        nameplates = preview.asset.engine.nameplates()
        const tag = { nameplates, assetId: nameplates.addAsset(preview.asset) }
        poseTags.set(preview, tag)
        return tag
    } catch (error) {
        console.error('[polyplus_nameplate] preparing a preview replay failed', error)
        if (nameplates) freePoseTag({ nameplates, assetId: 0 })
        poseTags.set(preview, null)
        return null
    }
}

export function forgetGlPreview(preview: NameplatePreview) {
    if (poseTags.has(preview)) {
        freePoseTag(poseTags.get(preview))
        poseTags.delete(preview)
    }
    const tag = tags.get(preview)
    if (!tag) return
    tags.delete(preview)
    if (!tag.failed) disposeTag(tag)
}

function tagOf(preview: NameplatePreview, gl: WebGL2RenderingContext): GlTag | null {
    if (preview.disposed) return null
    const known = tags.get(preview)
    if (known) return known.failed ? null : known
    while (tags.size >= KEEP_TAGS) {
        const [oldest, tag] = tags.entries().next().value as [NameplatePreview, GlTag]
        tags.delete(oldest)
        disposeTag(tag)
    }
    const nameplates = preview.asset.engine.nameplates()
    let tag: GlTag
    let drawer: NameplateDrawer | null = null
    try {
        const assetId = nameplates.addAsset(preview.asset)
        drawer = new NameplateDrawer(gl, nameplates)
        drawer.setAssetShaders(assetId, preview.asset.shaders('es_300'))
        drawer.setBundleTextures(assetId, preview.textures())
        const names = placeholders ? textureNames(preview) : []
        for (const { kind, name } of names) {
            if (kind === 'atlas') continue
            const art = placeholders!(kind, name)
            drawer.setTexture(`${kind}:${name}`, art.rgba, art.width, art.height)
        }
        const sheet = packAtlas(names.filter((entry) => entry.kind === 'atlas').map((entry) => entry.name), (name) => placeholders!('atlas', name))
        if (sheet) drawer.setAtlas(sheet.rgba, sheet.width, sheet.height, sheet.sprites)
        tag = { nameplates, drawer, assetId, failed: false }
    } catch (error) {
        console.error('[polyplus_nameplate] preparing the preview on the graphics card failed', error)
        try {
            drawer?.dispose()
        } catch (cleanup) {
            console.error('[polyplus_nameplate] releasing a preview on the graphics card failed', cleanup)
        }
        nameplates.free()
        tags.set(preview, { nameplates, drawer: null as unknown as NameplateDrawer, assetId: 0, failed: true })
        return null
    }
    tags.set(preview, tag)
    return tag
}

export function straightRows(pixels: Uint8Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
    const out = new Uint8ClampedArray(pixels.length)
    const stride = width * 4
    for (let y = 0; y < height; y++) {
        const from = (height - 1 - y) * stride
        const to = y * stride
        for (let x = 0; x < stride; x += 4) {
            const alpha = pixels[from + x + 3]
            out[to + x + 3] = alpha
            if (alpha === 0) continue
            for (let c = 0; c < 3; c++) out[to + x + c] = alpha === 255 ? pixels[from + x + c] : Math.round((pixels[from + x + c] * 255) / alpha)
        }
    }
    return out
}

export function opaqueBox(rgba: ArrayLike<number>, width: number, height: number): [number, number, number, number] | null {
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (rgba[(y * width + x) * 4 + 3] === 0) continue
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
        }
    }
    return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1]
}

export function litRows(rgba: Uint8ClampedArray, light: GlLight) {
    const scales = light.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255) / 255)
    if (scales.every((value) => value === 1)) return
    for (let at = 0; at < rgba.length; at += 4) {
        if (rgba[at + 3] === 0) continue
        for (let c = 0; c < 3; c++) rgba[at + c] = Math.round(rgba[at + c] * scales[c])
    }
}

function imageOf(gl: WebGL2RenderingContext, surfaceHeight: number, box: DrawnBox, light: GlLight | null): { canvas: HTMLCanvasElement, x: number, y: number } | null {
    const width = box.x1 - box.x0
    const height = box.y1 - box.y0
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(box.x0, surfaceHeight - box.y1, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const flipped = straightRows(pixels, width, height)
    const inner = opaqueBox(flipped, width, height)
    if (!inner) return null
    if (light) litRows(flipped, light)
    const [x, y, w, h] = inner
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')?.putImageData(new ImageData(flipped, width, height), -x, -y, x, y, w, h)
    return { canvas, x: box.x0 + x, y: box.y0 + y }
}

export function signalsOf(on: readonly string[], values: Readonly<Record<string, number>> = {}): Float32Array {
    const signals = new Float32Array(OUT.SIGNAL_FLOATS)
    for (const [signal, value] of Object.entries(values)) {
        const index = SIGNALS.indexOf(signal)
        if (index >= 0 && index < signals.length && Number.isFinite(value)) signals[index] = value
    }
    for (const signal of on) {
        const index = SIGNALS.indexOf(signal)
        if (index >= 0) signals[index] = 1
    }
    return signals
}

interface EndedRun {
    signal: string
    edges: [number, number]
}

function pinEarly(starts: Map<string, number>, ended: EndedRun[], limit: number): EndedRun[] {
    const kept = ended.filter((run) => run.edges[1] >= limit)
    const early: Array<{ at: number, signal: string, move: (at: number) => void }> = []
    for (const [signal, at] of starts) if (Number.isFinite(at) && at < limit) early.push({ at, signal, move: (to) => starts.set(signal, to) })
    for (const { signal, edges } of kept) if (Number.isFinite(edges[0]) && edges[0] < limit) early.push({ at: edges[0], signal, move: (to) => (edges[0] = to) })
    early.sort((a, b) => a.at - b.at || (a.signal < b.signal ? -1 : a.signal > b.signal ? 1 : 0))
    early.forEach((edge, i) => edge.move(limit - early.length + i))
    return kept
}

export function replaySteps(state: NameplateTagState | null, frame: number, fps: number, shots: readonly ReplayShot[] = []): ReplayStep[] {
    const rate = Math.max(1, fps)
    const appear = shots.filter((shot) => shot.trigger === 'appear')
    const warm = Math.max(1, ...appear.map((shot) => shot.keep + 1))
    const shortest = Math.min(ALIVE_SECONDS, ...appear.map((shot) => shot.appear ?? ALIVE_SECONDS))
    const alive = (shortest * rate) / 2
    const sparse = (ALIVE_SECONDS * rate) / 2
    const denseFrom = frame - (2 * Math.max(0, ...shots.map((shot) => shot.keep)) + warm + alive)
    const limit = Math.floor(Math.min(frame - MAX_REPLAY_SECONDS * rate, denseFrom - warm))
    const starts = new Map<string, number>()
    for (const signal of new Set((state?.reactions ?? []).map(reactionSignal))) {
        const held = state?.heldBy?.[signal] ?? state?.held
        starts.set(signal, held === undefined ? -Infinity : frame - held)
    }
    const runs: EndedRun[] = []
    for (const [signal, episodes] of Object.entries(stoppedEpisodes(state))) {
        const since = starts.get(signal)
        for (const [onFor, offFor] of episodes) {
            if (!(offFor >= 0)) continue
            const off = frame - offFor
            if (since !== undefined && off > since) continue
            const on = Number.isFinite(onFor) ? Math.min(off - 1, frame - onFor) : -Infinity
            runs.push({ signal, edges: [on, off] })
        }
    }
    const ended = pinEarly(starts, runs, limit)
    const marks = new Map<number, string[]>([[frame, []]])
    const mark = (at: number) => marks.get(at) ?? marks.set(at, []).get(at)!
    for (const at of starts.values()) if (Number.isFinite(at)) mark(at)
    for (const { edges: [on, off] } of ended) {
        if (Number.isFinite(on)) mark(on)
        mark(off)
    }
    const firing: Array<{ at: number, name: string }> = []
    const plan = (name: string, start: number | undefined) => {
        const at = Math.min(frame, start ?? frame)
        const length = shots.find((shot) => shot.name === name)?.length ?? 0
        mark(at)
        if (length > 0 && at + length <= frame) mark(at + length)
        firing.push({ at, name })
    }
    state?.oneShots.forEach((name, index) => plan(name, state.starts[index]))
    for (const [name, start] of state?.speedShots ?? []) plan(name, start)
    const times = Array.from(marks.keys()).sort((a, b) => a - b)
    const origin = state?.observedFor === undefined ? null : frame - state.observedFor
    const shownAt = (name: string, at: number) => state?.oneShots.some((shot, index) => shot === name && state.starts[index] === at) ?? false
    const exact = origin !== null && origin >= limit && times[0] >= origin && appear.every((shot) => frame - origin >= shot.keep || shownAt(shot.name, origin))
    const lead = origin !== null && origin >= limit ? Math.min(times[0], origin) : times[0]
    const first = exact ? lead : lead - warm
    const edgeOf = (shot: ReplayShot | undefined, at: number): boolean => {
        if (exact && shot?.trigger === 'appear' && at === origin) return true
        if (!shot?.signal) return false
        const own = ended.filter((run) => run.signal === shot.signal)
        if (shot.trigger === 'start') return starts.get(shot.signal) === at || own.some((run) => run.edges[0] === at)
        return shot.trigger === 'stop' && own.some((run) => run.edges[1] === at)
    }
    for (const { at, name } of firing) if (!edgeOf(shots.find((entry) => entry.name === name), at)) marks.get(at)!.push(name)
    const gap = (at: number) => (at < denseFrom ? Math.min(sparse, denseFrom - at) : alive)
    const onAt = (at: number) => Array.from(new Set([
        ...Array.from(starts).filter(([, since]) => at >= since).map(([signal]) => signal),
        ...ended.filter(({ edges: [on, off] }) => at >= on && at < off).map(({ signal }) => signal),
    ]))
    const steps: ReplayStep[] = [{ frame: first, on: onAt(first), fire: marks.get(first) ?? [] }]
    for (const at of times) {
        if (at <= first) continue
        const last = steps[steps.length - 1].frame
        for (let step = last + gap(last); step < at; step += gap(step)) steps.push({ frame: step, on: onAt(step), fire: [] })
        steps.push({ frame: at, on: onAt(at), fire: marks.get(at)! })
    }
    return steps
}

export function replayShots(preview: NameplatePreview): ReplayShot[] {
    return (preview.meta.animations?.one_shots ?? []).map((shot) => {
        const timing = preview.shotTiming(shot.name)
        return { name: shot.name, trigger: shot.trigger, signal: shot.signal, keep: Math.max(timing.length, timing.tail), appear: timing.appear, length: timing.length }
    })
}

export function glPixelScale(width: number, height: number, scale: number): number {
    const wanted = Number.isFinite(scale) && scale > 0 ? Math.min(MAX_PIXEL_SCALE, scale) : 1
    const fits = MAX_SURFACE / Math.max(1, width, height)
    return Math.max(1, Math.min(wanted, fits))
}

export function onlyLayer(out: Int32Array, slot: number): Int32Array {
    const only = out.slice()
    const dir = OUT.OUT_HEADER
    const at = only[dir + OUT.DIR_OFFSET]
    if (only[dir + OUT.DIR_STATUS] !== OUT.STATUS_OK || only[dir + OUT.DIR_LEN] < OUT.TAG_HEAD) return only
    const opCount = only[at + OUT.HEAD_OPS]
    const materialCount = only[at + OUT.HEAD_MATERIALS]
    const opsAt = at + OUT.TAG_HEAD
    for (let k = 0; k < opCount; k++) {
        const op = opsAt + k * OUT.OP_WORDS
        if (((only[op + OUT.OP_BAND_LAYER_KIND] >> 8) & 0xff) === slot) continue
        only[op + OUT.OP_X1] = only[op + OUT.OP_X0]
        only[op + OUT.OP_Y1] = only[op + OUT.OP_Y0]
    }
    let material = opsAt + opCount * OUT.OP_WORDS
    for (let m = 0; m < materialCount; m++) {
        if (((only[material + OUT.MAT_BAND_LAYER] >> 8) & 0xff) !== slot) {
            only[material + OUT.MAT_AREA_X1] = only[material + OUT.MAT_AREA_X0]
            only[material + OUT.MAT_AREA_Y1] = only[material + OUT.MAT_AREA_Y0]
        }
        material += OUT.MAT_FIXED + only[material + OUT.MAT_CLIP_COUNT] * OUT.CLIP_WORDS + only[material + OUT.MAT_UNIFORM_WORDS]
    }
    return only
}

export function drawnBoxes(out: Int32Array): Map<number, DrawnBox> {
    const boxes = new Map<number, DrawnBox>()
    const dir = OUT.OUT_HEADER
    const at = out[dir + OUT.DIR_OFFSET]
    if (out[dir + OUT.DIR_STATUS] !== OUT.STATUS_OK || out[dir + OUT.DIR_LEN] < OUT.TAG_HEAD) return boxes
    const add = (slot: number, ax: number, ay: number, bx: number, by: number, material: boolean) => {
        const x0 = Math.min(ax, bx)
        const y0 = Math.min(ay, by)
        const x1 = Math.max(ax, bx)
        const y1 = Math.max(ay, by)
        if (x1 <= x0 || y1 <= y0) return
        const box = boxes.get(slot)
        if (!box) {
            boxes.set(slot, { x0, y0, x1, y1, material })
            return
        }
        box.x0 = Math.min(box.x0, x0)
        box.y0 = Math.min(box.y0, y0)
        box.x1 = Math.max(box.x1, x1)
        box.y1 = Math.max(box.y1, y1)
        box.material ||= material
    }
    const opCount = out[at + OUT.HEAD_OPS]
    const materialCount = out[at + OUT.HEAD_MATERIALS]
    const opsAt = at + OUT.TAG_HEAD
    for (let k = 0; k < opCount; k++) {
        const op = opsAt + k * OUT.OP_WORDS
        add((out[op + OUT.OP_BAND_LAYER_KIND] >> 8) & 0xff, out[op + OUT.OP_X0], out[op + OUT.OP_Y0], out[op + OUT.OP_X1], out[op + OUT.OP_Y1], false)
    }
    let material = opsAt + opCount * OUT.OP_WORDS
    for (let m = 0; m < materialCount; m++) {
        add((out[material + OUT.MAT_BAND_LAYER] >> 8) & 0xff, out[material + OUT.MAT_AREA_X0], out[material + OUT.MAT_AREA_Y0], out[material + OUT.MAT_AREA_X1], out[material + OUT.MAT_AREA_Y1], true)
        material += OUT.MAT_FIXED + out[material + OUT.MAT_CLIP_COUNT] * OUT.CLIP_WORDS + out[material + OUT.MAT_UNIFORM_WORDS]
    }
    return boxes
}

export interface SurfacePlan {
    pixels: number
    width: number
    height: number
    originX: number
    originY: number
}

export function surfacePlan(stage: GlStage, scale: number): SurfacePlan {
    const shown = Number.isFinite(scale) && scale > 0 ? scale : 1
    const pixels = glPixelScale(Math.max(1, stage.width) / shown, Math.max(1, stage.height) / shown, shown)
    const ratio = pixels / shown
    return {
        pixels,
        width: Math.max(1, Math.min(MAX_SURFACE, Math.ceil(stage.width * ratio))),
        height: Math.max(1, Math.min(MAX_SURFACE, Math.ceil(stage.height * ratio))),
        originX: stage.originX * ratio,
        originY: stage.originY * ratio,
    }
}

export function surfaceBox(box: DrawnBox, plan: SurfacePlan, shiftX: number, shiftY: number): DrawnBox | null {
    const x0 = Math.max(0, Math.floor(plan.originX + (shiftX + box.x0) * plan.pixels))
    const y0 = Math.max(0, Math.floor(plan.originY + (shiftY + box.y0) * plan.pixels))
    const x1 = Math.min(plan.width, Math.ceil(plan.originX + (shiftX + box.x1) * plan.pixels))
    const y1 = Math.min(plan.height, Math.ceil(plan.originY + (shiftY + box.y1) * plan.pixels))
    return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1, material: box.material } : null
}

export class ImageSets<T> {
    private readonly sets = new Map<string, { value: T, bytes: number }>()
    private total = 0

    constructor(private readonly maxSets: number, private readonly maxBytes: number) {}

    get bytes(): number {
        return this.total
    }

    get size(): number {
        return this.sets.size
    }

    has(key: string): boolean {
        return this.sets.has(key)
    }

    get(key: string): T | undefined {
        const entry = this.sets.get(key)
        if (!entry) return undefined
        this.sets.delete(key)
        this.sets.set(key, entry)
        return entry.value
    }

    set(key: string, value: T, bytes: number) {
        const old = this.sets.get(key)
        if (old) {
            this.total -= old.bytes
            this.sets.delete(key)
        }
        if (bytes > this.maxBytes) return
        this.sets.set(key, { value, bytes })
        this.total += bytes
        while (this.sets.size > this.maxSets || this.total > this.maxBytes) {
            const [oldest, entry] = this.sets.entries().next().value as [string, { value: T, bytes: number }]
            this.sets.delete(oldest)
            this.total -= entry.bytes
        }
    }

    clear() {
        this.sets.clear()
        this.total = 0
    }
}

const imageCache = new ImageSets<GlLayers | null>(KEEP_IMAGE_SETS, KEEP_IMAGE_BYTES)

function imageBytes(images: GlLayers | null): number {
    let bytes = 0
    for (const image of images?.values() ?? []) bytes += image.image.width * image.image.height * 4
    return bytes
}

function jobId(job: TagJob): number {
    let id = jobIds.get(job)
    if (id === undefined) {
        id = nextJobId++
        jobIds.set(job, id)
    }
    return id
}

export function glLayers(job: TagJob, light: GlLight, scale: number, stage: GlStage): GlLayers | null {
    const plan = surfacePlan(stage, scale)
    const key = `${jobId(job)}|${light.join()}|${plan.pixels}|${plan.width}x${plan.height}|${plan.originX},${plan.originY}`
    if (imageCache.has(key)) return imageCache.get(key) ?? null
    let images: GlLayers | null = null
    try {
        images = drawLayerImages(job, light, plan)
    } catch (error) {
        console.error('[polyplus_nameplate] drawing the preview on the graphics card failed', error)
        images = null
    }
    imageCache.set(key, images, imageBytes(images))
    return images
}

export type ReplayNameplates = Pick<Nameplates, 'setMotion' | 'forgetWearer' | 'setSignalOverride' | 'frame' | 'fire'>

export interface ReplayInput {
    wearer: bigint
    assetId: number
    motion: number
    fps: number
    frame: number
    state: NameplateTagState | null
    shotNames: readonly string[]
    shots: readonly ReplayShot[]
    glyphs?: Float32Array
}

export function replayFrames(nameplates: ReplayNameplates, input: ReplayInput, row: Int32Array): Int32Array {
    nameplates.setMotion(input.motion)
    const { wearer } = input
    const fps = Math.max(1, input.fps)
    nameplates.forgetWearer(wearer)
    let out: Int32Array = new Int32Array(0)
    for (const step of replaySteps(input.state, input.frame, fps, input.shots)) {
        nameplates.setSignalOverride(wearer, COMBAT_SIGNAL, step.on.includes(COMBAT_SIGNAL) ? 1 : 0)
        const signals = signalsOf(step.on, input.state?.values)
        const draw = () => nameplates.frame((step.frame + 0.5) / fps, [wearer], row, signals, input.glyphs)
        out = draw()
        for (const name of step.fire) {
            const index = input.shotNames.indexOf(name)
            if (index >= 0) nameplates.fire(wearer, input.assetId, index)
        }
        if (step.fire.length) out = draw()
    }
    return out
}

function replayInput(job: PoseJob, assetId: number): ReplayInput {
    return {
        wearer: previewWearer(job.seed),
        assetId,
        motion: job.motion,
        fps: job.preview.fps,
        frame: job.frame,
        state: job.state,
        shotNames: (job.preview.meta.animations?.one_shots ?? []).map((shot) => shot.name),
        shots: replayShots(job.preview),
    }
}

function replayed(job: TagJob, tag: GlTag, row: Int32Array): Int32Array {
    return replayFrames(tag.nameplates, replayInput(job, tag.assetId), row)
}

export function replayedTag(job: PoseJob, glyphs: Float32Array | null): Int32Array | null {
    const tag = poseTagOf(job.preview)
    if (!tag) return null
    const row = blockRow(job.block, tag.assetId, job.variant)
    row[OUT.TAG_DETAIL] = job.detail
    if (glyphs) {
        row[OUT.TAG_GLYPH_OFFSET] = 0
        row[OUT.TAG_GLYPH_COUNT] = Math.floor(glyphs.length / OUT.GLYPH_FLOATS)
    }
    try {
        return replayFrames(tag.nameplates, { ...replayInput(job, tag.assetId), ...(glyphs ? { glyphs } : {}) }, row)
    } catch (error) {
        console.error('[polyplus_nameplate] replaying the preview failed', error)
        return null
    }
}

function drawLayerImages(job: TagJob, light: GlLight, plan: SurfacePlan): GlLayers | null {
    const target = surfaceOf()
    if (!target) return null
    const { canvas, gl } = target
    const tag = tagOf(job.preview, gl)
    if (!tag) return null
    const { width, height, pixels } = plan
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
    }
    const row = blockRow(job.block, tag.assetId, job.variant)
    row[OUT.TAG_DETAIL] = job.detail
    const out = replayed(job, tag, row)
    tag.drawer.setLight([...light, 1])
    const images = new Map<number, GlLayerImage>()
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.enable(gl.SCISSOR_TEST)
    try {
        for (const [slot, drawn] of drawnBoxes(out)) {
            const box = surfaceBox(drawn, plan, job.block.shiftX, job.block.shiftY)
            if (!box) continue
            gl.scissor(box.x0, height - box.y1, box.x1 - box.x0, box.y1 - box.y0)
            gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
            const status = tag.drawer.drawTag(onlyLayer(out, slot), 0, {
                assetId: tag.assetId,
                row,
                viewport: [width, height],
                transform: { x: plan.originX + job.block.shiftX * pixels, y: plan.originY + job.block.shiftY * pixels, scale: pixels },
            })
            if (status !== OUT.STATUS_OK) return null
            const image = imageOf(gl, height, box, box.material ? null : light)
            if (image) images.set(slot, { image: image.canvas, left: (image.x - plan.originX) / pixels, top: (image.y - plan.originY) / pixels, scale: pixels })
        }
    } finally {
        gl.disable(gl.SCISSOR_TEST)
    }
    return images
}

export function isFrontDepth(depth: string): boolean {
    return depth === FRONT_DEPTH
}

export function disposeGl() {
    for (const tag of tags.values()) if (!tag.failed) disposeTag(tag)
    tags.clear()
    for (const tag of poseTags.values()) freePoseTag(tag)
    poseTags.clear()
    imageCache.clear()
    surface = undefined
}
