import {
    BlockRect,
    displayBlock,
    drawLayers,
    layerBounds,
    lineBlock,
    NameplateBadgePose,
    NameplateBlock,
    NameplateDetail,
    NameplateLayer,
    NameplatePreview,
    NameplateTagState,
    placedBlock,
    STILL_BADGE,
} from '../engine'
import { tagState } from './live'
import { BadgeLook, drawBadgeArt, PLAIN_BADGE } from '../badge/art'
import { drawText } from '../font'
import { eraTextColor } from '../gpu'
import { readNameplate } from '../palette/state'
import { BADGE_CELLS_HIGH, BADGE_CELLS_WIDE, badgeRect, loopPixels } from '../text/backdrop'
import { resolveBadge } from '../text/contrast'
import { styleOf, VariantStyle } from '../text/style'
import { NameLetters, paintLetters } from '../text/letters'
import { hasProject } from '../util/project'
import { backgroundColor, backgroundRect, TagPadding, VANILLA_BACKGROUND } from './options'

const LINE_PITCH = 10
const BADGE_ADVANCE = 11
const BADGE_SIZE = 8
const GAP_X = 14
const GAP_Y = 12
const MAX_SCALE = 6
const FRONT_DEPTH = 'over_text'
const NAME_COLOR = '#FFFFFF'
const RANK_COLOR = '#FFAA00'
export const LINE_COLOR = '#E0E0E0'
const SEED_STEP = 7919
const SEED_MASK = 0x7fffffff

export interface CrowdSpec {
    name: string
    rank?: string
    rankColor?: string
    badge?: boolean
    above?: string[]
    below?: string[]
    widths?: number[]
}

export const CROWD: CrowdSpec[] = [
    { name: 'Steve' },
    { name: 'Alex', badge: true },
    { name: 'Mo' },
    { name: 'Lantern_Keeper', rank: '[VIP] ' },
    { name: 'xX_Redstone_Wizard_Xx' },
    { name: 'Pixel', rank: '[MOD] ', badge: true },
    { name: 'Builder', below: ['Level 42'] },
    { name: 'Q', above: ['Team Red'], below: ['12 kills'] },
    { name: 'Sunny_Days', badge: true, below: ['Online'] },
    { name: 'Juniper', rank: '[ADMIN] ' },
]

export type RunKind = 'rank' | 'name' | 'line'

export interface TextRun {
    kind: RunKind
    text: string
    color: string
    x: number
    y: number
    width: number
}

export interface CrowdTag {
    key: string
    seed: number
    block: NameplateBlock
    width: number
    height: number
    runs: TextRun[]
    badge: { x: number, y: number } | null
    background: BlockRect
    padded: boolean
    layers: NameplateLayer[]
    plate: NameplateBadgePose
    badgePose: NameplateBadgePose
    badgeLook: BadgeLook | null
    letters: NameLetters | null
}

export type CrowdLayout = Omit<CrowdTag, 'key' | 'seed' | 'layers' | 'plate' | 'badgePose' | 'badgeLook' | 'letters'>

export interface CrowdPaint {
    detail: NameplateDetail
    still: boolean
    padding: TagPadding | null
}

const FULL_PAINT: CrowdPaint = { detail: 'full', still: false, padding: null }

export interface TagPoses {
    plate: NameplateBadgePose
    badge: NameplateBadgePose
}

export function tagPoses(
    preview: NameplatePreview,
    variant: string,
    block: NameplateBlock,
    frame: number,
    seed: number,
    state: NameplateTagState | null,
    detail: NameplateDetail,
): TagPoses {
    try {
        const plate = preview.platePose(variant, block, frame, seed, state, detail)
        const follow = preview.badgeFollow(variant, block, frame, seed, state, detail)
        const own = preview.badgePose(frame, seed, state, detail)
        return { plate, badge: { ...own, dx: own.dx + follow.dx + plate.dx, dy: own.dy + follow.dy + plate.dy } }
    } catch (error) {
        console.error('[polyplus_nameplate] badge preview failed', error)
        return { plate: STILL_BADGE, badge: STILL_BADGE }
    }
}

