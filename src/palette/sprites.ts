import { LayerData, PaletteData, PixelIssue, SpriteFrames } from '../model'
import { pixelColor, pixelKey, seeThroughDistance, toArgbKey } from './color'
import { textureSpriteId } from './ids'
import { layerTextureUuids } from '../motion/compile'
import { findTexture, FRAMES_PROPERTY, readTexturePixels } from '../util/texture'

export const MAX_SPRITE_COLORS = 32
const MAX_ISSUES_PER_TEXTURE = 200
const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const TRANSPARENT = -1
const REJECTED = -2

interface ColorEntry {
    key: string
    ref: string
}

interface SeeThrough {
    entry: number
    r: number
    g: number
    b: number
    a: number
}

interface PaletteTable {
    entries: ColorEntry[]
    lookup: Map<string, number>
    seeThrough: SeeThrough[]
}

export function colorRef(slot: string, tone: number): string {
    return tone === 0 ? slot : `${slot}[${tone}]`
}

export function paletteTable(palette: PaletteData): PaletteTable {
    const entries: ColorEntry[] = []
    const lookup = new Map<string, number>()
    const seeThrough: SeeThrough[] = []
    for (const slot of palette.slots) {
        slot.ramp.forEach((color, tone) => {
            const key = toArgbKey(color)
            if (key === null || lookup.has(key)) return
            const value = parseInt(key, 16)
            const a = (value >>> 24) & 0xff
            if (a > 0 && a < 255) seeThrough.push({ entry: entries.length, r: (value >>> 16) & 0xff, g: (value >>> 8) & 0xff, b: value & 0xff, a })
            lookup.set(key, entries.length)
            entries.push({ key, ref: colorRef(slot.id, tone) })
        })
    }
    return { entries, lookup, seeThrough }
}

export function matchPaletteColor(table: PaletteTable, r: number, g: number, b: number, a: number): number {
    const exact = table.lookup.get(pixelKey(r, g, b, a))
    if (exact !== undefined) return exact
    let best = -1
    let bestDistance = Infinity
    for (const color of table.seeThrough) {
        const distance = seeThroughDistance(r, g, b, a, color.r, color.g, color.b, color.a)
        if (distance < 0 || distance >= bestDistance) continue
        bestDistance = distance
        best = color.entry
    }
    return best
}

export function frameCountOf(texture: Texture): number {
    const raw = Math.floor(Number((texture as any)[FRAMES_PROPERTY]))
    return isFinite(raw) && raw >= 1 ? raw : 1
}

function readPixels(texture: Texture): { width: number, height: number, data: ArrayLike<number> } | null {
    if (!texture.canvas || !texture.ctx) return null
    return readTexturePixels(texture) ?? { width: 0, height: 0, data: [] }
}

function entryAt(data: ArrayLike<number>, offset: number, table: PaletteTable): number {
    const alpha = data[offset + 3]
    if (alpha === 0) return TRANSPARENT
    const entry = matchPaletteColor(table, data[offset], data[offset + 1], data[offset + 2], alpha)
    return entry >= 0 ? entry : REJECTED
}

interface OffPalettePixel {
    frame: number
    x: number
    y: number
    color: string
}

export interface OffPaletteScan {
    width: number
    frameHeight: number
    frames: number
    pixels: OffPalettePixel[]
    total: number
    matched: number
    painted: Uint8Array
}

export function paletteTextureUuids(layers: LayerData[]): Set<string> {
    const result = new Set<string>()
    for (const layer of layers) for (const uuid of layerTextureUuids(layer)) result.add(uuid)
    return result
}

export function offPalettePixels(texture: Texture, palette: PaletteData, limit = Infinity): OffPaletteScan | null {
    const pixels = readPixels(texture)
    if (!pixels || pixels.width === 0 || pixels.height === 0) return null
    const { width, height, data } = pixels
    const frames = frameCountOf(texture)
    const frameHeight = height % frames === 0 ? height / frames : height
    const table = paletteTable(palette)
    const found: OffPalettePixel[] = []
    const painted = new Uint8Array(width * height)
    const matched = new Set<number>()
    let total = 0
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4
            const entry = entryAt(data, offset, table)
            if (entry >= 0) {
                painted[y * width + x] = 1
                matched.add(entry)
            }
            if (entry !== REJECTED) continue
            total++
            if (found.length >= limit) continue
            found.push({ frame: Math.floor(y / frameHeight), x, y: y % frameHeight, color: pixelColor(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]) })
        }
    }
    return { width, frameHeight, frames: height / frameHeight, pixels: found, total, matched: matched.size, painted }
}

