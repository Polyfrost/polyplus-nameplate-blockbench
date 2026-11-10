import { firstBodyUuid, freeLayerName, isGroupNode } from '../elements/nodes'
import { editDoc } from '../doc/store'
import { PaletteData, Slot, SPRITE_TYPE } from '../model'
import { byteHex, cssColor } from '../palette/color'
import { slotIdFrom } from '../palette/ids'
import { frameCountOf, matchPaletteColor, paletteTable } from '../palette/sprites'
import { readNameplate } from '../palette/state'
import { freeTextureName } from '../sprite'
import { parseSlotRef } from '../import/ramp'
import { sameRamp } from './palette'
import { hasProject } from '../util/project'
import { canvasOf, readTexturePixels, textureFromCanvas } from '../util/texture'
import { newItemId, SpriteItem } from './store'

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const MISSING = '#FF00FF'

export type ColorMode = 'match' | 'keep'

export interface SpriteCapture {
    item: SpriteItem | null
    offPalette: number
    error: string | null
}

export interface SpriteInsert {
    texture: Texture
    layer: any | null
    addedSlots: string[]
    shortRamps: string[]
}

function tone(ramp: string[], index: number): string {
    return ramp[Math.max(0, Math.min(ramp.length - 1, index))]
}

export function captureSprite(texture: Texture, name: string, palette: PaletteData): SpriteCapture {
    const pixels = readTexturePixels(texture)
    if (!pixels) {
        return { item: null, offPalette: 0, error: 'This picture has no pixels yet. Paint it first.' }
    }
    const { width, height: fullHeight, data } = pixels
    const frameCount = frameCountOf(texture)
    if (fullHeight % frameCount !== 0) {
        return { item: null, offPalette: 0, error: `The picture is ${fullHeight} px tall, which doesn't split into ${frameCount} frames. Fix Frames in the Inspector first.` }
    }
    const height = fullHeight / frameCount
    const table = paletteTable(palette)
    const charOf = new Map<string, string>()
    const colors: Record<string, string> = {}
    const usedSlots = new Set<string>()
    let offPalette = 0
    const frames: string[][] = []
    for (let frame = 0; frame < frameCount; frame++) {
        const rows: string[] = []
        for (let y = 0; y < height; y++) {
            let row = ''
            for (let x = 0; x < width; x++) {
                const offset = ((frame * height + y) * width + x) * 4
                const alpha = data[offset + 3]
                if (alpha === 0) {
                    row += '.'
                    continue
                }
                const rgb = `#${byteHex(data[offset])}${byteHex(data[offset + 1])}${byteHex(data[offset + 2])}`
                const match = matchPaletteColor(table, data[offset], data[offset + 1], data[offset + 2], alpha)
                let ref = match >= 0 ? table.entries[match].ref : undefined
                if (ref) usedSlots.add(parseSlotRef(ref)!.slot)
                else {
                    ref = alpha === 255 ? rgb : `${rgb}${byteHex(alpha)}`
                    offPalette++
                }
                let char = charOf.get(ref)
                if (!char) {
                    if (charOf.size >= CHARS.length) {
                        return { item: null, offPalette, error: `This picture uses more than ${CHARS.length} colors. Click the sprite under Layers, then use Picture options (three dots) > Snap to Palette first.` }
                    }
                    char = CHARS[charOf.size]
                    charOf.set(ref, char)
                    colors[char] = ref
                }
                row += char
            }
            rows.push(row)
        }
        frames.push(rows)
    }
    const slots: Slot[] = palette.slots
        .filter((slot) => usedSlots.has(slot.id))
        .map((slot) => ({ id: slot.id, name: slot.name, ramp: slot.ramp.slice() }))
    return {
        item: { id: newItemId(), kind: 'sprite', name, saved: Date.now(), width, height, frames, colors, slots },
        offPalette,
        error: null,
    }
}

export function spriteColor(item: SpriteItem, ref: string): string {
    if (ref.startsWith('#')) return ref
    const parsed = parseSlotRef(ref)
    const slot = parsed ? item.slots.find((entry) => entry.id === parsed.slot) : undefined
    return slot && parsed ? cssColor(tone(slot.ramp, parsed.tone)) : MISSING
}

export function spriteRgba(item: SpriteItem, colorOf: (ref: string) => string, frames: number = item.frames.length): Uint8ClampedArray<ArrayBuffer> {
    const { width, height } = item
    const data = new Uint8ClampedArray(width * height * frames * 4)
    const cache = new Map<string, number[]>()
    const rgba = (ref: string): number[] => {
        let value = cache.get(ref)
        if (!value) {
            const hex = colorOf(ref).replace('#', '')
            value = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) : 255]
            cache.set(ref, value)
        }
        return value
    }
    for (let frame = 0; frame < frames; frame++) {
        const rows = item.frames[frame] ?? []
        for (let y = 0; y < height; y++) {
            const row = rows[y] ?? ''
            for (let x = 0; x < width; x++) {
                const char = row[x]
                const ref = char && char !== '.' ? item.colors[char] : undefined
                if (!ref) continue
                const [r, g, b, a] = rgba(ref)
                const offset = ((frame * height + y) * width + x) * 4
                data[offset] = r
                data[offset + 1] = g
                data[offset + 2] = b
                data[offset + 3] = a
            }
        }
    }
    return data
}

