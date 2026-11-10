import { BundleBinary, layerLeft, layerTop, lineBlock, loadBundle } from '../engine'
import { luminance, rgbHex } from '../palette/color'
import { stringifyJson } from '../util/bundleJson'

const NAME_WIDTH = 29
const LINE_HEIGHT = 8
const GRAY = 128
const MAX_HINTS = 8

function flatten(r: number, g: number, b: number, a: number, additive: boolean): number {
    const t = a / 255
    const mix = (value: number) => Math.round(additive ? Math.min(255, GRAY + value * t) : GRAY + (value - GRAY) * t)
    return (mix(r) << 16) | (mix(g) << 8) | mix(b)
}

function pick(colors: Set<number>): string[] {
    const sorted = Array.from(colors).sort((a, b) => luminance(a) - luminance(b) || a - b)
    const chosen = sorted.length <= MAX_HINTS
        ? sorted
        : Array.from(new Set(Array.from({ length: MAX_HINTS }, (_, i) => sorted[Math.round((i * (sorted.length - 1)) / (MAX_HINTS - 1))])))
    return chosen.map(rgbHex)
}

export function toneHints(files: Record<string, string>, binary: BundleBinary, only?: string): Record<string, string[]> {
    const result: Record<string, string[]> = {}
    let manifest: any
    try {
        manifest = JSON.parse(files['manifest.json'])
    } catch {
        return result
    }
    const order: string[] = (Array.isArray(manifest?.layers) ? manifest.layers : []).map((entry: any) => String(entry?.id))
    const smooth = new Map<string, string>()
    for (const id of order) {
        try {
            const layer = JSON.parse(files[`layers/${id}.json`] ?? 'null')
            if (layer?.kind !== 'material') continue
            const graph = JSON.parse(files[`materials/${layer.material}.json`] ?? 'null')
            const wanted = only === undefined ? graph?.resolution === 'smooth' : layer.material === only
            if (graph && wanted) smooth.set(id, String(layer.material))
        } catch {
            continue
        }
    }
    if (smooth.size === 0) return result
    const loaded = loadBundle(files, binary)
    const preview = loaded.preview ?? (only === undefined ? null : loaded.draft?.() ?? null)
    if (!preview) return result
    const block = lineBlock(NAME_WIDTH, 0, NAME_WIDTH)
    const samples = new Map<string, Set<number>>()
    for (const variant of preview.variants) {
        const swaps: Record<string, string> = manifest?.variants?.[variant]?.swap ?? {}
        for (let frame = 0; frame < preview.loop; frame++) {
            for (const layer of preview.paint(variant, block, frame, 0)) {
                const slot = order[layer.index]
                const id = slot === undefined ? undefined : (swaps[slot] ?? slot)
                const material = id === undefined ? undefined : smooth.get(id)
                if (!material || layer.rasterWidth <= 0) continue
                const left = layerLeft(layer)
                const top = layerTop(layer)
                const into = samples.get(material) ?? new Set<number>()
                samples.set(material, into)
                for (let y = 0; y < LINE_HEIGHT; y++) {
                    for (let x = 0; x < NAME_WIDTH; x++) {
                        const rx = layer.mirrorX ? layer.rasterWidth - 1 - (x - left) : x - left
                        const ry = y - top
                        if (rx < 0 || ry < 0 || rx >= layer.rasterWidth || ry >= layer.rasterHeight) continue
                        const p = (ry * layer.rasterWidth + rx) * 4
                        const alpha = Math.round((layer.rgba[p + 3] * layer.opacity) / 255)
                        if (alpha === 0) continue
                        into.add(flatten(layer.rgba[p], layer.rgba[p + 1], layer.rgba[p + 2], alpha, layer.blend === 'additive'))
                    }
                }
            }
        }
    }
    for (const [material, colors] of samples) if (colors.size > 0) result[material] = pick(colors)
    return result
}

export function withToneHints(files: Record<string, string>, binary: BundleBinary = {}): Record<string, string> {
    let hints: Record<string, string[]>
    try {
        hints = toneHints(files, binary)
    } catch (error) {
        console.error('[polyplus_nameplate] sampling tone hints failed', error)
        return files
    }
    for (const [material, hint] of Object.entries(hints)) {
        const path = `materials/${material}.json`
        try {
            const graph = JSON.parse(files[path])
            graph.toneHint = hint
            files[path] = stringifyJson(graph)
        } catch {
            continue
        }
    }
    return files
}
