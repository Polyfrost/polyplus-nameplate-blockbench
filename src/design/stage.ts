import { beginEffectAreaEdit, beginEffectsShift, EffectAreaEdit, EffectEdge, effectMargins, EffectMove, EffectsShift, MoveRoom, shiftMargins, shiftRoom, stretchMargins, stretchRoom } from '../kinds/effectForm'
import { carriedPivot } from '../kinds/spriteForm'
import { primarySelectedNode, selectedLayerNodes, selectedNodeUuids, selectedPinnedNode, walkNodes, isGroupNode, isNameTextNode } from '../elements/nodes'
import { badgeNode, isBadgeNode } from '../badge/node'
import { AT_PROPERTY, atValue, isNameAnchor, takesAt } from '../art/layout'
import { currentBundle } from '../compile'
import { ANCHORS } from '../elements/read'
import { BlockRect, drawLayers, layerBounds, LayerBounds, layerLeft, layerTop, NameplateBadgePose, NameplateLayer, NameplatePreview, STILL_BADGE } from '../engine'
import { wholeClamped } from '../util/num'
import { currentFps, isNameplateActive } from '../format'
import { FORMAT_ID, SPRITE_TYPE } from '../model'
import { ANCHOR_LABELS } from '../motion/form'
import { DESIGN_MODE, showLayer } from '../navigate'
import {
    BannerKind,
    hiddenNodes,
    lastResult,
    lineChoice,
    loadFiles,
    mainLayout,
    mainSeed,
    mainSpec,
    nameRow,
    nameWidthOf,
    onPreviewResult,
    paintFrame,
    PreviewResult,
    previewName,
    previewUi,
    redraw,
    setLineChoice,
    setPreviewOverride,
    syncNameWidth,
} from '../preview'
import { onLight } from './events'
import { drawOffPaletteMarks } from '../palette/highlight'
import { badgeMarks, drawBadge, drawBadgeArt, nameDrawStyle } from '../text/draw'
import { defineAction } from '../util/actions'
import { disposeAll, dropToolbar } from '../util/teardown'
import { undoEdit } from '../util/undo'
import { CrowdBox, CrowdLayout, CrowdTag, drawCrowd, drawRun, fillBackground, fitCrowd, loopBox, movedRun, paintCrowd, tagBox, widenBox } from '../preview/crowd'
import { tagState } from '../preview/live'
import { CROWD_TOGGLE, setCrowdView } from '../preview/panel'
import { backgroundColor, currentLook, effectLayers, previewOptions, tagPadding, VANILLA_BACKGROUND } from '../preview/options'
import { LINE_CHOICES, LOOK_SELECT, makeOptionItems, OPTIONS_ACTION, syncOptionItems, zoomFrame } from '../preview/menu'
import { onFontReady, shadowOf } from '../font'
import { drawLetters, NameLetters } from '../text/letters'
import { backdropShown, beginCompose, drawBackdrop, eraTextColor, gpuNotes, legacyColor, litColor, setComposePreview } from '../gpu'
import { drawPlayer, drawSwatches, layoutSwatches, playerHeight, SwatchCard, swatchAt, variantSwatches } from '../gpu/wardrobe'
import { selectInspectorTarget } from '../inspector/selection'
import { setStripHost } from '../colors/host'
import { registerColorStrip, setStripFolded, STRIP_TOGGLE } from '../colors/strip'
import { pluginToolbar } from '../toolbar'
import { EFFECT_TYPE } from '../material/types'
import { materialsAspect } from '../material/state'
import { inDrawOrder } from '../gpu/order'
import { isPlateNode } from '../plate'

const OVERLAY_ID = 'polyplus_nameplate_viewport'
const STAGE_TOOLBAR = 'polyplus_nameplate_preview'

const MARGIN = 3
const COVER_MARGIN = 2
const MAX_BOUND_FRAMES = 60
const MAX_CROWD_BOUND_FRAMES = 24
const LETTER_REACH = 32
const MAX_SCALE = 48
const AUTO_SCALE_LIMIT = 8
const FALLBACK_ACCENT = '#3e90ff'
const NAME_COLOR = '#FFFFFF'
const FRONT_DEPTH = 'over_text'
const GLYPH_ROWS = 8
const PADDING_OUTLINE = 'rgba(255, 255, 255, 0.6)'
const NUDGE_KEYS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
const SHIFT_NUDGE = 5
const OFFSET_LIMIT = 64
const STOP_NOTE_MS = 5000
const ANCHOR_NOTE_MS = 2500
const ANCHOR_SPOTS: Record<string, [number, number]> = {
    top_left: [0, 0],
    top: [0.5, 0],
    top_right: [1, 0],
    left: [0, 0.5],
    right: [1, 0.5],
    bottom_left: [0, 1],
    bottom: [0.5, 1],
    bottom_right: [1, 1],
}
const BANNER_STYLE = 'flex: none; display: none; align-items: center; gap: 6px; padding: 4px 10px; color: #fff; background-color: var(--color-close, #e0534f);'
const BANNER_ICONS: Record<BannerKind, string> = { over: 'error', stale: 'history' }
const WARDROBE_SCALE = 2
const WARDROBE_BACKGROUND = '#24262C'
const WARDROBE_TEXT = '#C8CAD0'
const WARDROBE_GAP = 10
const INLINE_BADGE_ADVANCE = 10
const BADGE_SIZE = 8
const AREA_STYLE = 'flex: 1 1 auto; min-height: 0; position: relative; display: flex; flex-direction: column;'
const STRIP_HOST_STYLE = 'flex: 0 1 auto; min-height: 32px; max-height: 45%; display: flex; flex-direction: column;'
const AREA_MIN_HEIGHT = 'min(160px, 60%)'
const STAGE_MIN_HEIGHT = 180
const STRIP_MIN_HEIGHT = 32
const STRIP_MAX_SHARE = 0.35
const EDGE_GRAB = 4
const CLICK_SLOP = 3
const EDGE_CURSORS: Record<EffectEdge, string> = { left: 'ew-resize', right: 'ew-resize', top: 'ns-resize', bottom: 'ns-resize' }
const MIRRORED_EDGES: Record<EffectEdge, EffectEdge> = { left: 'right', right: 'left', top: 'top', bottom: 'bottom' }
const HOVER_DASH = [2, 2]
const KEY_CHANNEL = 'position'
const FRAME_EPSILON = 1e-6

type StageTarget = 'name' | 'badge'

const TARGET_TITLES: Record<StageTarget, string> = {
    name: 'Click to style the name text',
    badge: 'Click to style the badge',
}

interface Rect {
    x: number
    y: number
    width: number
    height: number
}

interface LayerPick {
    node: any
    entry: NameplateLayer
}

type StagePick = { target: StageTarget } | LayerPick

interface View {
    left: number
    top: number
    scale: number
}

interface DragMember {
    node: any
    origin: [number, number]
    flip: number
}

interface MoveStop extends MoveRoom {
    node: any
}

interface Drag {
    node: any
    clientX: number
    clientY: number
    scale: number
    zoom: number
    members: DragMember[]
    moves: EffectMove[]
    stops: MoveStop[]
    told: boolean
    shift: EffectsShift | null
    selectOnClick: boolean
    moved: boolean
    flip: number
    applied: [number, number]
    editing: boolean
    anchor: { x: number, y: number } | null
    effect: EffectAreaEdit | null
    edge: EffectEdge | null
    key: KeyMove | null
}

interface KeyMove {
    animator: any | null
    why: string
    keyframes: any[]
    keyframe: any | null
    base: [number, number]
}

const view: View = { left: 0, top: 0, scale: 1 }

const state: { zoom: number, timer: ReturnType<typeof setInterval> | null, drag: Drag | null, hover: StageTarget | null, size: string, side: { node: any, flip: number } | null } = { zoom: 0, timer: null, drag: null, hover: null, size: '', side: null }

const handles: {
    root: HTMLElement | null
    canvas: HTMLCanvasElement | null
    wrap: HTMLElement | null
    hint: HTMLElement | null
    banner: HTMLElement | null
    area: HTMLElement | null
    strip: HTMLElement | null
    observer: ResizeObserver | null
    toolbar: Toolbar | null
    items: BarItem[]
    removers: Array<() => void>
} = { root: null, canvas: null, wrap: null, hint: null, banner: null, area: null, strip: null, observer: null, toolbar: null, items: [], removers: [] }