export function spriteThumbnail(item: SpriteItem): string {
    try {
        const canvas = document.createElement('canvas')
        canvas.width = item.width
        canvas.height = item.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return ''
        ctx.putImageData(new ImageData(spriteRgba(item, (ref) => spriteColor(item, ref), 1), item.width, item.height), 0, 0)
        return canvas.toDataURL('image/png')
    } catch (error) {
        console.error('[polyplus_nameplate] could not draw a library thumbnail', error)
        return ''
    }
}

interface ColorPlan {
    slots: Slot[]
    colorOf: (ref: string) => string
    addedSlots: string[]
    shortRamps: string[]
}

export function planSpriteColors(item: SpriteItem, palette: PaletteData, mode: ColorMode): ColorPlan {
    const slots = palette.slots.map((slot) => ({ ...slot, ramp: slot.ramp.slice() }))
    const taken = new Set(slots.map((slot) => slot.id))
    const target = new Map<string, Slot>()
    const addedSlots: string[] = []
    const shortRamps: string[] = []
    const add = (saved: Slot): Slot => {
        const id = slotIdFrom(saved.id, (candidate) => taken.has(candidate))
        taken.add(id)
        const slot = { id, name: id === saved.id ? saved.name : `${saved.name} (library)`, ramp: saved.ramp.slice() }
        slots.push(slot)
        addedSlots.push(slot.name)
        return slot
    }
    const usedTones = new Map<string, number>()
    for (const ref of Object.values(item.colors)) {
        const parsed = parseSlotRef(ref)
        if (parsed) usedTones.set(parsed.slot, Math.max(usedTones.get(parsed.slot) ?? 0, parsed.tone))
    }
    for (const [slotId, highest] of usedTones) {
        const saved = item.slots.find((slot) => slot.id === slotId)
        const sameId = slots.find((slot) => slot.id === slotId)
        if (mode === 'match' && sameId) {
            target.set(slotId, sameId)
            if (highest >= sameId.ramp.length) shortRamps.push(sameId.name)
            continue
        }
        if (!saved) {
            if (sameId) target.set(slotId, sameId)
            continue
        }
        const reuse = (sameId && sameRamp(sameId.ramp, saved.ramp) ? sameId : undefined)
            ?? slots.find((slot) => sameRamp(slot.ramp, saved.ramp))
        target.set(slotId, reuse ?? add(saved))
    }
    const colorOf = (ref: string): string => {
        if (ref.startsWith('#')) return ref
        const parsed = parseSlotRef(ref)
        const slot = parsed ? target.get(parsed.slot) : undefined
        return slot && parsed ? cssColor(tone(slot.ramp, parsed.tone)) : MISSING
    }
    return { slots, colorOf, addedSlots, shortRamps }
}

function placeLayer(layer: any) {
    const group = typeof Group !== 'undefined' ? Group.first_selected : undefined
    if (isGroupNode(group)) {
        layer.addTo(group, 0)
        ;(group as any).isOpen = true
        return
    }
    layer.addTo('root', 0)
}

function createTexture(item: SpriteItem, name: string, rgba: Uint8ClampedArray<ArrayBuffer>): Texture {
    const frames = item.frames.length
    const fullHeight = item.height * frames
    const canvas = canvasOf(item.width, fullHeight, (context) => context.putImageData(new ImageData(rgba, item.width, fullHeight), 0, 0))
    return textureFromCanvas(canvas, { name, frames })
}

export function insertSprite(item: SpriteItem, name: string, mode: ColorMode, withLayer: boolean): SpriteInsert | null {
    if (!hasProject()) return null
    const plate = readNameplate()
    const plan = planSpriteColors(item, plate.palette, mode)
    const spriteType = (OutlinerElement.types as any)[SPRITE_TYPE]
    const textureName = freeTextureName(name || item.name)
    const elements: any[] = []
    const textures: Texture[] = []
    const { texture, layer } = editDoc(['nameplate'], { label: 'Insert sprite from library', aspects: { elements, outliner: true, textures, bitmap: true, selection: true } }, ({ nameplate }) => {
        nameplate.palette.slots = plan.slots
        const texture = createTexture(item, textureName, spriteRgba(item, plan.colorOf))
        textures.push(texture)
        let layer: any = null
        if (withLayer && spriteType) {
            layer = new spriteType({
                name: freeLayerName(textureName),
                depth: 'over_background',
                texture: texture.uuid,
                of: firstBodyUuid(),
                anchor: 'top_left',
                pivot: 'bottom_right',
            })
            placeLayer(layer)
            layer.init()
            layer.select()
            elements.push(layer)
        }
        texture.select()
        return { texture, layer }
    })!
    return { texture, layer, addedSlots: plan.addedSlots, shortRamps: plan.shortRamps }
}
