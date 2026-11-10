import { currentBundle } from './compile'
import { onHeavy, retainEvents } from './design/events'
import { isGroupNode, isLayerNode, walkNodes } from './elements/nodes'
import { readLayers } from './elements'
import {
    describe,
    loadBundle,
    LoadedBundle,
    NameplateBadgePose,
    NameplateBlock,
    NameplateLayer,
    NameplatePreview,
    NameplateTagState,
    STILL_BADGE,
} from './engine'
import { DEFAULT_FPS, DEFAULT_LOOP_FRAMES, isNameplateActive, onFormatActivation } from './format'
import { BundleIssue, LOOP_ANIMATION } from './model'
import { CrowdLayout, CrowdSpec, CrowdTag, layoutTag, paintCrowd, tagPoses } from './preview/crowd'
import { absoluteFrame, MAIN_TAG, REACTION_LABELS, resetLive, scrubState, ScrubPlan, tagState } from './preview/live'
import { registerPreviewPanel } from './preview/panel'
import { clearPreviewOptions } from './preview/menu'
import { currentLook, effectLayers, LINE_ABOVE, LINE_BELOW, previewOptions, rankAdvance, resetOptions, tagPadding } from './preview/options'
import { measure } from './font'
import { NameLetters, paintLetters } from './text/letters'
import { readNameplate } from './palette/state'
import { styleOf } from './text/style'
import { registerGpu, setComposePreview } from './gpu'
import { createListenerSet } from './util/events'
import { hasProject } from './util/project'
import { disposeAll } from './util/teardown'
import { wholeFlooredClamped } from './util/num'

const FRAME_EPSILON = 1e-6
const CACHE_LIMIT = 4
const MAX_NAME_WIDTH = 200
const GLYPH_ROWS = 8
const PREVIEW_EVENTS = ['display_animation_frame', 'timeline_play', 'timeline_pause', 'select_mode'] as const

export interface PreviewUi {
    variant: string
    seed: number
    nameWidth: number
    autoWidth: boolean
    lines: number
    frame: number
    playing: boolean
    loop: number
    fps: number
    variants: string[]
    issues: BundleIssue[]
    summary: string
    crowd: boolean
}

export type BannerKind = 'over' | 'stale'

export interface PreviewBanner {
    kind: BannerKind
    text: string
}

export interface PreviewResult {
    preview: NameplatePreview | null
    layers: NameplateLayer[]
    frame: number
    files: Record<string, string>
    order: string[]
    crowd: CrowdTag[]
    banner: PreviewBanner | null
    note: string
    badge?: NameplateBadgePose
    plate?: NameplateBadgePose
    letters?: NameLetters | null
}

export interface PreviewOverride {
    variant: string
    note: string
    patch(files: Record<string, string>): Record<string, string>
}

type AnimateKind = 'loop' | 'while' | 'shot' | 'random' | 'missing'

interface AnimatePlan {
    kind: AnimateKind
    name: string
    reaction: string | null
}

interface Drawable {
    preview: NameplatePreview
    order: string[]
    banner: PreviewBanner | null
}

interface Painted {
    frame: number
    local: number
    layers: NameplateLayer[]
    badge: NameplateBadgePose
    plate: NameplateBadgePose
    letters?: NameLetters | null
    crowd: CrowdTag[]
    note: string
    label: string
}

const OVER_BUDGET_BANNER = 'Over the limit: export blocked'
const STALE_BANNER = "This version can't be drawn, so the last good one shows. See Checks."
const LOOP_PLAN: AnimatePlan = { kind: 'loop', name: LOOP_ANIMATION, reaction: null }

export interface NameRow {
    x: number
    y: number
    width: number
    height: number
}

type ResultListener = (result: PreviewResult) => void