const shown = { layers: [] as NameplateLayer[], order: [] as string[], cards: [] as SwatchCard[] }

const framing: { files: Record<string, string> | null, key: string, bounds: LayerBounds | null } = { files: null, key: '', bounds: null }

const crowdFraming: { files: Record<string, string> | null, key: string, boxes: Map<string, CrowdBox> } = { files: null, key: '', boxes: new Map() }

function accent(): string {
    return getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || FALLBACK_ACCENT
}

function inDesign(): boolean {
    return typeof Modes !== 'undefined' && Modes.id === DESIGN_MODE
}

function wanted(): boolean {
    return (
        isNameplateActive() &&
        typeof Modes !== 'undefined' &&
        (Modes.id === DESIGN_MODE || Modes.id === 'animate')
    )
}

function autoScale(columns: number, rows: number): number {
    const width = Math.max(1, (handles.wrap?.clientWidth || 720) - 8)
    const height = Math.max(1, (handles.wrap?.clientHeight || 360) - 8)
    const fit = Math.max(1, Math.min(MAX_SCALE, Math.floor(Math.min(width / columns, height / rows))))
    return Math.min(AUTO_SCALE_LIMIT, fit)
}

function descendants(group: any): any[] {
    const nodes: any[] = []
    walkNodes((node) => {
        nodes.push(node)
    }, Array.isArray(group.children) ? group.children : [])
    return nodes
}

function selectedEntries(): NameplateLayer[] {
    const selected = selectedNodeUuids()
    const group = primarySelectedNode()
    if (group && isGroupNode(group)) {
        for (const node of descendants(group)) selected.add(node.uuid)
    }
    return shown.layers.filter((layer) => selected.has(shown.order[layer.index] ?? ''))
}

function nameOptions() {
    const style = nameDrawStyle()
    const look = currentLook()
    const color = look.legacy ? legacyColor(style.color ?? NAME_COLOR) : style.color ?? NAME_COLOR
    let shadow = style.shadow === undefined ? shadowOf(color) : style.shadow
    if (shadow && look.shadow === 'vanilla') shadow = shadowOf(color)
    const outline = style.outline ? (look.legacy ? legacyColor(style.outline) : style.outline) : null
    return {
        color: litColor(color),
        shadow: shadow ? litColor(shadow) : null,
        outline: outline ? litColor(outline) : null,
    }
}

function crowdName(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, letters?: NameLetters | null) {
    drawLetters(ctx, text, x, y, scale, nameOptions(), letters)
}

function showsBackground(result: PreviewResult | null): boolean {
    return !!result?.preview && !result.preview.ownsBackground(previewUi.variant)
}

function mark(x: number, y: number, width: number, height: number): NameplateLayer {
    return { left: 0, top: 0, x, y, width, mirrorX: false, rasterWidth: width, rasterHeight: height } as NameplateLayer
}