export function movedRun(run: TextRun, plate: NameplateBadgePose): TextRun {
    return run.kind === 'line' ? run : { ...run, x: run.x + plate.dx, y: run.y + plate.dy }
}

export interface CrowdBox {
    minX: number
    minY: number
    width: number
    height: number
}

type Measure = (text: string) => number

function advance(text: string, measure: Measure): number {
    return text ? measure(text) + 1 : 0
}

function place(layout: Omit<CrowdLayout, 'background' | 'padded'>, prefix: number, padding: TagPadding | null): CrowdLayout {
    const background = backgroundRect(layout.block.width, layout.block.height, padding)
    const block = padding ? placedBlock(layout.block, prefix, background) : layout.block
    return { ...layout, block, background, padded: !!padding }
}

export function layoutTag(spec: CrowdSpec, measure: Measure, padding: TagPadding | null = null): CrowdLayout {
    const rank = spec.rank ?? ''
    const rankColor = spec.rankColor ?? RANK_COLOR
    const prefix = advance(rank, measure)
    const texts = [...(spec.above ?? []), `${rank}${spec.name}`, ...(spec.below ?? [])]
    const nameLine = spec.above?.length ?? 0
    const fixed = spec.widths && spec.widths.length === texts.length ? spec.widths : null
    const nameWidth = fixed ? Math.max(1, fixed[nameLine] - prefix) : measure(spec.name)
    const widths = texts.map((text, index) => (index === nameLine ? prefix + nameWidth : fixed ? fixed[index] : measure(text)))
    const badge = !!spec.badge
    const pad = texts.length === 1 ? padding : null
    if (texts.length === 1 && !badge) {
        const block = lineBlock(prefix + nameWidth, prefix, nameWidth)
        const runs = nameRuns(rank, rankColor, spec.name, prefix, nameWidth, 0, 0, measure)
        return place({ block, width: block.width, height: block.height, runs, badge: null }, prefix, pad)
    }
    const maxWidth = Math.max(...widths)
    const nameOffset = maxWidth - widths[nameLine]
    const xs = widths.map((width) => Math.floor((maxWidth - width - nameOffset) / 2))
    const ys = widths.map((_, index) => (index - nameLine) * LINE_PITCH)
    const x0 = Math.min(...xs, badge ? -BADGE_ADVANCE : Infinity)
    const y0 = Math.min(...ys)
    const block = displayBlock(widths, maxWidth, 'center', nameLine, prefix, nameWidth, badge)
    const runs: TextRun[] = []
    texts.forEach((text, index) => {
        const x = xs[index] - x0
        const y = ys[index] - y0
        if (index === nameLine) runs.push(...nameRuns(rank, rankColor, spec.name, prefix, nameWidth, x, y, measure))
        else runs.push({ kind: 'line', text, color: LINE_COLOR, x, y, width: widths[index] })
    })
    return place({
        block,
        width: block.width,
        height: block.height,
        runs,
        badge: badge ? { x: -BADGE_ADVANCE - x0, y: -y0 } : null,
    }, prefix, pad)
}

function nameRuns(rank: string, rankColor: string, name: string, prefix: number, nameWidth: number, x: number, y: number, measure: Measure): TextRun[] {
    const runs: TextRun[] = []
    const shown = rank.trimEnd()
    if (shown) runs.push({ kind: 'rank', text: shown, color: rankColor, x, y, width: measure(shown) })
    runs.push({ kind: 'name', text: name, color: NAME_COLOR, x: x + prefix, y, width: nameWidth })
    return runs
}

export function crowdSeed(base: number, index: number): number {
    return (Math.imul(base + 1, 31) + index * SEED_STEP) & SEED_MASK
}