export const previewUi: PreviewUi = {
    variant: '',
    seed: 0,
    nameWidth: 27,
    autoWidth: true,
    lines: 1,
    frame: 0,
    playing: false,
    loop: DEFAULT_LOOP_FRAMES,
    fps: DEFAULT_FPS,
    variants: [],
    issues: [],
    summary: '',
    crowd: false,
}

const handles: { listeners: Deletable[], removers: Array<() => void> } = { listeners: [], removers: [] }
const subscribers = createListenerSet<[PreviewResult]>('preview listener failed')
const newProjectHooks = createListenerSet(null)
const seenProjects = new WeakSet<object>()
const cache = new Map<Record<string, string>, LoadedBundle>()

let compiledFiles: Record<string, string> = {}
let compiledIssues: BundleIssue[] = []
let loaded: LoadedBundle | null = null
let last: PreviewResult | null = null
let dirty = true
let active = false
let override: PreviewOverride | null = null
let kept: { project: string, preview: NameplatePreview, order: string[] } | null = null
let parsed: { files: Record<string, string> | null, animations: Record<string, any> } = { files: null, animations: {} }
let derived: { files: Record<string, string> | null, override: PreviewOverride | null, random: string, load: LoadedBundle | null } = {
    files: null,
    override: null,
    random: '',
    load: null,
}

export function loadFiles(files: Record<string, string>): LoadedBundle {
    const hit = cache.get(files)
    if (hit) {
        cache.delete(files)
        cache.set(files, hit)
        return hit
    }
    const result = loadBundle(files)
    cache.set(files, result)
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
    return result
}

export function nameWidthOf(name: string): number {
    return Math.max(1, Math.min(MAX_NAME_WIDTH, measure(String(name ?? '')) - 1))
}

export function referenceName(): string {
    const name = typeof Project !== 'undefined' && Project ? Project.nameplate?.referenceName : ''
    return String(name || 'Steve')
}

function filledName(name: string, width: number): string {
    const letters = Array.from(name)
    let filled = ''
    for (let index = 0; index <= width; index++) {
        const next = filled + letters[index % letters.length]
        if (measure(next) - 1 > width) break
        filled = next
    }
    return filled || letters[0]
}

export function previewName(): string {
    const name = previewOptions.name.trim() || referenceName()
    return previewUi.autoWidth ? name : filledName(name, wholeFlooredClamped(previewUi.nameWidth, 1, MAX_NAME_WIDTH, 27))
}

export function syncNameWidth() {
    if (!previewUi.autoWidth) return
    previewUi.nameWidth = nameWidthOf(previewName())
}

export function lineChoice(): string {
    const lines = wholeFlooredClamped(previewUi.lines, 1, 3, 1)
    return lines === 2 && previewOptions.nameBelow ? '2b' : String(lines)
}

export function setLineChoice(value: string) {
    previewOptions.nameBelow = value === '2b'
    previewUi.lines = wholeFlooredClamped(parseInt(value, 10), 1, 3, 1)
}

function lineText(text: string, fallback: string): string {
    return String(text ?? '').trim() ? String(text) : fallback
}

function reservesBadgeGap(): boolean {
    if (!hasProject()) return false
    try {
        return styleOf(readNameplate(), previewUi.variant).badge.placement !== 'placed'
    } catch {
        return false
    }
}

export function mainSpec(lines = wholeFlooredClamped(previewUi.lines, 1, 3, 1)): CrowdSpec {
    const nameLine = lines === 2 && previewOptions.nameBelow ? 1 : Math.floor((lines - 1) / 2)
    const nameWidth = wholeFlooredClamped(previewUi.nameWidth, 1, MAX_NAME_WIDTH, 27)
    const rank = previewOptions.rank
    const above = Array.from({ length: nameLine }, () => lineText(previewOptions.above, LINE_ABOVE))
    const below = Array.from({ length: lines - 1 - nameLine }, () => lineText(previewOptions.below, LINE_BELOW))
    return {
        name: previewName(),
        rank,
        rankColor: previewOptions.rankColor,
        badge: reservesBadgeGap(),
        above,
        below,
        widths: [...above.map(nameWidthOf), rankAdvance(rank) + nameWidth, ...below.map(nameWidthOf)],
    }
}