export function drawCover(preview: NameplatePreview, variant: string, scale: number): HTMLCanvasElement | null {
    const shownVariant = previewUi.variant
    previewUi.variant = variant
    try {
        const look = { detail: 'full' as const, still: true, padding: tagPadding() }
        const stateFor = (key: string, seed: number) => tagState(key, variant, 0, seed)
        const [tag] = paintCrowd(preview, variant, 0, mainSeed(), nameWidthOf, () => true, mainSpec(), stateFor, look)
        if (!tag) return null
        const box = tagBox(tag)
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil((box.width + COVER_MARGIN * 2) * scale)
        canvas.height = Math.ceil((box.height + COVER_MARGIN * 2) * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        setComposePreview(preview)
        beginCompose()
        drawCrowd(ctx, [{ tag, box, x: 0, y: 0 }], scale, COVER_MARGIN, !preview.ownsBackground(variant), crowdName)
        return canvas
    } finally {
        previewUi.variant = shownVariant
        redraw(false)
    }
}

function drawCrowdStage(canvas: HTMLCanvasElement, result: PreviewResult) {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const viewWidth = Math.max(1, (handles.wrap?.clientWidth || 720) - 32)
    const viewHeight = Math.max(1, (handles.wrap?.clientHeight || 360) - 32)
    const fit = fitCrowd(result.crowd, viewWidth, viewHeight, state.zoom, MARGIN, steadyCrowd(result))
    view.scale = fit.scale
    sizeCanvas(canvas, (fit.width + MARGIN * 2) * fit.scale, (fit.height + MARGIN * 2) * fit.scale)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawBackdrop(ctx, previewOptions.backdrop, fit.scale)
    beginCompose()
    drawCrowd(ctx, fit.placed, fit.scale, MARGIN, showsBackground(result), crowdName)
}

function inlineBadge(result: PreviewResult | null, row: { x: number, y: number }): NameplateLayer | null {
    if (!currentLook().inlineBadge || !badgeMarks(result?.badge).length) return null
    const x = row.x - INLINE_BADGE_ADVANCE
    return mark(x, row.y, BADGE_SIZE, BADGE_SIZE)
}

interface TagFrame {
    result: PreviewResult | null
    layout: CrowdLayout
    scale: number
    originX: number
    originY: number
    background: boolean
}

function plateOf(result: PreviewResult | null): NameplateBadgePose {
    return result?.plate ?? STILL_BADGE
}

function shownRow(result: PreviewResult | null, layout: CrowdLayout): Rect {
    const row = nameRow(layout)
    const plate = plateOf(result)
    return { ...row, x: row.x + plate.dx, y: row.y + plate.dy }
}

function letterMarks(result: PreviewResult | null, layout: CrowdLayout): NameplateLayer[] {
    if (!result?.preview?.movesLetters()) return []
    const row = shownRow(result, layout)
    const width = row.width + LETTER_REACH * 2
    const height = row.height + LETTER_REACH * 2
    return [mark(row.x - LETTER_REACH, row.y - LETTER_REACH, width, height)]
}

function tagMarks(result: PreviewResult | null, layout: CrowdLayout, background: boolean): NameplateLayer[] {
    const row = shownRow(result, layout)
    const plate = plateOf(result)
    const inline = inlineBadge(result, row)
    const rect = layout.background
    return [
        mark(row.x, row.y, row.width, row.height),
        ...layout.runs.filter((run) => run.kind !== 'name').map((run) => {
            const moved = movedRun(run, plate)
            return mark(moved.x, moved.y, Math.max(1, moved.width), GLYPH_ROWS)
        }),
        ...(inline ? [inline] : badgeMarks(result?.badge)),
        ...(background ? [mark(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0)] : []),
    ]
}

function targetRect(target: StageTarget, result: PreviewResult | null, layout: CrowdLayout): Rect | null {
    const row = shownRow(result, layout)
    if (target === 'name') return row
    const inline = inlineBadge(result, row)
    const mark = inline ?? badgeMarks(result?.badge)[0]
    return mark ? { x: layerLeft(mark), y: layerTop(mark), width: mark.rasterWidth, height: mark.rasterHeight } : null
}

function selectedTarget(): StageTarget | null {
    const selected = (typeof Outliner !== 'undefined' && Outliner ? Outliner.selected : []) as any[]
    if (selected.length !== 1) return null
    if (isNameTextNode(selected[0])) return 'name'
    if (isBadgeNode(selected[0])) return 'badge'
    return null
}

function inside(rect: Rect | null, x: number, y: number): boolean {
    return !!rect && rect.width > 0 && rect.height > 0 && x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
}

function textTargetAt(x: number, y: number): StageTarget | null {
    const result = lastResult()
    const layout = mainLayout()
    if (inside(targetRect('badge', result, layout), x, y)) return 'badge'
    if (inside(targetRect('name', result, layout), x, y)) return 'name'
    return null
}

function framingKey(layout: CrowdLayout, background: boolean): string {
    const rect = layout.background
    const row = nameRow(layout)
    return [
        previewUi.variant,
        previewUi.seed,
        previewOptions.look,
        previewOptions.wardrobe,
        background,
        rect.x0,
        rect.y0,
        rect.x1,
        rect.y1,
        row.x,
        row.y,
        row.width,
        Array.from(hiddenNodes()).join(','),
    ].join('|')
}

function shownLayer(result: PreviewResult, variant: string): (layer: NameplateLayer) => boolean {
    const hidden = hiddenNodes()
    const effects = currentLook().effects ? null : effectLayers(result.files, variant)
    return (layer) => !hidden.has(result.order[layer.index] ?? '') && !effects?.has(layer.index)
}

function loopBounds(result: PreviewResult | null, marks: NameplateLayer[], start: LayerBounds): LayerBounds {
    const preview = result?.preview
    const variant = previewUi.variant
    if (!result || !preview || !preview.variants.includes(variant)) return start
    const look = currentLook()
    const keep = shownLayer(result, variant)
    const loop = Math.max(1, preview.loop)
    const samples = look.still ? 1 : Math.min(loop, MAX_BOUND_FRAMES)
    let bounds = start
    for (let index = 0; index < samples; index++) {
        const layers = paintFrame(preview, Math.floor((index * loop) / samples), null, variant).filter(keep)
        bounds = widenBox(bounds, layerBounds([...layers, ...marks]))
    }
    return bounds
}

function steadyBounds(result: PreviewResult | null, layout: CrowdLayout, background: boolean, marks: NameplateLayer[]): LayerBounds {
    const current = layerBounds([...shown.layers, ...marks])
    const held = framing.bounds
    if (state.drag && held) {
        framing.bounds = widenBox(held, current)
        return framing.bounds
    }
    const key = framingKey(layout, background)
    const files = result?.files ?? null
    if (held && key === framing.key && files === framing.files) {
        framing.bounds = widenBox(held, current)
        return framing.bounds
    }
    framing.key = key
    framing.files = files
    try {
        framing.bounds = loopBounds(result, marks, current)
    } catch (error) {
        console.error('[polyplus_nameplate] could not measure the loop', error)
        framing.bounds = current
    }
    return framing.bounds
}

function crowdKey(result: PreviewResult): string {
    return [
        previewUi.variant,
        previewOptions.look,
        Array.from(hiddenNodes()).join(','),
        ...result.crowd.map((tag) => {
            const rect = tag.background
            return [tag.seed, tag.block.width, tag.block.height, rect.x0, rect.y0, rect.x1, rect.y1].join(':')
        }),
    ].join('|')
}

function measureCrowd(result: PreviewResult): Map<string, CrowdBox> {
    const boxes = new Map<string, CrowdBox>()
    const preview = result.preview
    const variant = previewUi.variant
    if (!preview || !preview.variants.includes(variant)) return boxes
    const look = currentLook()
    const keep = shownLayer(result, variant)
    const loop = Math.max(1, preview.loop)
    const samples = look.still ? 1 : Math.min(loop, MAX_CROWD_BOUND_FRAMES)
    const paint = (tag: CrowdTag, frame: number) => preview.paint(variant, tag.block, look.still ? 0 : frame, tag.seed, null, look.detail).filter(keep)
    for (const tag of result.crowd) boxes.set(tag.key, loopBox(tag, loop, samples, paint))
    return boxes
}

function steadyCrowd(result: PreviewResult): Map<string, CrowdBox> {
    const key = crowdKey(result)
    if (key !== crowdFraming.key || result.files !== crowdFraming.files) {
        crowdFraming.key = key
        crowdFraming.files = result.files
        try {
            crowdFraming.boxes = measureCrowd(result)
        } catch (error) {
            console.error('[polyplus_nameplate] could not measure the crowd', error)
            crowdFraming.boxes = new Map()
        }
    }
    for (const tag of result.crowd) {
        const held = crowdFraming.boxes.get(tag.key)
        const current = tagBox(tag)
        crowdFraming.boxes.set(tag.key, held ? widenBox(held, current) : current)
    }
    return crowdFraming.boxes
}

function drawTag(ctx: CanvasRenderingContext2D, frame: TagFrame) {
    const { result, layout, scale, originX, originY, background } = frame
    const row = shownRow(result, layout)
    const plate = plateOf(result)
    if (background) fillBackground(ctx, layout.background, layout.padded ? backgroundColor() : VANILLA_BACKGROUND, scale, originX, originY)
    beginCompose()
    drawLayers(ctx, shown.layers.filter((layer) => layer.depth !== FRONT_DEPTH), scale, originX, originY)
    for (const run of layout.runs) {
        if (run.kind === 'name') continue
        const moved = movedRun(run, plate)
        drawRun(ctx, { ...moved, color: eraTextColor(moved.color) }, scale, originX, originY)
    }
    const name = nameRow()
    drawLetters(ctx, previewName(), originX + plate.dx * scale + name.x * scale, originY + plate.dy * scale + name.y * scale, scale, nameOptions(), result?.letters)
    const inline = inlineBadge(result, row)
    if (inline) drawBadgeArt(ctx, originX + inline.x * scale, originY + inline.y * scale, scale)
    else drawBadge(ctx, scale, originX, originY, result?.badge)
    drawLayers(ctx, shown.layers.filter((layer) => layer.depth === FRONT_DEPTH), scale, originX, originY)
    drawOffPaletteMarks(ctx, shown.layers, shown.order, scale, originX, originY)
    ctx.lineWidth = 1
    const outline = (rect: Rect, dash: number[]) => {
        ctx.setLineDash(dash)
        ctx.strokeRect((rect.x - view.left) * scale + 0.5, (rect.y - view.top) * scale + 0.5, rect.width * scale - 1, rect.height * scale - 1)
    }
    if (background && layout.padded) {
        const rect = layout.background
        ctx.strokeStyle = PADDING_OUTLINE
        outline({ x: rect.x0, y: rect.y0, width: rect.x1 - rect.x0, height: rect.y1 - rect.y0 }, [2, 3])
    }
    ctx.strokeStyle = accent()
    const hover = state.hover ? targetRect(state.hover, result, layout) : null
    if (hover) outline(hover, HOVER_DASH)
    const chosen = selectedTarget()
    const picked = chosen ? targetRect(chosen, result, layout) : null
    if (picked) outline(picked, [])
    for (const entry of selectedEntries()) outline(entryRect(entry), entry.mirrorX ? [4, 3] : [])
    ctx.setLineDash([])
}

function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
    canvas.width = Math.max(1, Math.ceil(width))
    canvas.height = Math.max(1, Math.ceil(height))
    canvas.style.width = `${canvas.width}px`
    canvas.style.height = `${canvas.height}px`
}

function anchorOf(canvas: HTMLCanvasElement): { x: number, y: number } {
    const rect = canvas.getBoundingClientRect()
    return { x: rect.left - view.left * view.scale, y: rect.top - view.top * view.scale }
}

function holdDragAnchor(canvas: HTMLCanvasElement) {
    canvas.style.transform = ''
    const anchor = state.drag?.anchor
    if (!anchor) return
    const now = anchorOf(canvas)
    const dx = Math.round(anchor.x - now.x)
    const dy = Math.round(anchor.y - now.y)
    if (dx || dy) canvas.style.transform = `translate(${dx}px, ${dy}px)`
}

function drawWardrobeStage(canvas: HTMLCanvasElement, result: PreviewResult | null) {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const width = Math.max(240, (handles.wrap?.clientWidth || 720) - 8)
    const height = Math.max(220, (handles.wrap?.clientHeight || 360) - 8)
    sizeCanvas(canvas, width, height)
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = WARDROBE_BACKGROUND
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const scale = state.zoom > 0 ? Math.min(MAX_SCALE, state.zoom) : WARDROBE_SCALE
    if (backdropShown()) drawBackdrop(ctx, previewOptions.backdrop, scale)
    const swatches = result ? variantSwatches(result.files) : []
    const cards = layoutSwatches(swatches, canvas.width, canvas.height - 6)
    shown.cards = cards
    const feet = (cards[0]?.y ?? canvas.height) - 16
    const headTop = Math.round(feet - playerHeight(scale))
    const centerX = Math.round(canvas.width / 2)
    drawPlayer(ctx, centerX, headTop, scale)
    const layout = mainLayout()
    const background = showsBackground(result)
    const bounds = steadyBounds(result, layout, true, tagMarks(result, layout, true))
    const tagCenter = (layout.background.x0 + layout.background.x1) / 2
    view.scale = scale
    view.left = Math.round(tagCenter - centerX / scale)
    view.top = Math.round(Math.max(bounds.minY + bounds.height, layout.background.y1) - (headTop - WARDROBE_GAP * scale) / scale)
    const originX = -view.left * scale
    const originY = -view.top * scale
    drawTag(ctx, { result, layout, scale, originX, originY, background })
    drawSwatches(ctx, swatches, cards, previewUi.variant, accent(), WARDROBE_TEXT)
}