export function paintCrowd(
    preview: NameplatePreview,
    variant: string,
    frame: number,
    seed: number,
    measure: Measure,
    keep: (layer: NameplateLayer) => boolean,
    base?: CrowdSpec,
    stateFor: (key: string, seed: number) => NameplateTagState | null = (key, seed) => tagState(key, variant, frame, seed),
    look: CrowdPaint = FULL_PAINT,
): CrowdTag[] {
    const specs = base ? [base, ...CROWD.slice(1)] : CROWD
    const painted = look.still ? 0 : frame
    const style = specs.some((spec) => spec.badge) ? badgeStyle(variant) : null
    const pinned = style?.badge.placement === 'placed'
    return specs.map((spec, index) => {
        const key = crowdKey(index)
        const tagSeed = crowdSeed(seed, index)
        const layout = layoutTag(pinned && spec.badge ? { ...spec, badge: false } : spec, measure, look.padding)
        if (pinned && spec.badge && style) {
            const rect = badgeRect(style.badge, layout, { preview, variant })
            layout.badge = { x: rect.x, y: rect.y }
        }
        const state = stateFor(key, tagSeed)
        const layers = preview.paint(variant, layout.block, painted, tagSeed, state, look.detail).filter(keep)
        const poses = tagPoses(preview, variant, layout.block, painted, tagSeed, state, look.detail)
        const badgeLook = layout.badge ? crowdBadgeLook(preview, variant, style, layout) : null
        const otherRuns = (spec.rank?.trim() ? 1 : 0) + (spec.badge && !pinned ? 1 : 0)
        const letters = paintLetters(preview, variant, layout.block, frame, tagSeed, state, look, spec.name, otherRuns)
        return { key, seed: tagSeed, layers, plate: poses.plate, badgePose: poses.badge, badgeLook, letters, ...layout }
    })
}

function badgeStyle(variant: string): VariantStyle | null {
    if (!hasProject()) return null
    try {
        return styleOf(readNameplate(), variant)
    } catch (error) {
        console.error('[polyplus_nameplate] could not read the badge style', error)
        return null
    }
}

function crowdBadgeLook(preview: NameplatePreview, variant: string, style: VariantStyle | null, layout: CrowdLayout): BadgeLook {
    if (!style || !layout.badge) return PLAIN_BADGE
    const rect = { x: layout.badge.x, y: layout.badge.y, width: BADGE_CELLS_WIDE, height: BADGE_CELLS_HIGH }
    return resolveBadge(style.badge, loopPixels(preview, variant, rect, [], layout.block), style.resolve)
}

function crowdKey(index: number): string {
    return `crowd:${index}`
}

export function crowdKeys(): string[] {
    return CROWD.map((_, index) => crowdKey(index))
}

export function widenBox(a: CrowdBox, b: CrowdBox): CrowdBox {
    const minX = Math.min(a.minX, b.minX)
    const minY = Math.min(a.minY, b.minY)
    return {
        minX,
        minY,
        width: Math.max(a.minX + a.width, b.minX + b.width) - minX,
        height: Math.max(a.minY + a.height, b.minY + b.height) - minY,
    }
}

export function tagBox(tag: CrowdTag): CrowdBox {
    const back = tag.background
    const width = back.x1 - back.x0
    const height = back.y1 - back.y0
    const { dx, dy } = tag.plate
    const mark = (x: number, y: number, markWidth: number, markHeight: number) =>
        ({ left: 0, top: 0, x, y, width: markWidth, mirrorX: false, rasterWidth: markWidth, rasterHeight: markHeight })
    const marks = [
        mark(back.x0, back.y0, width, height),
        mark(back.x0 + dx, back.y0 + dy, width, height),
        ...(tag.badge ? [mark(tag.badge.x + dx, tag.badge.y + dy, BADGE_SIZE, BADGE_SIZE)] : []),
    ] as NameplateLayer[]
    return layerBounds([...tag.layers, ...marks])
}

export interface CrowdPlacement {
    tag: CrowdTag
    box: CrowdBox
    x: number
    y: number
}

export function loopBox(tag: CrowdTag, loop: number, samples: number, paint: (tag: CrowdTag, frame: number) => NameplateLayer[]): CrowdBox {
    let box = tagBox(tag)
    for (let index = 0; index < samples; index++) {
        box = widenBox(box, tagBox({ ...tag, layers: paint(tag, Math.floor((index * loop) / samples)) }))
    }
    return box
}