export function mainLayout(lines?: number): CrowdLayout {
    return layoutTag(mainSpec(lines), nameWidthOf, tagPadding())
}

export function nameRow(layout: CrowdLayout = mainLayout()): NameRow {
    const run = layout.runs.find((entry) => entry.kind === 'name')
    return {
        x: run?.x ?? 0,
        y: run?.y ?? 0,
        width: run?.width ?? wholeFlooredClamped(previewUi.nameWidth, 1, MAX_NAME_WIDTH, 27),
        height: GLYPH_ROWS,
    }
}

export function currentLoad(): LoadedBundle | null {
    return loaded
}

function inAnimateMode(): boolean {
    return typeof Modes !== 'undefined' && !!Modes && !!Modes.animate
}

function timelineFrame(fps: number): number {
    const time = typeof Timeline !== 'undefined' && Timeline ? Timeline.time || 0 : 0
    return Math.max(0, Math.floor(time * fps + FRAME_EPSILON))
}

function currentFrame(preview: NameplatePreview): number {
    if (inAnimateMode()) return timelineFrame(preview.fps) % Math.max(1, preview.loop)
    return wholeFlooredClamped(previewUi.frame, 0, Math.max(0, preview.loop - 1), 0)
}

export function isPlaying(): boolean {
    if (inAnimateMode()) return typeof Timeline !== 'undefined' && !!Timeline && !!Timeline.playing
    return previewUi.playing
}

export function mainSeed(): number {
    return wholeFlooredClamped(previewUi.seed, 0, 2147483647, 0)
}

export function paintFrame(preview: NameplatePreview, frame: number, state?: NameplateTagState | null, variant = previewUi.variant): NameplateLayer[] {
    const tag = state === undefined ? tagState(MAIN_TAG, variant, frame, mainSeed()) : state
    const look = currentLook()
    return preview.paint(variant, mainLayout().block, look.still ? 0 : frame, mainSeed(), tag, look.detail)
}

function effectFilter(files: Record<string, string>, variant: string): (layer: NameplateLayer) => boolean {
    if (currentLook().effects) return () => true
    const effects = effectLayers(files, variant)
    return (layer) => !effects.has(layer.index)
}

export function hiddenNodes(): Set<string> {
    const hidden = new Set<string>()
    walkNodes((node, parent) => {
        if (!isLayerNode(node) && !isGroupNode(node)) return
        if (node.visibility === false || (parent && hidden.has(parent.uuid))) hidden.add(node.uuid)
    })
    return hidden
}

export function lastResult(): PreviewResult | null {
    return last
}

export function onPreviewResult(listener: ResultListener): () => void {
    return subscribers.on(listener)
}

function publish(result: PreviewResult) {
    last = result
    subscribers.notify(result)
}

export function projectKey(): string {
    return typeof Project !== 'undefined' && Project ? String((Project as any).uuid ?? '') : ''
}

function keptDrawable(text: string): Drawable | null {
    if (!kept || kept.project !== projectKey()) return null
    return { preview: kept.preview, order: kept.order, banner: { kind: 'stale', text } }
}

function staleText(current: LoadedBundle): string {
    return current.skipped ? `The game would skip this version (${current.skipped}), so the last good one shows.` : STALE_BANNER
}

function pickDrawable(current: LoadedBundle, order: string[]): Drawable | null {
    if (current.preview) return { preview: current.preview, order, banner: null }
    const draft = current.draft?.() ?? null
    if (draft) return { preview: draft, order, banner: { kind: 'over', text: OVER_BUDGET_BANNER } }
    return keptDrawable(staleText(current))
}