function readTexture(
    texture: Texture,
    id: string,
    table: PaletteTable,
    issues: PixelIssue[],
): SpriteFrames | null {
    const entries = table.entries
    const note = (message: string) => {
        issues.push({ texture: texture.uuid, frame: 0, x: -1, y: -1, color: message })
    }

    const pixels = readPixels(texture)
    if (!pixels) {
        note('texture pixels are not available')
        return null
    }
    const { width, height, data } = pixels
    if (width === 0 || height === 0) {
        note('texture is empty')
        return null
    }
    const frameCount = frameCountOf(texture)
    if (height % frameCount !== 0) {
        note(`height ${height} doesn't divide into ${frameCount} frames`)
        return null
    }
    const frameHeight = height / frameCount

    const codes = new Int32Array(width * height)
    const used = new Uint8Array(entries.length)
    let reported = 0
    let skipped = 0
    const report = (x: number, y: number, color: string) => {
        if (reported >= MAX_ISSUES_PER_TEXTURE) {
            skipped++
            return
        }
        reported++
        issues.push({ texture: texture.uuid, frame: Math.floor(y / frameHeight), x, y: y % frameHeight, color })
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const at = y * width + x
            const offset = at * 4
            const entry = entryAt(data, offset, table)
            codes[at] = entry
            if (entry === TRANSPARENT) continue
            if (entry === REJECTED) {
                report(x, y, pixelColor(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]))
                continue
            }
            used[entry] = 1
        }
    }
    if (skipped > 0) note(`${skipped} more off-palette pixels`)

    const colors: Record<string, string> = {}
    const charOf = new Int32Array(entries.length).fill(-1)
    let assigned = 0
    let distinct = 0
    for (let entry = 0; entry < entries.length; entry++) {
        if (!used[entry]) continue
        distinct++
        if (assigned >= MAX_SPRITE_COLORS) continue
        charOf[entry] = assigned
        colors[CHARS[assigned]] = entries[entry].ref
        assigned++
    }
    if (distinct > MAX_SPRITE_COLORS) note(`uses ${distinct} palette colors, the limit is ${MAX_SPRITE_COLORS}`)

    const frames: string[][] = []
    for (let frame = 0; frame < frameCount; frame++) {
        const rows: string[] = []
        for (let row = 0; row < frameHeight; row++) {
            const base = (frame * frameHeight + row) * width
            let text = ''
            for (let x = 0; x < width; x++) {
                const code = codes[base + x]
                const char = code >= 0 ? charOf[code] : -1
                text += char >= 0 ? CHARS[char] : '.'
            }
            rows.push(text)
        }
        frames.push(rows)
    }
    return { id, colors, frames }
}

export function readSprites(
    layers: LayerData[],
    palette: PaletteData,
): { sprites: Record<string, SpriteFrames>, pixelIssues: PixelIssue[] } {
    const sprites: Record<string, SpriteFrames> = {}
    const pixelIssues: PixelIssue[] = []
    const table = paletteTable(palette)
    const takenIds = new Set<string>()
    const seen = new Set<string>()

    for (const layer of layers) {
        for (const uuid of layerTextureUuids(layer)) {
            if (seen.has(uuid)) continue
            seen.add(uuid)

            const texture = findTexture(uuid)
            if (!texture) {
                pixelIssues.push({ texture: uuid, frame: 0, x: -1, y: -1, color: 'texture not found' })
                continue
            }
            const id = textureSpriteId(texture.name, takenIds)
            const frames = readTexture(texture, id, table, pixelIssues)
            if (frames) sprites[uuid] = frames
        }
    }
    return { sprites, pixelIssues }
}