function onSwatch(offsetX: number, offsetY: number): boolean {
    return previewOptions.wardrobe && !!swatchAt(shown.cards, offsetX, offsetY)
}

function pickSwatch(offsetX: number, offsetY: number): boolean {
    if (!onSwatch(offsetX, offsetY) || previewUi.crowd) return false
    const variant = swatchAt(shown.cards, offsetX, offsetY)!
    if (variant !== previewUi.variant && previewUi.variants.includes(variant)) {
        previewUi.variant = variant
        setPreviewOverride(null)
        redraw(false)
        updateItems()
    }
    return true
}

function drawStage() {
    const canvas = handles.canvas
    if (!canvas) return
    try {
        const result = lastResult()
        shown.cards = []
        if (previewUi.crowd && result && result.preview && result.crowd.length) {
            canvas.style.transform = ''
            shown.layers = []
            shown.order = result.order
            drawCrowdStage(canvas, result)
            updateHint(result)
            return
        }
        shown.layers = result ? result.layers : []
        shown.order = result ? result.order : []
        if (previewOptions.wardrobe) {
            canvas.style.transform = ''
            drawWardrobeStage(canvas, result)
            updateHint(result)
            return
        }
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const layout = mainLayout()
        const background = showsBackground(result)
        const bounds = steadyBounds(result, layout, background, [...tagMarks(result, layout, background), ...letterMarks(result, layout)])
        const columns = bounds.width + MARGIN * 2
        const rows = bounds.height + MARGIN * 2
        const frame = zoomFrame(columns, rows)
        const scale = state.zoom > 0 ? Math.min(MAX_SCALE, state.zoom) : autoScale(frame.columns, frame.rows)
        view.scale = scale
        view.left = bounds.minX - MARGIN
        view.top = bounds.minY - MARGIN
        sizeCanvas(canvas, columns * scale, rows * scale)
        holdDragAnchor(canvas)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.imageSmoothingEnabled = false
        drawBackdrop(ctx, previewOptions.backdrop, scale)
        drawTag(ctx, { result, layout, scale, originX: -view.left * scale, originY: -view.top * scale, background })
        updateHint(result)
    } catch (error) {
        console.error('[polyplus_nameplate] stage draw failed', error)
    }
}

function fitStrip() {
    const { root, area, strip } = handles
    if (!root || !area || !strip) return
    let used = 0
    for (const child of Array.from(root.children) as HTMLElement[]) {
        if (child !== area && child !== strip) used += child.offsetHeight
    }
    const free = root.clientHeight - used
    if (!(free > 0)) return
    const stage = Math.max(0, Math.min(STAGE_MIN_HEIGHT, free - STRIP_MIN_HEIGHT))
    const strips = Math.max(STRIP_MIN_HEIGHT, Math.min(Math.floor(root.clientHeight * STRIP_MAX_SHARE), free - stage))
    const areaHeight = `${stage}px`
    const stripHeight = `${strips}px`
    if (area.style.minHeight !== areaHeight) area.style.minHeight = areaHeight
    if (strip.style.maxHeight !== stripHeight) strip.style.maxHeight = stripHeight
}

function updateBanner(result: PreviewResult | null) {
    const banner = handles.banner
    if (!banner) return
    const notice = result?.banner ?? null
    const display = notice ? 'flex' : 'none'
    if (banner.style.display !== display) {
        banner.style.display = display
        fitStrip()
    }
    if (!notice) return
    const icon = banner.firstElementChild as HTMLElement | null
    const text = banner.lastElementChild as HTMLElement | null
    if (icon) icon.textContent = BANNER_ICONS[notice.kind]
    if (text) text.textContent = notice.text
}

function hintCoversPlate(hint: HTMLElement): boolean {
    const canvas = handles.canvas
    if (!canvas) return false
    const text = hint.getBoundingClientRect()
    const plate = canvas.getBoundingClientRect()
    const inset = MARGIN * view.scale
    return text.bottom > plate.top + inset && text.top < plate.bottom - inset && text.right > plate.left + inset && text.left < plate.right - inset
}

function stageAdvice(result: PreviewResult): string {
    if (previewUi.crowd) return `Crowd view: ${result.crowd.length} players. The blue square is the badge.`
    if (previewOptions.wardrobe) return 'Wardrobe view. Click a swatch to try that variant.'
    const node = primarySelectedNode()
    const target = selectedTarget()
    if (!inDesign()) return 'Drag a layer to add a Position keyframe at this frame, or add keyframes in the timeline.'
    if (target === 'name') return 'Style the name text in the Inspector.'
    if (target === 'badge') return 'Place and style the badge in the Inspector.'
    if (isPlateNode(selectedPinnedNode())) return 'Add Position keyframes to the Whole nameplate row in Animate.'
    if (selectedGroup()) return 'Drag a layer to move the group, or click empty space and use the arrow keys (Shift: 5 px).'
    if (!node) return 'Click a layer, the name or the badge to select it.'
    if (node.type === SPRITE_TYPE) return 'Drag to move, or use the arrow keys (Shift: 5 px).'
    if (isEffect(node)) return 'Drag to move, drag an edge to resize, or use the arrow keys (Shift: 5 px).'
    return 'Change this layer in the Inspector.'
}

function updateHint(result: PreviewResult | null) {
    updateBanner(result)
    const hint = handles.hint
    if (!hint) return
    if (!result?.preview) {
        hint.textContent = previewUi.summary || 'The nameplate can\'t be drawn yet. See Checks.'
    } else {
        const dashed = !previewUi.crowd && previewOptions.polyNametag && showsBackground(result) && mainLayout().padded
        const gpu = gpuNotes()
        const note = `${result.note ? `${result.note} ` : ''}${gpu ? `${gpu} ` : ''}${dashed ? "The dashed line shows PolyNametag's background. " : ''}`
        hint.textContent = note + stageAdvice(result)
    }
    const overlay = !result?.preview || previewUi.crowd || previewOptions.wardrobe
    const visibility = !overlay && hintCoversPlate(hint) ? 'hidden' : ''
    if (hint.style.visibility !== visibility) hint.style.visibility = visibility
}

function blockAt(offsetX: number, offsetY: number): { x: number, y: number } {
    const scale = view.scale || 1
    return { x: Math.floor(offsetX / scale) + view.left, y: Math.floor(offsetY / scale) + view.top }
}

function hitEntry(x: number, y: number, front: boolean, keep: (entry: NameplateLayer) => boolean = () => true): NameplateLayer | null {
    const ordered = inDrawOrder(shown.layers)
    for (let at = ordered.length - 1; at >= 0; at--) {
        const entry = ordered[at]
        if ((entry.depth === FRONT_DEPTH) !== front || !keep(entry)) continue
        if (entry.rasterWidth <= 0 || entry.rasterHeight <= 0) continue
        const column = x - layerLeft(entry)
        const row = y - layerTop(entry)
        if (column < 0 || row < 0 || column >= entry.rasterWidth || row >= entry.rasterHeight) continue
        const source = entry.mirrorX ? entry.rasterWidth - 1 - column : column
        if (entry.rgba[(row * entry.rasterWidth + source) * 4 + 3] > 0) return entry
    }
    return null
}

function selectNode(node: any) {
    if (inDesign()) {
        showLayer(node)
        return
    }
    try {
        node.select()
    } catch (error) {
        console.error('[polyplus_nameplate] could not select the layer', error)
    }
}

function layerPick(entry: NameplateLayer | null): LayerPick | null {
    const node = entry ? (OutlinerNode as any).uuids?.[shown.order[entry.index] ?? ''] : null
    return entry && node ? { node, entry } : null
}

function isEffect(node: any): boolean {
    return !!node && node.type === EFFECT_TYPE
}

function movable(node: any): boolean {
    return !!node && (node.type === SPRITE_TYPE || isEffect(node))
}

function selectedGroup(): any | null {
    const group = typeof Group !== 'undefined' ? Group.first_selected : undefined
    return isGroupNode(group) ? group : null
}

function movingTogether(): any[] {
    const group = selectedGroup()
    const nodes = new Set<any>([...selectedLayerNodes(), ...(group ? descendants(group) : [])])
    return Array.from(nodes).filter(movable)
}