function manifestAnimations(files: Record<string, string>): Record<string, any> {
    if (parsed.files === files) return parsed.animations
    let animations: Record<string, any> = {}
    try {
        const manifest = JSON.parse(files['manifest.json'] ?? '{}')
        if (manifest && typeof manifest.animations === 'object' && manifest.animations) animations = manifest.animations
    } catch {
        animations = {}
    }
    parsed = { files, animations }
    return animations
}

function selectedAnimation(): any | null {
    if (!inAnimateMode() || typeof BBAnimation === 'undefined') return null
    return (BBAnimation as any).selected ?? null
}

function animatePlan(files: Record<string, string>): AnimatePlan {
    const animation = selectedAnimation()
    const name = animation ? String(animation.name ?? '') : ''
    if (!name || name === LOOP_ANIMATION) return LOOP_PLAN
    const entry = manifestAnimations(files)[name]
    if (!entry || typeof entry !== 'object') return { kind: 'missing', name, reaction: null }
    if (entry.schedule) return { kind: 'random', name, reaction: null }
    const trigger = entry.trigger
    if (trigger && typeof trigger === 'object' && trigger.on === 'while' && typeof trigger.reaction === 'string') {
        return { kind: 'while', name, reaction: trigger.reaction }
    }
    return { kind: 'shot', name, reaction: null }
}

function pickedNow(files: Record<string, string>, name: string): Record<string, string> | null {
    try {
        const manifest = JSON.parse(files['manifest.json'] ?? '{}')
        const animations = manifest?.animations
        const entry = animations?.[name]
        if (!entry || typeof entry.schedule !== 'object' || !entry.schedule) return null
        const id = entry.schedule.id ?? name
        for (const other of Object.keys(animations)) {
            const schedule = animations[other]?.schedule
            if (other !== name && schedule && (schedule.id ?? other) === id) delete animations[other]
        }
        const length = Math.max(1, Math.round(Number(entry.length) || 1))
        entry.schedule = { ...entry.schedule, window: length * 4 + 1, jitter: 0, chance: 1 }
        return { ...files, 'manifest.json': JSON.stringify(manifest) }
    } catch {
        return null
    }
}

function derivedLoad(random: string): LoadedBundle | null {
    if (!override && !random) return null
    if (derived.files === compiledFiles && derived.override === override && derived.random === random) return derived.load
    let files: Record<string, string> | null = compiledFiles
    try {
        if (override) files = override.patch(compiledFiles)
    } catch (error) {
        console.error('[polyplus_nameplate] preview override failed', error)
        files = null
    }
    if (files && random) files = pickedNow(files, random)
    derived = { files: compiledFiles, override, random, load: files ? loadFiles(files) : null }
    return derived.load
}

function derivedPreview(random: string): NameplatePreview | null {
    const load = derivedLoad(random)
    if (!load) return null
    return load.preview ?? load.draft?.() ?? null
}

const driftClock: { files: Record<string, string> | null, drifts: boolean, base: number, last: number } = { files: null, drifts: false, base: 0, last: -1 }

function drifts(files: Record<string, string>): boolean {
    if (driftClock.files !== files) {
        driftClock.files = files
        driftClock.drifts = Object.entries(files).some(([path, text]) => path.startsWith('layers/') && /"drift"\s*:\s*true/.test(text))
    }
    return driftClock.drifts
}

function driftFrame(preview: NameplatePreview, local: number): number {
    if (isPlaying() && driftClock.last >= 0 && local < driftClock.last) driftClock.base += Math.max(1, preview.loop)
    driftClock.last = local
    return driftClock.base + local
}

