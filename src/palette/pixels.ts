import { isNameplateActive } from '../format'
import { PaletteData } from '../model'
import { addToMenu, defineAction } from '../util/actions'
import { plural } from '../util/text'
import { undoEdit } from '../util/undo'
import { pixelKey, seeThroughDistance, splitRgb, toArgbKey, toRgbHex } from './color'

export type ColorMap = Map<string, string>
type Rgb = [number, number, number]
type Recolor = (data: Uint8ClampedArray) => boolean

const SNAP_ACTION = 'polyplus_nameplate_snap_to_palette'
const SNAP_ALPHA = 128

function rgbKey(hex: string): string {
    return toRgbHex(hex).slice(1).toUpperCase()
}

function argbKey(hex: string): string {
    return toArgbKey(hex) ?? `FF${rgbKey(hex)}`
}

function keyOf(r: number, g: number, b: number): string {
    return ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()
}

function rgbOf(key: string): Rgb {
    return splitRgb(parseInt(key, 16))
}

function owners(palette: PaletteData): Map<string, { slot: string, tone: number }> {
    const result = new Map<string, { slot: string, tone: number }>()
    for (const slot of palette.slots) {
        slot.ramp.forEach((color, tone) => {
            const key = argbKey(color)
            if (!result.has(key)) result.set(key, { slot: slot.id, tone })
        })
    }
    return result
}

export function toneRemap(
    before: PaletteData,
    after: PaletteData,
    slotId: string,
    toneMap: (tone: number) => number | null,
): ColorMap {
    const map: ColorMap = new Map()
    const ramp = after.slots.find((slot) => slot.id === slotId)?.ramp
    if (!ramp?.length) return map
    for (const [key, owner] of owners(before)) {
        if (owner.slot !== slotId) continue
        const tone = toneMap(owner.tone)
        if (tone === null) continue
        const next = ramp[Math.max(0, Math.min(ramp.length - 1, tone))]
        if (next === undefined) continue
        const target = argbKey(next)
        if (target !== key) map.set(key, target)
    }
    return map
}

function nameplateTextures(): Texture[] {
    if (typeof Texture === 'undefined' || !Texture.all) return []
    return Texture.all.filter((texture) => !!texture.canvas && !!texture.ctx)
}

function pixelCanvases(texture: Texture): Array<{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }> {
    const layered = (texture as any).layers_enabled && Array.isArray((texture as any).layers)
    if (!layered) return texture.canvas && texture.ctx ? [{ canvas: texture.canvas, ctx: texture.ctx }] : []
    return ((texture as any).layers as any[])
        .filter((layer) => layer?.canvas && layer?.ctx && (layer.type === undefined || layer.type === 'pixel_layer'))
        .map((layer) => ({ canvas: layer.canvas, ctx: layer.ctx }))
}