function memberAt(x: number, y: number, nodes: any[]): LayerPick | null {
    const member = (entry: NameplateLayer) => {
        const node = layerPick(entry)?.node
        return nodes.includes(node) && !isEffect(node)
    }
    return layerPick(hitEntry(x, y, true, member) ?? hitEntry(x, y, false, member))
}

function togetherPick(offsetX: number, offsetY: number): { pick: LayerPick, nodes: any[] } | null {
    if (previewUi.crowd || !inDesign()) return null
    if (onSwatch(offsetX, offsetY)) return null
    const nodes = movingTogether()
    if (nodes.length < 2) return null
    const point = blockAt(offsetX, offsetY)
    const pick = memberAt(point.x, point.y, nodes) ?? pickAt(offsetX, offsetY)
    return pick && 'node' in pick && nodes.includes(pick.node) ? { pick, nodes } : null
}

function stageFlip(node: any): number {
    const entry = shown.layers.find((layer) => shown.order[layer.index] === node.uuid)
    return entry?.mirrorX ? -1 : 1
}

function entryRect(entry: NameplateLayer): Rect {
    return { x: layerLeft(entry), y: layerTop(entry), width: entry.rasterWidth, height: entry.rasterHeight }
}

function effectPicks(selectedOnly: boolean): LayerPick[] {
    const picks: LayerPick[] = []
    for (let at = shown.layers.length - 1; at >= 0; at--) {
        const pick = layerPick(shown.layers[at])
        if (pick && isEffect(pick.node) && (!selectedOnly || pick.node.selected)) picks.push(pick)
    }
    return picks
}

function effectAt(x: number, y: number, selectedOnly: boolean): LayerPick | null {
    return effectPicks(selectedOnly).find((pick) => inside(entryRect(pick.entry), x, y)) ?? null
}

function edgeAt(offsetX: number, offsetY: number): (LayerPick & { edge: EffectEdge }) | null {
    if (previewUi.crowd || !inDesign() || movingTogether().length > 1) return null
    const scale = view.scale || 1
    for (const pick of effectPicks(true)) {
        const rect = entryRect(pick.entry)
        if (rect.width <= 0 || rect.height <= 0) continue
        const left = (rect.x - view.left) * scale
        const top = (rect.y - view.top) * scale
        const right = left + rect.width * scale
        const bottom = top + rect.height * scale
        const withinY = offsetY >= top - EDGE_GRAB && offsetY <= bottom + EDGE_GRAB
        const withinX = offsetX >= left - EDGE_GRAB && offsetX <= right + EDGE_GRAB
        let edge: EffectEdge | null = null
        if (withinY && Math.abs(offsetX - left) <= EDGE_GRAB) edge = 'left'
        else if (withinY && Math.abs(offsetX - right) <= EDGE_GRAB) edge = 'right'
        else if (withinX && Math.abs(offsetY - top) <= EDGE_GRAB) edge = 'top'
        else if (withinX && Math.abs(offsetY - bottom) <= EDGE_GRAB) edge = 'bottom'
        if (edge) return { ...pick, edge: pick.entry.mirrorX ? MIRRORED_EDGES[edge] : edge }
    }
    return null
}

function pickAt(offsetX: number, offsetY: number): StagePick | null {
    if (previewUi.crowd) return null
    const point = blockAt(offsetX, offsetY)
    const chosen = effectAt(point.x, point.y, true)
    if (chosen) return chosen
    const front = layerPick(hitEntry(point.x, point.y, true))
    if (front) return front
    const target = textTargetAt(point.x, point.y)
    if (target) return { target }
    return layerPick(hitEntry(point.x, point.y, false)) ?? effectAt(point.x, point.y, false)
}

function clickStage(offsetX: number, offsetY: number): LayerPick | null {
    if (previewUi.crowd) return null
    if (pickSwatch(offsetX, offsetY)) return null
    const pick = pickAt(offsetX, offsetY)
    if (!pick) return null
    if ('target' in pick) {
        selectInspectorTarget(pick.target)
        drawStage()
        return null
    }
    selectNode(pick.node)
    drawStage()
    return pick
}

function setHover(target: StageTarget | null, cursor: string) {
    const canvas = handles.canvas
    if (canvas) {
        canvas.style.cursor = cursor
        canvas.title = target ? TARGET_TITLES[target] : ''
    }
    if (target === state.hover) return
    state.hover = target
    drawStage()
}

function hoverStage(event: MouseEvent) {
    if (state.drag || previewUi.crowd) {
        setHover(null, '')
        return
    }
    if (onSwatch(event.offsetX, event.offsetY)) {
        setHover(null, 'pointer')
        return
    }
    const edge = edgeAt(event.offsetX, event.offsetY)
    if (edge) {
        setHover(null, EDGE_CURSORS[edge.edge])
        return
    }
    const pick = pickAt(event.offsetX, event.offsetY)
    if (!pick) setHover(null, '')
    else if ('target' in pick) setHover(pick.target, 'pointer')
    else setHover(null, (inDesign() ? movable(pick.node) : keyable(pick.node)) ? 'move' : 'pointer')
}

function offsetOf(node: any): [number, number] {
    const offset: unknown[] = Array.isArray(node.offset) ? node.offset : []
    const x = Math.round(Number(offset[0]))
    const y = Math.round(Number(offset[1]))
    return [isFinite(x) ? x : 0, isFinite(y) ? y : 0]
}

function offsetRoom(origin: number): [number, number] {
    return [Math.min(0, -OFFSET_LIMIT - origin), Math.max(0, OFFSET_LIMIT - origin)]
}

function flipped([low, high]: [number, number], flip: number): [number, number] {
    return flip < 0 ? [-high, -low] : [low, high]
}

function moveStops(members: DragMember[], moves: EffectMove[]): MoveStop[] {
    const stops: MoveStop[] = members.map(({ node, origin, flip }) => ({ node, x: flipped(offsetRoom(origin[0]), flip), y: offsetRoom(origin[1]) }))
    for (const { node, flip } of moves) {
        const margins = effectMargins(node)
        if (!margins) continue
        const room = shiftRoom(margins)
        stops.push({ node, x: flipped(room.x, flip), y: room.y })
    }
    return stops
}

function fitMove(stops: MoveStop[], dx: number, dy: number): { dx: number, dy: number, stopped: any | null } {
    let x = dx
    let y = dy
    let stopped: any | null = null
    for (const stop of stops) {
        const nextX = Math.max(stop.x[0], Math.min(stop.x[1], x))
        const nextY = Math.max(stop.y[0], Math.min(stop.y[1], y))
        if (nextX !== x || nextY !== y) stopped = stop.node
        x = nextX
        y = nextY
    }
    return { dx: x, dy: y, stopped }
}

function tellStop(node: any, together: boolean) {
    const name = String(node?.name ?? 'This layer')
    const why = isEffect(node)
        ? `'${name}' can't go further. To place it elsewhere, change Covers in the Inspector.`
        : `'${name}' can't go further: Nudge stops at ${OFFSET_LIMIT} px. To go further, change Sticks to in the Inspector.`
    Blockbench.showQuickMessage(together ? `The group stops here to keep its shape. ${why}` : why, STOP_NOTE_MS)
}

function moveAspects(nodes: any[], shift: EffectsShift | null): UndoAspects {
    return { elements: nodes, ...(shift ? materialsAspect() : {}) } as unknown as UndoAspects
}

function finishMove(label: string, nodes: any[], shift: EffectsShift | null) {
    Undo.finishEdit(label, moveAspects(nodes, shift))
    if (shift) Blockbench.dispatchEvent('update_selection', {} as any)
}

function keyable(node: any): boolean {
    return !!node?.constructor?.animator?.prototype?.channels?.[KEY_CHANNEL]
}

function keyAnimator(animation: any, node: any): any | null {
    try {
        const animator = animation.getBoneAnimator(node)
        const channel = animator?.channels?.[KEY_CHANNEL]
        if (!channel || typeof animator.createKeyframe !== 'function') return null
        return channel.condition === undefined || Condition(channel.condition, animator) ? animator : null
    } catch (error) {
        console.error('[polyplus_nameplate] could not find the layer\'s keyframes', error)
        return null
    }
}