export function flowCrowd(tags: CrowdTag[], columns: number, boxes: Map<string, CrowdBox>): { placed: CrowdPlacement[], width: number, height: number } {
    const placed: CrowdPlacement[] = []
    let x = 0
    let y = 0
    let rowHeight = 0
    let width = 0
    for (const tag of tags) {
        const box = boxes.get(tag.key) ?? tagBox(tag)
        if (x > 0 && x + box.width > columns) {
            x = 0
            y += rowHeight + GAP_Y
            rowHeight = 0
        }
        placed.push({ tag, box, x, y })
        x += box.width + GAP_X
        rowHeight = Math.max(rowHeight, box.height)
        width = Math.max(width, x - GAP_X)
    }
    return { placed, width, height: y + rowHeight }
}

export function fitCrowd(
    tags: CrowdTag[],
    viewWidth: number,
    viewHeight: number,
    zoom: number,
    pad: number,
    boxes: Map<string, CrowdBox>,
): { scale: number, placed: CrowdPlacement[], width: number, height: number } {
    const columnsAt = (scale: number) => Math.max(1, Math.floor(viewWidth / scale) - pad * 2)
    if (zoom > 0) return { scale: zoom, ...flowCrowd(tags, columnsAt(zoom), boxes) }
    for (let scale = MAX_SCALE; scale > 1; scale--) {
        const flow = flowCrowd(tags, columnsAt(scale), boxes)
        if ((flow.width + pad * 2) * scale <= viewWidth && (flow.height + pad * 2) * scale <= viewHeight) return { scale, ...flow }
    }
    return { scale: 1, ...flowCrowd(tags, columnsAt(1), boxes) }
}

export type NameDrawer = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, letters?: NameLetters | null) => void

export function drawRun(ctx: CanvasRenderingContext2D, run: TextRun, scale: number, originX: number, originY: number, name?: NameDrawer, letters: NameLetters | null = null) {
    const x = originX + run.x * scale
    const y = originY + run.y * scale
    if (run.kind === 'name' && name) name(ctx, run.text, x, y, scale, letters)
    else drawText(ctx, run.text, x, y, scale, eraTextColor(run.color))
}

export function fillBackground(ctx: CanvasRenderingContext2D, rect: BlockRect, color: string, scale: number, originX: number, originY: number) {
    ctx.fillStyle = color
    ctx.fillRect(originX + rect.x0 * scale, originY + rect.y0 * scale, (rect.x1 - rect.x0) * scale, (rect.y1 - rect.y0) * scale)
}

export function drawCrowd(
    ctx: CanvasRenderingContext2D,
    placed: CrowdPlacement[],
    scale: number,
    pad: number,
    background: boolean,
    name?: NameDrawer,
) {
    ctx.imageSmoothingEnabled = false
    for (const entry of placed) {
        const tag = entry.tag
        const originX = (pad + entry.x - entry.box.minX) * scale
        const originY = (pad + entry.y - entry.box.minY) * scale
        if (background) fillBackground(ctx, tag.background, tag.padded ? backgroundColor() : VANILLA_BACKGROUND, scale, originX, originY)
        drawLayers(ctx, tag.layers.filter((layer) => layer.depth !== FRONT_DEPTH), scale, originX, originY)
        ctx.save()
        for (const run of tag.runs) drawRun(ctx, movedRun(run, tag.plate), scale, originX, originY, name, tag.letters)
        const pose = tag.badgePose ?? STILL_BADGE
        if (tag.badge && pose.visible && pose.opacity > 0) {
            ctx.globalAlpha = pose.opacity / 255
            drawBadgeArt(ctx, originX + (tag.badge.x + pose.dx) * scale, originY + (tag.badge.y + pose.dy) * scale, scale, tag.badgeLook ?? PLAIN_BADGE)
            ctx.globalAlpha = 1
        }
        ctx.restore()
        drawLayers(ctx, tag.layers.filter((layer) => layer.depth === FRONT_DEPTH), scale, originX, originY)
    }
}