function planNote(plan: AnimatePlan): string {
    switch (plan.kind) {
        case 'while':
            return `Showing '${plan.name}': the player is ${(REACTION_LABELS[plan.reaction ?? ''] ?? plan.reaction ?? '').toLowerCase()} the whole time.`
        case 'shot':
            return `Showing '${plan.name}' as if it started at 0 s. Once it ends, the loop shows.`
        case 'random':
            return `Showing '${plan.name}' as if it was picked at 0 s. Once it ends, the loop shows.`
        case 'missing':
            return `'${plan.name}' is not in the nameplate yet, so the loop shows. Pick when it plays in its properties.`
        default:
            return ''
    }
}

function paintDrawable(drawable: Drawable, hidden: Set<string>): Painted {
    const base = drawable.preview
    const stale = drawable.banner?.kind === 'stale'
    const seed = mainSeed()
    const plan = stale ? LOOP_PLAN : animatePlan(compiledFiles)
    const swapped = stale ? null : derivedPreview(plan.kind === 'random' ? plan.name : '')
    const preview = swapped ?? base
    setComposePreview(preview)
    const look = currentLook()
    const notes = [override && swapped ? override.note : '', planNote(plan), look.note]
    if (plan.kind === 'random' && !swapped) {
        notes[1] = `'${plan.name}' can't be previewed until the problems in Checks are fixed, so the loop shows.`
    }
    const variant = override && swapped ? override.variant : previewUi.variant
    const effects = effectFilter(compiledFiles, variant)
    const keep = (layer: NameplateLayer) => !hidden.has(drawable.order[layer.index] ?? '') && effects(layer)
    const scrubbing = plan.kind === 'while' || plan.kind === 'shot' || (plan.kind === 'random' && !!swapped)
    let frame: number
    let local: number
    let stateFor: (key: string, tagSeed?: number) => NameplateTagState | null
    if (scrubbing) {
        local = timelineFrame(preview.fps)
        frame = plan.kind === 'while' && drifts(compiledFiles) ? driftFrame(preview, local) : local
        const scrub: ScrubPlan = { reaction: plan.reaction, shot: plan.kind === 'shot' ? plan.name : null }
        stateFor = (key, tagSeed = seed) => scrubState(preview, key, variant, frame, scrub, tagSeed)
    } else {
        local = currentFrame(preview)
        frame = absoluteFrame(preview, local, isPlaying())
        stateFor = (key, tagSeed = seed) => tagState(key, variant, frame, tagSeed)
    }
    const label = scrubbing ? `${plan.name} frame` : 'frame'
    const note = notes.filter(Boolean).join(' ')
    if (previewUi.crowd) {
        const paint = { detail: look.detail, still: look.still, padding: tagPadding() }
        const crowd = paintCrowd(preview, variant, frame, seed, nameWidthOf, keep, mainSpec(), stateFor, paint)
        return { frame, local, layers: [], badge: STILL_BADGE, plate: STILL_BADGE, crowd, note, label }
    }
    const state = stateFor(MAIN_TAG)
    const layers = paintFrame(preview, frame, state, variant).filter(keep)
    const letters = paintLetters(preview, variant, mainLayout().block, frame, mainSeed(), state, look, previewName(), (previewOptions.rank.trim() ? 1 : 0) + 1)
    const poses = tagPoses(preview, variant, mainLayout().block, look.still ? 0 : frame, mainSeed(), state, look.detail)
    return { frame, local, layers, badge: poses.badge, plate: poses.plate, letters, crowd: [], note, label }
}

function remember(drawable: Drawable) {
    if (drawable.banner?.kind === 'stale') return
    kept = { project: projectKey(), preview: drawable.preview, order: drawable.order }
}

function adopt(preview: NameplatePreview) {
    previewUi.variants = preview.variants
    previewUi.loop = preview.loop
    previewUi.fps = preview.fps
    if (!preview.variants.includes(previewUi.variant)) previewUi.variant = preview.variants[0] ?? ''
    if (previewUi.frame >= preview.loop) previewUi.frame = 0
}