function keyMoveFor(pick: StagePick, node: any): KeyMove {
    const animation = typeof BBAnimation !== 'undefined' ? (BBAnimation as any).selected : null
    const animator = node && animation ? keyAnimator(animation, node) : null
    let why = ''
    if (!animator) {
        if (!animation) why = 'Pick an animation first, then drag the layer to add a Position keyframe.'
        else if ('target' in pick && pick.target === 'name') why = 'The name text can\'t take keyframes, so it can\'t be dragged in Animate.'
        else why = `'${String(node?.name ?? 'This layer')}' can't take Position keyframes, so it can't be dragged in Animate.`
    }
    return { animator, why, keyframes: [], keyframe: null, base: [0, 0] }
}

function keyValue(keyframe: any, axis: 'x' | 'y'): number {
    try {
        const value = Number(keyframe.calc(axis))
        return isFinite(value) ? value : 0
    } catch {
        return 0
    }
}

function startKey(drag: Drag, key: KeyMove): boolean {
    Undo.initEdit({ keyframes: key.keyframes })
    let keyframe: any = null
    try {
        const fps = currentFps()
        const time = Math.max(0, Math.floor((Timeline.time || 0) * fps + FRAME_EPSILON)) / fps
        keyframe = key.animator.createKeyframe(null, time, KEY_CHANNEL, false)
    } catch (error) {
        console.error('[polyplus_nameplate] could not add a Position keyframe', error)
    }
    if (!keyframe) {
        Undo.cancelEdit(true)
        key.animator = null
        return false
    }
    key.keyframes.push(keyframe)
    key.keyframe = keyframe
    key.base = [keyValue(keyframe, 'x'), keyValue(keyframe, 'y')]
    drag.stops = [{ node: drag.node, x: flipped(offsetRoom(key.base[0]), drag.flip), y: offsetRoom(key.base[1]) }]
    drag.editing = true
    return true
}

function moveKey(drag: Drag, key: KeyMove, wantX: number, wantY: number) {
    if (!key.keyframe && !wantX && !wantY) return
    if (!key.animator) {
        if (!drag.told) {
            drag.told = true
            Blockbench.showQuickMessage(key.why, STOP_NOTE_MS)
        }
        return
    }
    const fresh = !key.keyframe
    if (fresh && !startKey(drag, key)) return
    const { dx, dy, stopped } = fitMove(drag.stops, wantX, wantY)
    if (stopped && !drag.told) {
        drag.told = true
        Blockbench.showQuickMessage(`'${String(drag.node?.name ?? 'This layer')}' can't go further: Position stops at ${OFFSET_LIMIT} px.`, STOP_NOTE_MS)
    }
    if (!fresh && dx === drag.applied[0] && dy === drag.applied[1]) return
    drag.applied = [dx, dy]
    key.keyframe.set('x', Math.round(key.base[0] + drag.flip * dx))
    key.keyframe.set('y', Math.round(key.base[1] + dy))
    updateKeyframeSelection()
    redraw(true)
}

function dragMove(event: MouseEvent) {
    const drag = state.drag
    if (!drag) return
    if (event.buttons === 0) {
        endDrag()
        return
    }
    const wantX = Math.round((event.clientX - drag.clientX) / drag.scale)
    const wantY = Math.round((event.clientY - drag.clientY) / drag.scale)
    if (wantX || wantY) drag.moved = true
    if (drag.key) {
        moveKey(drag, drag.key, wantX, wantY)
        return
    }
    const { dx, dy, stopped } = fitMove(drag.stops, wantX, wantY)
    if (stopped && !drag.told) {
        drag.told = true
        tellStop(stopped, drag.members.length + drag.moves.length > 1)
    }
    if (dx === drag.applied[0] && dy === drag.applied[1]) return
    if (drag.effect) {
        drag.applied = [dx, dy]
        const origin = drag.effect.origin
        drag.effect.set(drag.edge ? stretchMargins(origin, drag.edge, drag.flip * dx, dy) : shiftMargins(origin, drag.flip * dx, dy))
        drag.editing = true
        redraw(true)
        return
    }
    drag.applied = [dx, dy]
    if (!drag.editing) {
        drag.shift = beginEffectsShift(drag.moves)
        Undo.initEdit(moveAspects(drag.members.map((member) => member.node), drag.shift))
        drag.editing = true
    }
    drag.shift?.(dx, dy)
    for (const member of drag.members) {
        member.node.offset = [member.origin[0] + member.flip * dx, member.origin[1] + dy]
    }
    redraw(true)
}

function paintedSprite(node: any): NameplateLayer | null {
    const result = lastResult()
    const load = loadFiles(currentBundle().files)
    const preview = load.preview ?? load.draft?.() ?? null
    if (!result || !preview) return null
    return paintFrame(preview, result.frame, null).find((layer) => result.order[layer.index] === node.uuid && !layer.mirrorX) ?? null
}

function paintedAt(node: any, anchor: string, pivot: string, follow: string): NameplateLayer | null {
    Object.assign(node, { anchor, pivot, follow, offset: [0, 0] })
    return paintedSprite(node)
}

function anchorSpot(node: any, anchor: string, box: BlockRect): [number, number] {
    if (isNameAnchor(anchor)) {
        const row = nameRow()
        return [anchor === 'name_left' ? row.x : row.x + row.width, row.y + row.height / 2]
    }
    const [column, line] = ANCHOR_SPOTS[anchor]
    const at = takesAt(anchor) ? atValue(node[AT_PROPERTY]) : null
    const across = column === 0.5
    return [
        box.x0 + (box.x1 - box.x0) * (at !== null && across ? at : column),
        box.y0 + (box.y1 - box.y0) * (at !== null && !across ? at : line),
    ]
}

function nearestAnchor(node: any, box: BlockRect, x: number, y: number): string {
    const current = String(node.anchor ?? '')
    let nearest = current
    let shortest = Infinity
    for (const anchor of isNameAnchor(current) ? [current, ...ANCHORS] : ANCHORS) {
        const [spotX, spotY] = anchorSpot(node, anchor, box)
        const distance = Math.hypot(spotX - x, spotY - y)
        if (distance < shortest || (distance === shortest && anchor === current)) {
            nearest = anchor
            shortest = distance
        }
    }
    return nearest
}

function settleAnchor(node: any): string | null {
    if (node.repeatOn) return null
    const before = { anchor: node.anchor, pivot: node.pivot, follow: node.follow, offset: node.offset }
    try {
        const now = paintedSprite(node)
        const first = now && paintedAt(node, 'top_left', 'top_left', '')
        const last = first && paintedAt(node, 'bottom_right', 'top_left', '')
        Object.assign(node, before)
        if (!now || !first || !last) return null
        const box = { x0: first.x, y0: first.y, x1: last.x, y1: last.y }
        const anchor = nearestAnchor(node, box, layerLeft(now) + now.rasterWidth / 2, layerTop(now) + now.rasterHeight / 2)
        if (anchor === before.anchor) return null
        const spot = paintedAt(node, anchor, before.follow ? before.pivot : carriedPivot(before, anchor), before.follow)
        const nudge = spot ? [now.x - spot.x, now.y - spot.y] : null
        if (nudge && nudge.every((part) => Math.abs(part) <= OFFSET_LIMIT)) {
            node.offset = nudge
            return anchor
        }
    } catch (error) {
        console.error('[polyplus_nameplate] could not pick the nearest anchor', error)
    }
    Object.assign(node, before)
    return null
}

function endDrag() {
    const drag = state.drag
    if (!drag) return
    state.drag = null
    window.removeEventListener('mousemove', dragMove)
    window.removeEventListener('mouseup', endDrag)
    window.removeEventListener('blur', endDrag)
    if (handles.canvas) handles.canvas.style.transform = ''
    state.zoom = drag.zoom
    if (drag.key) {
        if (drag.key.keyframe) {
            Undo.finishEdit('Add Position keyframe')
            updateKeyframeSelection()
            redraw(true)
        }
    } else if (drag.effect) drag.effect.finish(drag.edge ? 'Resize effect area' : 'Move effect')
    else if (drag.editing) {
        const anchor = wanted() && drag.members.length === 1 && drag.moves.length === 0 ? settleAnchor(drag.members[0].node) : null
        finishMove(drag.members.length + drag.moves.length > 1 ? 'Move layers' : 'Move sprite', drag.members.map((member) => member.node), drag.shift)
        if (anchor) {
            Blockbench.showQuickMessage(`'${String(drag.node.name ?? '')}' now sticks to ${ANCHOR_LABELS[anchor]}.`, ANCHOR_NOTE_MS)
            redraw(true)
        }
    }
    if (drag.selectOnClick && !drag.moved) selectNode(drag.node)
    drawStage()
}