function imageOf(target: { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }): ImageData | null {
    const { canvas, ctx } = target
    if (!(canvas.width > 0) || !(canvas.height > 0)) return null
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

function scan(texture: Texture, test: Recolor): boolean {
    for (const target of pixelCanvases(texture)) {
        const image = imageOf(target)
        if (image && test(new Uint8ClampedArray(image.data))) return true
    }
    return false
}

function apply(texture: Texture, recolor: Recolor) {
    const layered = (texture as any).layers_enabled && Array.isArray((texture as any).layers)
    if (!layered) {
        const edit = texture.edit as unknown as (callback: (canvas: HTMLCanvasElement, current: any) => void, options: object) => void
        edit.call(texture, (canvas, current) => {
            const ctx: CanvasRenderingContext2D = current?.ctx ?? canvas.getContext('2d')
            const image = imageOf({ canvas, ctx })
            if (image && recolor(image.data)) ctx.putImageData(image, 0, 0)
        }, { no_undo: true })
        return
    }
    if (!(texture as any).internal) (texture as any).convertToInternal?.()
    for (const target of pixelCanvases(texture)) {
        const image = imageOf(target)
        if (image && recolor(image.data)) target.ctx.putImageData(image, 0, 0)
    }
    ;(texture as any).updateChangesAfterEdit?.()
}

function seeThroughKeys(map: ColorMap): Array<[number, number, number, number, string]> {
    const result: Array<[number, number, number, number, string]> = []
    for (const key of map.keys()) {
        const value = parseInt(key, 16)
        const a = (value >>> 24) & 0xff
        if (a > 0 && a < 255) result.push([(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff, a, key])
    }
    return result
}

function targetOf(map: ColorMap, seeThrough: Array<[number, number, number, number, string]>, r: number, g: number, b: number, a: number): string | undefined {
    const exact = map.get(pixelKey(r, g, b, a))
    if (exact !== undefined) return exact
    let best: string | undefined
    let bestDistance = Infinity
    for (const [cr, cg, cb, ca, key] of seeThrough) {
        const distance = seeThroughDistance(r, g, b, a, cr, cg, cb, ca)
        if (distance < 0 || distance >= bestDistance) continue
        bestDistance = distance
        best = map.get(key)
    }
    return best
}

function mapper(map: ColorMap): Recolor {
    const seeThrough = seeThroughKeys(map)
    return (data) => {
        let changed = false
        for (let offset = 0; offset < data.length; offset += 4) {
            if (data[offset + 3] === 0) continue
            const target = targetOf(map, seeThrough, data[offset], data[offset + 1], data[offset + 2], data[offset + 3])
            if (target === undefined) continue
            const value = parseInt(target, 16)
            data[offset] = (value >>> 16) & 0xff
            data[offset + 1] = (value >>> 8) & 0xff
            data[offset + 2] = value & 0xff
            data[offset + 3] = (value >>> 24) & 0xff
            changed = true
        }
        return changed
    }
}

export function texturesUsing(map: ColorMap): Texture[] {
    if (map.size === 0) return []
    const test = mapper(map)
    return nameplateTextures().filter((texture) => scan(texture, test))
}

export function recolorTextures(textures: Texture[], map: ColorMap) {
    if (map.size === 0) return
    const recolor = mapper(map)
    for (const texture of textures) apply(texture, recolor)
}

function paletteRgb(palette: PaletteData): Rgb[] {
    const seen = new Set<string>()
    const result: Rgb[] = []
    for (const slot of palette.slots) {
        for (const color of slot.ramp) {
            if (!argbKey(color).startsWith('FF')) continue
            const key = rgbKey(color)
            if (seen.has(key)) continue
            seen.add(key)
            result.push(rgbOf(key))
        }
    }
    return result
}

function nearest(colors: Rgb[], r: number, g: number, b: number): Rgb {
    let best = colors[0]
    let bestDistance = Infinity
    for (const color of colors) {
        const mean = (color[0] + r) / 2
        const dr = color[0] - r
        const dg = color[1] - g
        const db = color[2] - b
        const distance = (2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db
        if (distance < bestDistance) {
            bestDistance = distance
            best = color
        }
    }
    return best
}

function snapper(palette: PaletteData): Recolor | null {
    const colors = paletteRgb(palette)
    if (!colors.length) return null
    const exact = new Set(colors.map(([r, g, b]) => keyOf(r, g, b)))
    const kept: ColorMap = new Map()
    for (const slot of palette.slots) {
        for (const color of slot.ramp) {
            const key = argbKey(color)
            if (!key.startsWith('FF') && !key.startsWith('00')) kept.set(key, key)
        }
    }
    const seeThrough = seeThroughKeys(kept)
    return (data) => {
        let changed = false
        for (let offset = 0; offset < data.length; offset += 4) {
            const alpha = data[offset + 3]
            if (alpha === 0) continue
            if (alpha < 255 && targetOf(kept, seeThrough, data[offset], data[offset + 1], data[offset + 2], alpha) !== undefined) continue
            if (alpha < SNAP_ALPHA) {
                data[offset] = 0
                data[offset + 1] = 0
                data[offset + 2] = 0
                data[offset + 3] = 0
                changed = true
                continue
            }
            const r = data[offset]
            const g = data[offset + 1]
            const b = data[offset + 2]
            if (alpha === 255 && exact.has(keyOf(r, g, b))) continue
            const [nr, ng, nb] = nearest(colors, r, g, b)
            data[offset] = nr
            data[offset + 1] = ng
            data[offset + 2] = nb
            data[offset + 3] = 255
            changed = true
        }
        return changed
    }
}

export function snapToPalette(texture: Texture | null | undefined, palette: PaletteData): number {
    if (!texture) return 0
    const recolor = snapper(palette)
    if (!recolor) return 0
    let count = 0
    const counter: Recolor = (data) => {
        const before = new Uint8ClampedArray(data)
        const changed = recolor(data)
        if (changed) {
            for (let offset = 0; offset < data.length; offset += 4) {
                if (before[offset] !== data[offset] || before[offset + 1] !== data[offset + 1] || before[offset + 2] !== data[offset + 2] || before[offset + 3] !== data[offset + 3]) count++
            }
        }
        return changed
    }
    if (!scan(texture, recolor)) {
        Blockbench.showQuickMessage('Every pixel already uses a palette color', 1500)
        return 0
    }
    undoEdit({ textures: [texture], bitmap: true }, 'Snap picture to palette', () => apply(texture, counter))
    Blockbench.showQuickMessage(`Moved ${plural(count, 'pixel')} to the nearest palette color`, 2000)
    return count
}

export function registerSnapAction(palette: () => PaletteData): () => void {
    const action = defineAction(SNAP_ACTION, {
        name: 'Snap to Palette',
        description: 'Change every off-palette pixel to the nearest palette color. Faint pixels are cleared',
        icon: 'palette',
        category: 'textures',
        condition: () => isNameplateActive() && !!Texture.selected,
        click: () => snapToPalette(Texture.selected, palette()),
    })
    const removeFromMenu = addToMenu((Texture.prototype as any).menu, action, '#settings')
    return () => {
        removeFromMenu()
        action.delete()
    }
}
