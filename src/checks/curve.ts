import { currentBundle } from '../compile'
import { bodyCorners, Corners, readCorners } from '../corners/shape'
import { stopPlayback, updateItems } from '../design/stage'
import { readLayers } from '../elements'
import { findNode, layerNodes } from '../elements/nodes'
import { layerLeft, layerTop, NameplateLayer, NameplatePreview } from '../engine'
import type { Problem } from '../export/issues'
import { BODY_TYPE, CompiledBundle, SPRITE_TYPE } from '../model'
import { SPRITE_FOLLOWS } from '../motion/types'
import { goMode, showLayer } from '../navigate'
import { readNameplate } from '../palette/state'
import { loadFiles, nameWidthOf, previewUi, redraw, referenceName, setPreviewOverride } from '../preview'
import { CrowdLayout, layoutTag } from '../preview/crowd'
import { applyPreset, presetById } from '../preview/menu'
import { LINE_ABOVE, LINE_BELOW } from '../preview/options'
import { badgeRect, GLYPH_ROWS, Rect } from '../text/backdrop'
import { styleOf } from '../text/style'
import { hasProject } from '../util/project'
import { SHOW_ME } from './helpers'

const LINE_COUNTS = [2, 3]
const LINE_NAMES: Record<number, string> = { 2: 'two lines', 3: 'three lines' }
const FIX = "Lower the roundness of that corner, pick a spot further along the edge, or turn off Follow the body's edge."

interface Follower {
    label: string
    uuid: string | null
    touches(layout: CrowdLayout, variant: string): boolean
}

interface Hit {
    follower: Follower
    variant: string
    name: string
    lines: number
}

let memo: { bundle: CompiledBundle | null, names: string, problems: Problem[] } = { bundle: null, names: '', problems: [] }

function curved(body: any): boolean {
    const corners: Corners = readCorners(body) ?? bodyCorners({ radius: Number(body?.radius ?? 0) })
    return corners.some((corner) => corner > 0)
}

function textRects(layout: CrowdLayout): Rect[] {
    return layout.runs.map((run) => ({ x: run.x, y: run.y, width: run.width, height: GLYPH_ROWS }))
}

function inside(rects: Rect[], x: number, y: number): boolean {
    return rects.some((rect) => x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height)
}

function layerTouches(layer: NameplateLayer, rects: Rect[]): boolean {
    const left = layerLeft(layer)
    const top = layerTop(layer)
    for (let row = 0; row < layer.rasterHeight; row++) {
        for (let column = 0; column < layer.rasterWidth; column++) {
            const source = layer.mirrorX ? layer.rasterWidth - 1 - column : column
            if (layer.rgba[(row * layer.rasterWidth + source) * 4 + 3] > 0 && inside(rects, left + column, top + row)) return true
        }
    }
    return false
}

function overlaps(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function spriteFollowers(preview: NameplatePreview): Follower[] {
    const ids = new Map(readLayers().map((layer) => [layer.uuid, layer.id]))
    const followers: Follower[] = []
    for (const node of layerNodes()) {
        if (node.type !== SPRITE_TYPE || !SPRITE_FOLLOWS.includes(node.follow)) continue
        const body = findNode(String(node.of ?? ''))
        const id = ids.get(node.uuid)
        if (!id || body?.type !== BODY_TYPE || !curved(body)) continue
        followers.push({
            label: `Sprite '${String(node.name ?? '')}'`,
            uuid: String(node.uuid),
            touches(layout, variant) {
                const rects = textRects(layout)
                return preview.paint(variant, layout.block, 0, 0).some((layer) => layer.layer === id && layerTouches(layer, rects))
            },
        })
    }
    return followers
}

function badgeFollower(preview: NameplatePreview, variant: string): Follower | null {
    const badge = styleOf(readNameplate(), variant).badge
    const body = badge.placement === 'placed' && badge.follow && badge.of ? findNode(badge.of) : null
    if (body?.type !== BODY_TYPE || !curved(body)) return null
    return {
        label: 'The badge',
        uuid: null,
        touches(layout) {
            const box = badgeRect(badge, layout, { preview, variant })
            return textRects(layout).some((rect) => overlaps(box, rect))
        },
    }
}

function checkedNames(): string[] {
    const names = [presetById('short')?.options.name, referenceName(), presetById('long')?.options.name]
    return [...new Set(names.filter((name): name is string => !!name))]
}

function tagLayout(name: string, lines: number, variant: string): CrowdLayout {
    const nameLine = Math.floor((lines - 1) / 2)
    return layoutTag(
        {
            name,
            badge: styleOf(readNameplate(), variant).badge.placement !== 'placed',
            above: Array.from({ length: nameLine }, () => LINE_ABOVE),
            below: Array.from({ length: lines - 1 - nameLine }, () => LINE_BELOW),
        },
        nameWidthOf,
    )
}

function hitOf(follower: Follower, variant: string): Hit | null {
    for (const name of checkedNames()) {
        if (follower.touches(tagLayout(name, 1, variant), variant)) continue
        const lines = LINE_COUNTS.find((count) => follower.touches(tagLayout(name, count, variant), variant))
        if (lines !== undefined) return { follower, variant, name, lines }
    }
    return null
}

function findHits(preview: NameplatePreview): Hit[] {
    const hits = new Map<string, Hit>()
    const sprites = spriteFollowers(preview)
    for (const variant of preview.variants) {
        const badge = badgeFollower(preview, variant)
        for (const follower of badge ? [...sprites, badge] : sprites) {
            const key = follower.uuid ?? 'badge'
            if (hits.has(key)) continue
            const hit = hitOf(follower, variant)
            if (hit) hits.set(key, hit)
        }
    }
    return [...hits.values()]
}

export function refreshStage() {
    redraw(false)
    try {
        updateItems()
    } catch (error) {
        console.error('[polyplus_nameplate] could not refresh the preview controls', error)
    }
}

function showHit(hit: Hit) {
    goMode('design')
    const node = hit.follower.uuid ? findNode(hit.follower.uuid) : null
    if (node) showLayer(node)
    stopPlayback()
    previewUi.variant = hit.variant
    previewUi.frame = 0
    setPreviewOverride(null)
    applyPreset({ id: '', name: '', icon: '', description: '', lines: hit.lines, options: { name: hit.name } })
    refreshStage()
}

function problemFor(hit: Hit, variants: string[]): Problem {
    const inVariant = variants.length > 1 ? ` in variant '${hit.variant}'` : ''
    return {
        level: 'warning',
        code: 'curve_text',
        text: `${hit.follower.label} lands on the letters of '${hit.name}' with ${LINE_NAMES[hit.lines]}${inVariant}. ${FIX}`,
        target: null,
        buttons: [{ ...SHOW_ME, click: () => showHit(hit) }],
    }
}

export function curveTextProblems(): Problem[] {
    if (!hasProject()) return []
    const bundle = currentBundle()
    const names = checkedNames().join('|')
    if (memo.bundle === bundle && memo.names === names) return memo.problems
    let problems: Problem[] = []
    const preview = bundle.issues.length > 0 ? null : loadFiles(bundle.files).preview
    if (preview) problems = findHits(preview).map((hit) => problemFor(hit, preview.variants))
    memo = { bundle, names, problems }
    return problems
}