function emptyAt(offsetX: number, offsetY: number): boolean {
    if (previewUi.crowd || !inDesign()) return false
    return !onSwatch(offsetX, offsetY) && !pickAt(offsetX, offsetY)
}

function deselect() {
    Undo.initSelection()
    unselectAllElements()
    Undo.finishSelection('Unselect layers')
    drawStage()
}

let cancelPress = () => {}

function pressEmpty(event: MouseEvent) {
    const canvas = handles.canvas
    state.side = null
    const keep = movingTogether().length > 1 && document.activeElement !== canvas
    canvas?.focus()
    if (keep) return
    cancelPress()
    const release = (up: MouseEvent) => {
        cancelPress()
        if (Math.hypot(up.clientX - event.clientX, up.clientY - event.clientY) <= CLICK_SLOP) deselect()
    }
    window.addEventListener('mouseup', release)
    cancelPress = () => {
        window.removeEventListener('mouseup', release)
        cancelPress = () => {}
    }
}

function pressAround(event: MouseEvent) {
    const wrap = handles.wrap
    if (!wrap || event.button !== 0 || event.target !== wrap || previewUi.crowd || !inDesign()) return
    if (event.offsetX > wrap.clientWidth || event.offsetY > wrap.clientHeight) return
    event.preventDefault()
    pressEmpty(event)
}

function pressStage(event: MouseEvent) {
    if (wanted() && !inDesign()) {
        pressKey(event)
        return
    }
    const edge = edgeAt(event.offsetX, event.offsetY)
    const together = edge ? null : togetherPick(event.offsetX, event.offsetY)
    if (!edge && !together && emptyAt(event.offsetX, event.offsetY)) pressEmpty(event)
    const hit = edge ?? together?.pick ?? clickStage(event.offsetX, event.offsetY)
    if (!hit || !inDesign() || !movable(hit.node)) return
    const alone = !together && isEffect(hit.node)
    const effect = alone ? beginEffectAreaEdit(hit.node) : null
    if (alone && !effect) return
    const flip = hit.entry.mirrorX ? -1 : 1
    const sprites = (together?.nodes ?? [hit.node]).filter((node) => node.type === SPRITE_TYPE)
    const effects = (together?.nodes ?? []).filter(isEffect).sort((a, b) => Number(b === hit.node) - Number(a === hit.node))
    const members = sprites.map((node) => ({ node, origin: offsetOf(node), flip: node === hit.node ? flip : stageFlip(node) }))
    const moves = effects.map((node) => ({ node, flip: node === hit.node ? flip : stageFlip(node) }))
    const room = effect ? (edge ? stretchRoom(effect.origin, edge.edge) : shiftRoom(effect.origin)) : null
    state.side = { node: hit.node, flip }
    beginDrag(event, hit.node, flip, {
        members,
        moves,
        stops: room ? [{ node: hit.node, x: flipped(room.x, flip), y: room.y }] : moveStops(members, moves),
        selectOnClick: !!together,
        effect,
        edge: edge ? edge.edge : null,
    })
}

function beginDrag(event: MouseEvent, node: any, flip: number, fields: Partial<Drag>) {
    endDrag()
    event.preventDefault()
    const canvas = handles.canvas
    canvas?.focus()
    const scale = view.scale || 1
    const drag: Drag = {
        node,
        clientX: event.clientX,
        clientY: event.clientY,
        scale,
        zoom: state.zoom,
        members: [],
        moves: [],
        stops: [],
        told: false,
        shift: null,
        selectOnClick: false,
        moved: false,
        flip,
        applied: [0, 0],
        editing: false,
        anchor: null,
        effect: null,
        edge: null,
        key: null,
        ...fields,
    }
    state.drag = drag
    if (canvas && !previewOptions.wardrobe) {
        canvas.style.transform = ''
        drag.anchor = anchorOf(canvas)
    }
    state.zoom = scale
    window.addEventListener('mousemove', dragMove)
    window.addEventListener('mouseup', endDrag)
    window.addEventListener('blur', endDrag)
}

function pressKey(event: MouseEvent) {
    if (previewUi.crowd) return
    const pick = onSwatch(event.offsetX, event.offsetY) ? null : pickAt(event.offsetX, event.offsetY)
    clickStage(event.offsetX, event.offsetY)
    if (!pick) return
    if (Timeline.playing) Timeline.pause()
    const node = 'node' in pick ? pick.node : pick.target === 'badge' ? badgeNode() : null
    state.side = null
    beginDrag(event, node, 'entry' in pick && pick.entry.mirrorX ? -1 : 1, { key: keyMoveFor(pick, node) })
}

function nudgeFlip(node: any): number {
    const side = state.side
    return side && side.node === node ? side.flip : stageFlip(node)
}