function refresh() {
    if (dirty || !loaded) {
        const bundle = currentBundle()
        compiledIssues = bundle.issues
        compiledFiles = bundle.files
        loaded = loadFiles(bundle.files)
        dirty = false
    }
    previewUi.issues = compiledIssues
    const order = readLayers().map((layer) => layer.uuid)
    let drawable = pickDrawable(loaded, order)
    if (!drawable) {
        previewUi.variants = []
        previewUi.summary = loaded.skipped ? `The nameplate was skipped: ${loaded.skipped}` : "The nameplate can't be drawn yet."
        publish({ preview: null, layers: [], frame: 0, files: compiledFiles, order, crowd: [], banner: null, note: '' })
        return
    }
    const hidden = hiddenNodes()
    let painted: Painted | null = null
    let failure = ''
    while (!painted) {
        adopt(drawable.preview)
        try {
            painted = paintDrawable(drawable, hidden)
            remember(drawable)
        } catch (error) {
            failure = failure || describe(error)
            const fallback = keptDrawable(STALE_BANNER)
            if (!fallback || fallback.preview === drawable.preview) break
            drawable = fallback
        }
    }
    if (failure) previewUi.issues = [...compiledIssues, { path: '', message: failure }]
    if (!painted) {
        previewUi.summary = "The nameplate couldn't be drawn."
        publish({ preview: drawable.preview, layers: [], frame: 0, files: compiledFiles, order: drawable.order, crowd: [], banner: null, note: '' })
        return
    }
    const id = drawable.preview.id
    previewUi.summary = previewUi.crowd
        ? `${id}, ${painted.label} ${painted.local}, ${painted.crowd.length} players`
        : `${id}, ${painted.label} ${painted.local}, ${painted.layers.length} layers`
    publish({
        preview: drawable.preview,
        layers: painted.layers,
        frame: painted.frame,
        files: compiledFiles,
        order: drawable.order,
        crowd: painted.crowd,
        banner: drawable.banner,
        note: painted.note,
        badge: painted.badge,
        plate: painted.plate,
        letters: painted.letters,
    })
}

export function onNewPreviewProject(hook: () => void): () => void {
    return newProjectHooks.on(hook)
}

function resetForNewProject() {
    if (typeof Project === 'undefined' || !Project || seenProjects.has(Project)) return
    seenProjects.add(Project)
    clearPreviewOptions()
    previewUi.variant = ''
    previewUi.seed = 0
    previewUi.frame = 0
    newProjectHooks.notify()
}

export function setPreviewOverride(next: PreviewOverride | null) {
    override = next
    redraw(false)
}

export function redraw(recompile: boolean) {
    if (recompile) dirty = true
    if (!active || subscribers.size === 0 || !isNameplateActive()) return
    try {
        refresh()
    } catch (error) {
        console.error('[polyplus_nameplate] preview redraw failed', error)
    }
}

export function registerPreview() {
    if (active) return
    active = true
    const steps: Array<() => () => void> = [
        retainEvents,
        () => onHeavy(() => redraw(true)),
        () => onFormatActivation(() => {
            resetForNewProject()
            previewOptions.name = ''
            previewUi.autoWidth = true
            syncNameWidth()
            resetLive()
            override = null
            redraw(true)
        }),
        registerPreviewPanel,
        registerGpu,
    ]
    for (const step of steps) handles.removers.push(step())
    for (const name of PREVIEW_EVENTS) {
        handles.listeners.push(Blockbench.on(name, () => redraw(name === 'select_mode')))
    }
    redraw(true)
}

export function unregisterPreview() {
    active = false
    disposeAll(handles.listeners)
    disposeAll(handles.removers)
    subscribers.clear()
    cache.clear()
    loaded = null
    last = null
    override = null
    kept = null
    parsed = { files: null, animations: {} }
    derived = { files: null, override: null, random: '', load: null }
    compiledFiles = {}
    compiledIssues = []
    dirty = true
    previewUi.playing = false
    previewUi.crowd = false
    resetOptions()
    resetLive()
}