function nudgeStage(event: KeyboardEvent) {
    const step = NUDGE_KEYS[event.key]
    if (!step || event.ctrlKey || event.metaKey || event.altKey || state.drag || previewUi.crowd || !inDesign()) return
    const selected = selectedLayerNodes()
    const targets = selected.filter((node) => node.type === SPRITE_TYPE)
    const effects = selected.filter(isEffect)
    if (targets.length === 0 && effects.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    const amount = event.shiftKey ? SHIFT_NUDGE : 1
    const members = targets.map((node) => ({ node, origin: offsetOf(node), flip: nudgeFlip(node) }))
    const moves = effects.map((node) => ({ node, flip: nudgeFlip(node) }))
    const { dx, dy, stopped } = fitMove(moveStops(members, moves), step[0] * amount, step[1] * amount)
    if (stopped) tellStop(stopped, members.length + moves.length > 1)
    if (!dx && !dy) return
    const shift = beginEffectsShift(moves)
    if (targets.length === 0 && !shift) return
    undoEdit(moveAspects(targets, shift), shift ? (targets.length ? 'Nudge layers' : 'Move effect') : 'Nudge sprite', () => {
        shift?.(dx, dy)
        for (const member of members) member.node.offset = [member.origin[0] + member.flip * dx, member.origin[1] + dy]
    })
    if (shift) Blockbench.dispatchEvent('update_selection', {} as any)
    redraw(true)
}

function zoomStage(direction: number) {
    const current = state.zoom > 0 ? state.zoom : view.scale || 1
    state.zoom = Math.min(MAX_SCALE, Math.max(1, current + direction * (current >= 12 ? 2 : 1)))
    drawStage()
}

export function stopPlayback() {
    if (state.timer !== null) {
        clearInterval(state.timer)
        state.timer = null
    }
    previewUi.playing = false
    const play = (BarItems as any).polyplus_nameplate_play as Action | undefined
    play?.setIcon?.('play_arrow')
}

function startPlayback() {
    stopPlayback()
    previewUi.playing = true
    const play = (BarItems as any).polyplus_nameplate_play as Action | undefined
    play?.setIcon?.('pause')
    const interval = Math.max(20, Math.round(1000 / Math.max(1, previewUi.fps)))
    state.timer = setInterval(() => {
        previewUi.frame = (previewUi.frame + 1) % Math.max(1, previewUi.loop)
        redraw(false)
        updateItems()
    }, interval)
}

function togglePlayback() {
    if (previewUi.playing) stopPlayback()
    else startPlayback()
}

function makeItems(): BarItem[] {
    const always = { formats: [FORMAT_ID] }
    const design = { formats: [FORMAT_ID], modes: [DESIGN_MODE] }
    const viewAction = (id: string, name: string, icon: string, click: () => void, condition = always) =>
        defineAction(id, { name, icon, category: 'view', condition, click })
    const slider = (
        id: string,
        name: string,
        description: string,
        condition: typeof always,
        settings: { min: number, max: number, default: number },
        read: () => number,
        write: (value: number) => void,
        max: () => number = () => settings.max,
        fallback?: number,
    ) =>
        new NumSlider(id, {
            name,
            description,
            condition,
            settings: { ...settings, step: 1 },
            get: read,
            change(modify: (value: number) => number) {
                write(wholeClamped(modify(read()), settings.min, max(), fallback ?? read()))
                redraw(false)
            },
        } as any)
    const variant = new BarSelect('polyplus_nameplate_preview_variant', {
        name: 'Variant',
        description: 'Which variant to preview',
        condition: always,
        options: { default: 'default' },
        value: 'default',
        onChange(self: BarSelect) {
            previewUi.variant = self.get()
            setPreviewOverride(null)
            redraw(false)
        },
    })
    const lines = new BarSelect('polyplus_nameplate_lines', {
        name: 'Lines',
        description: 'Lines of text, like a rank line on a server',
        condition: always,
        options: LINE_CHOICES,
        value: '1',
        onChange(self: BarSelect) {
            setLineChoice(self.get())
            redraw(false)
        },
    })
    const crowd = new Toggle(CROWD_TOGGLE, {
        name: 'Crowd View',
        description: 'Show many players at once',
        icon: 'groups',
        category: 'view',
        condition: always,
        default: false,
        onChange(value: boolean) {
            setCrowdView(value)
        },
    })
    const strip = new Toggle(STRIP_TOGGLE, {
        name: 'Color Strip',
        description: 'Show the colors under the preview, or fold them to one line',
        icon: 'palette',
        category: 'view',
        condition: always,
        default: true,
        save_on_restart: true,
        onChange(value: boolean) {
            setStripFolded(!value)
        },
    } as any)
    return [
        strip,
        viewAction('polyplus_nameplate_zoom_out', 'Zoom Out', 'zoom_out', () => zoomStage(-1)),
        viewAction('polyplus_nameplate_zoom_fit', 'Fit Nameplate', 'fit_screen', () => {
            state.zoom = 0
            drawStage()
        }),
        viewAction('polyplus_nameplate_zoom_in', 'Zoom In', 'zoom_in', () => zoomStage(1)),
        crowd,
        variant,
        ...makeOptionItems(),
        slider(
            'polyplus_nameplate_name_width',
            'Name Width',
            'Try short and long names',
            always,
            { min: 1, max: 200, default: 27 },
            () => previewUi.nameWidth,
            (value) => {
                previewUi.nameWidth = value
                previewUi.autoWidth = false
            },
        ),
        lines,
        slider(
            'polyplus_nameplate_seed',
            'Seed',
            'Change it to see timing that differs per player',
            always,
            { min: 0, max: 9999, default: 0 },
            () => previewUi.seed,
            (value) => {
                previewUi.seed = value
            },
        ),
        viewAction('polyplus_nameplate_play', 'Play Loop', 'play_arrow', togglePlayback, design),
        slider(
            'polyplus_nameplate_frame',
            'Frame',
            'Counted from 0, like the timeline',
            design,
            { min: 0, max: 599, default: 0 },
            () => previewUi.frame,
            (value) => {
                previewUi.frame = value
            },
            () => Math.max(0, previewUi.loop - 1),
            0,
        ),
    ]
}

export function updateItems() {
    const items = BarItems as any
    const variant = items.polyplus_nameplate_preview_variant as BarSelect | undefined
    if (variant) {
        const names = previewUi.variants.length ? previewUi.variants : [previewUi.variant || 'default']
        variant.options = Object.fromEntries(names.map((name) => [name, name]))
        variant.values = names.slice()
        if (previewUi.variant && names.includes(previewUi.variant)) variant.set(previewUi.variant)
    }
    const lines = items.polyplus_nameplate_lines as BarSelect | undefined
    lines?.set?.(lineChoice())
    syncOptionItems()
    const frame = items.polyplus_nameplate_frame
    if (frame) frame.settings.max = Math.max(0, previewUi.loop - 1)
    for (const id of ['polyplus_nameplate_name_width', 'polyplus_nameplate_seed', 'polyplus_nameplate_frame']) items[id]?.update?.()
}

function mount() {
    if (handles.root) return
    const host = Interface.preview as HTMLElement | null
    if (!host) return
    const div = (className: string, ...children: Node[]) => {
        const element = document.createElement('div')
        element.className = className
        element.append(...children)
        return element
    }
    const bannerIcon = document.createElement('i')
    bannerIcon.className = 'material-icons notranslate icon'
    const banner = div('np-stage-banner', bannerIcon, document.createElement('span'))
    banner.style.cssText = BANNER_STYLE
    const canvas = document.createElement('canvas')
    canvas.className = 'np-stage-canvas'
    canvas.tabIndex = 0
    canvas.style.outline = 'none'
    canvas.addEventListener('mousedown', (event: MouseEvent) => {
        if (event.button === 0) pressStage(event)
    })
    canvas.addEventListener('keydown', nudgeStage)
    canvas.addEventListener('mousemove', hoverStage)
    canvas.addEventListener('mouseleave', () => setHover(null, ''))
    const wrap = div('np-stage-view', canvas)
    wrap.addEventListener('mousedown', pressAround)
    wrap.addEventListener('wheel', (event: WheelEvent) => {
        event.preventDefault()
        zoomStage(event.deltaY < 0 ? 1 : -1)
    }, { passive: false } as any)
    const hint = div('np-stage-hint')
    const area = div('np-stage-area', wrap, hint)
    area.style.cssText = AREA_STYLE
    area.style.minHeight = AREA_MIN_HEIGHT
    const strip = div('np-strip-host')
    strip.style.cssText = STRIP_HOST_STYLE
    const bar = div('np-stage-bar')
    if (handles.toolbar) bar.appendChild(handles.toolbar.node)
    const root = document.createElement('div')
    root.id = OVERLAY_ID
    root.append(bar, banner, area, strip)
    host.appendChild(root)
    setStripHost(strip)
    Object.assign(handles, { root, canvas, wrap, hint, banner, area, strip })
    if (typeof ResizeObserver !== 'undefined') {
        handles.observer = new ResizeObserver(() => {
            requestAnimationFrame(fitStrip)
            onStageResize()
        })
        handles.observer.observe(wrap)
        handles.observer.observe(root)
        handles.observer.observe(bar)
    }
    fitStrip()
    handles.toolbar?.update?.()
    syncNameWidth()
    updateItems()
    redraw(true)
    drawStage()
}

function onStageResize() {
    const wrap = handles.wrap
    const size = wrap ? `${wrap.clientWidth}x${wrap.clientHeight}` : ''
    if (size !== state.size && !state.drag) {
        if (state.size) state.zoom = 0
        state.size = size
    }
    drawStage()
}

function unmount() {
    cancelPress()
    endDrag()
    state.hover = null
    state.side = null
    if (handles.root) setStripHost(null)
    handles.observer?.disconnect()
    handles.root?.remove()
    Object.assign(handles, { root: null, canvas: null, wrap: null, hint: null, banner: null, area: null, strip: null, observer: null })
    state.size = ''
}

function syncStage() {
    if (!wanted()) {
        stopPlayback()
        unmount()
        return
    }
    if (!inDesign()) stopPlayback()
    mount()
    drawStage()
}

export function registerStage(): () => void {
    handles.items = makeItems()
    handles.toolbar = pluginToolbar(STAGE_TOOLBAR, {
        name: 'Nameplate Preview',
        condition: { formats: [FORMAT_ID] },
        children: [
            STRIP_TOGGLE,
            '_',
            'polyplus_nameplate_zoom_out',
            'polyplus_nameplate_zoom_fit',
            'polyplus_nameplate_zoom_in',
            CROWD_TOGGLE,
            '_',
            'polyplus_nameplate_preview_variant',
            LOOK_SELECT,
            OPTIONS_ACTION,
            '_',
            'polyplus_nameplate_name_width',
            'polyplus_nameplate_lines',
            'polyplus_nameplate_seed',
            '_',
            'polyplus_nameplate_play',
            'polyplus_nameplate_frame',
        ],
    })
    handles.removers.push(
        registerColorStrip(),
        onLight(() => {
            syncStage()
            updateItems()
        }),
        onPreviewResult(() => {
            updateItems()
            drawStage()
        }),
        onFontReady(() => drawStage()),
    )
    syncStage()
    return () => {
        disposeAll(handles.removers)
        stopPlayback()
        unmount()
        if (handles.toolbar) dropToolbar(handles.toolbar)
        handles.toolbar = null
        disposeAll(handles.items)
        shown.layers = []
        shown.order = []
        state.zoom = 0
        framing.files = null
        framing.key = ''
        framing.bounds = null
        crowdFraming.files = null
        crowdFraming.key = ''
        crowdFraming.boxes = new Map()
    }
}
