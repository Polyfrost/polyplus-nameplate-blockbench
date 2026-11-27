import { setBrush } from '../brush'
import { byteHex, normalizeHex, toArgbKey, toRgbHex } from '../palette/color'
import { MAX_TONES, sanitizeId, uniqueId } from '../palette/ids'
import { cloneJson } from '../util/json'
import { hasProject } from '../util/project'
import { undoEdit } from '../util/undo'
import { CosmeticPalette } from './data'
import { blended, FIXED_INDEX, indexPixels, MAX_INDEXED_SLOTS, moveIndex, recolorIndexed, slotTones, toneLimit } from './indexed'
import { INDEX_PROPERTY, isPaletteTexture, keepIndex, PALETTE_PROPERTY, readIndexMap, storedIndexPixels, writeIndexMap } from './project'
import { keptIds, projectTargets, resolveReferences, setTargetIds, stampReferences, targetIds } from './references'
import { COSMETIC_PROPERTY, cosmeticState, readCosmetic } from './state'

const DIALOG_ID = 'polyplus_cosmetic_colors'
export const MIN_SHADE_ALPHA = 3

export function toneRemap(before: CosmeticPalette, after: CosmeticPalette): Map<string, string> {
    const map = new Map<string, string>()
    for (const slot of before.slots) {
        const next = after.slots.find((candidate) => candidate.id === slot.id)
        if (!next) continue
        const target = slotTones(next)
        slotTones(slot).forEach((tone, i) => {
            const from = toArgbKey(tone)
            const to = target[i] === undefined ? null : toArgbKey(target[i])
            if (from && to && from !== to) map.set(from, to)
        })
    }
    return map
}

function keyAt(data: ArrayLike<number>, at: number): string {
    return `${byteHex(data[at + 3])}${byteHex(data[at])}${byteHex(data[at + 1])}${byteHex(data[at + 2])}`
}

function remapAt(data: Uint8ClampedArray, at: number, map: ReadonlyMap<string, string>, fixed?: ReadonlySet<string>): boolean {
    const key = keyAt(data, at)
    if (fixed?.has(key)) return false
    const target = map.get(key)
    if (!target) return false
    data[at + 3] = parseInt(target.slice(0, 2), 16)
    data[at] = parseInt(target.slice(2, 4), 16)
    data[at + 1] = parseInt(target.slice(4, 6), 16)
    data[at + 2] = parseInt(target.slice(6, 8), 16)
    return true
}

export function remapPixels(data: Uint8ClampedArray, map: Map<string, string>): boolean {
    let changed = false
    for (let at = 0; at < data.length; at += 4) {
        if (data[at + 3] !== 0 && remapAt(data, at, map)) changed = true
    }
    return changed
}

export interface ShownPixels {
    width: number
    height: number
    before: ArrayLike<number>
    after: ArrayLike<number>
    index?: ArrayLike<number>
    fixed?: ReadonlySet<string>
    covered?: ArrayLike<number>
}

function shownFixed(shown: ShownPixels, q: number): boolean {
    if (!shown.index || !shown.fixed || shown.index[q / 4] !== FIXED_INDEX) return false
    return shown.fixed.has(keyAt(shown.before, q))
}

export function recolorLayer(pixels: Uint8ClampedArray, width: number, offset: unknown, shown: ShownPixels, map: ReadonlyMap<string, string>): boolean {
    const ox = Math.round(Number((offset as number[] | undefined)?.[0]) || 0)
    const oy = Math.round(Number((offset as number[] | undefined)?.[1]) || 0)
    let changed = false
    for (let at = 0; at < pixels.length; at += 4) {
        if (pixels[at + 3] === 0) continue
        const x = ((at / 4) % width) + ox
        const y = Math.floor(at / 4 / width) + oy
        const q = (y * shown.width + x) * 4
        const inside = x >= 0 && y >= 0 && x < shown.width && y < shown.height
        if (!inside || shown.covered?.[q / 4]) {
            if (remapAt(pixels, at, map, shown.fixed)) changed = true
            continue
        }
        if ([0, 1, 2, 3].every((k) => pixels[at + k] === shown.before[q + k])) {
            for (let k = 0; k < 4; k++) {
                if (pixels[at + k] === shown.after[q + k]) continue
                pixels[at + k] = shown.after[q + k]
                changed = true
            }
            continue
        }
        if (shownFixed(shown, q)) continue
        if (remapAt(pixels, at, map)) changed = true
    }
    return changed
}

function pixelLayers(texture: Texture): any[] {
    const layers: any[] = (texture as any).layers_enabled ? (texture as any).layers ?? [] : []
    return layers.filter((layer) => layer && (layer.type ?? 'pixel_layer') === 'pixel_layer')
}

export function recolorTexture(texture: Texture, before: CosmeticPalette, after: CosmeticPalette, map: Map<string, string>) {
    const own = texture as any
    const canvas: HTMLCanvasElement | undefined = own.canvas
    const ctx: CanvasRenderingContext2D | undefined = own.ctx
    const width = canvas?.width ?? 0
    const height = canvas?.height ?? 0
    const stored = readIndexMap(own[INDEX_PROPERTY], width, height)
    if (!stored) return recolor(texture, map)
    if (!canvas || !ctx) {
        own[INDEX_PROPERTY] = writeIndexMap(width, height, moveIndex(stored, before, after))
        return recolor(texture, map)
    }
    const image = ctx.getImageData(0, 0, width, height)
    const current = indexPixels(width, height, image.data, before, stored, storedIndexPixels(texture, width, height)).index
    const layers = pixelLayers(texture)
    if (layers.length) return recolorLayers(texture, layers, image.data, current, before, after, map)
    const result = recolorIndexed(image.data, current, before, after, map)
    keepIndex(texture, width, height, result.index, image.data)
    if (!result.changed) return
    ctx.putImageData(image, 0, 0)
    own.updateChangesAfterEdit?.()
}

function covers(layer: any): boolean {
    return layer.visible !== false && Number(layer.opacity ?? 100) >= 100 && (layer.blend_mode ?? 'default') === 'default'
}

function cover(covered: Uint8Array, pixels: Uint8ClampedArray, width: number, offset: unknown, shownWidth: number, shownHeight: number) {
    const ox = Math.round(Number((offset as number[] | undefined)?.[0]) || 0)
    const oy = Math.round(Number((offset as number[] | undefined)?.[1]) || 0)
    for (let at = 0; at < pixels.length; at += 4) {
        if (pixels[at + 3] !== 255) continue
        const x = ((at / 4) % width) + ox
        const y = Math.floor(at / 4 / width) + oy
        if (x >= 0 && y >= 0 && x < shownWidth && y < shownHeight) covered[y * shownWidth + x] = 1
    }
}

function recolorLayers(texture: Texture, layers: any[], shown: Uint8ClampedArray, index: Uint8Array, before: CosmeticPalette, after: CosmeticPalette, map: Map<string, string>) {
    const own = texture as any
    const width = own.canvas.width
    const height = own.canvas.height
    const recolored = new Uint8ClampedArray(shown)
    const result = recolorIndexed(recolored, index, before, after, map)
    const fixed = new Set(before.fixed.map((color) => toArgbKey(color)).filter((key): key is string => !!key))
    const covered = new Uint8Array(width * height)
    let changed = false
    for (const layer of layers.slice().reverse()) {
        const canvas: HTMLCanvasElement | undefined = layer.canvas
        const ctx: CanvasRenderingContext2D | undefined = layer.ctx
        if (!canvas || !ctx || !canvas.width || !canvas.height) continue
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const view: ShownPixels = { width, height, before: shown, after: recolored, index, fixed, covered: covered.slice() }
        if (covers(layer)) cover(covered, image.data, canvas.width, layer.offset, width, height)
        if (!recolorLayer(image.data, canvas.width, layer.offset, view, map)) continue
        ctx.putImageData(image, 0, 0)
        changed = true
    }
    keepIndex(texture, width, height, result.index, recolored)
    if (changed) own.updateChangesAfterEdit?.()
}

function recolor(texture: Texture, map: Map<string, string>) {
    if (map.size === 0) return
    const layered = pixelLayers(texture)
    const targets: Array<{ canvas?: HTMLCanvasElement, ctx?: CanvasRenderingContext2D }> = layered.length ? layered : [texture]
    let changed = false
    for (const { canvas, ctx } of targets) {
        if (!canvas || !ctx || !canvas.width || !canvas.height) continue
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
        if (!remapPixels(image.data, map)) continue
        ctx.putImageData(image, 0, 0)
        changed = true
    }
    if (changed) (texture as any).updateChangesAfterEdit?.()
}

export function alphaOf(tone: string): number {
    const hex = normalizeHex(tone)
    return hex && hex.length === 9 ? parseInt(hex.slice(1, 3), 16) : 255
}

export function rgbOf(tone: string): string {
    return toRgbHex(tone)
}

export function withRgb(tone: string, rgb: string): string {
    const color = toRgbHex(rgb)
    const hex = normalizeHex(tone)
    return hex && hex.length === 9 ? `#${hex.slice(1, 3)}${color.slice(1)}` : color
}

export function withAlpha(tone: string, alpha: number): string {
    const value = Math.max(0, Math.min(255, Math.round(Number(alpha) || 0)))
    if (value === 255 && normalizeHex(tone)?.length !== 9) return toRgbHex(tone)
    return `#${byteHex(value)}${toRgbHex(tone).slice(1)}`
}

export interface SlotRow {
    key: number
    from: string | null
    id: string
    name: string
    ramp: string[]
    customizable: boolean
    interpolate?: number
}

export function setBrushColor(color: string) {
    setBrush(color)
}

export function openColors(): Dialog | null {
    if (!hasProject()) return null
    const data = readCosmetic()
    let next = 0
    const textures = Texture.all.map((texture) => ({ uuid: texture.uuid, name: texture.name, on: isPaletteTexture(texture) }))
    const state = {
        slots: data.palette.slots.map((slot): SlotRow => ({ key: next++, from: slot.id, id: slot.id, name: slot.name, ramp: slot.ramp.slice(), customizable: slot.customizable, ...(slot.interpolate !== undefined ? { interpolate: slot.interpolate } : {}) })),
        colorways: Object.entries(data.palette.colorways).map(([name, overrides]) => ({ key: next++, from: name as string | null, name, overrides: cloneJson(overrides) })),
        fixed: data.palette.fixed.slice(),
        textures,
        maxSlots: MAX_INDEXED_SLOTS,
        maxTones: MAX_TONES,
    }
    const dialog: any = new Dialog({
        id: DIALOG_ID,
        title: 'Colors',
        width: 680,
        component: {
            data: () => state,
            methods: {
                addSlot() {
                    if (state.slots.length >= MAX_INDEXED_SLOTS) return
                    const id = uniqueId('color', (candidate) => state.slots.some((slot) => slot.id === candidate || slot.from === candidate) || data.palette.slots.some((slot) => slot.id === candidate))
                    state.slots.push({ key: next++, from: null, id, name: 'Color', ramp: ['#404040', '#808080', '#C0C0C0'], customizable: false })
                },
                addTone(slot: SlotRow, index: number) {
                    if (!roomForTone(state, index)) {
                        Blockbench.showQuickMessage(`This color can have up to ${toneCap(slot, index)} ${slot.interpolate === undefined ? 'shades' : 'stops'}`, 2500)
                        return
                    }
                    slot.ramp.push(slot.ramp[slot.ramp.length - 1] ?? '#808080')
                },
                removeTone(slot: SlotRow, tone: number) {
                    if (slot.ramp.length > 1) slot.ramp.splice(tone, 1)
                },
                removeSlot(index: number) {
                    state.slots.splice(index, 1)
                },
                addColorway() {
                    const name = uniqueId('colorway', (candidate) => state.colorways.some((item) => item.name === candidate))
                    state.colorways.push({ key: next++, from: null, name, overrides: {} })
                },
                removeColorway(index: number) {
                    state.colorways.splice(index, 1)
                },
                overridden(colorway: { overrides: Record<string, string[]> }, slot: SlotRow): boolean {
                    return Array.isArray(colorway.overrides[slot.from ?? slot.id])
                },
                toggleOverride(colorway: { overrides: Record<string, string[]> }, slot: SlotRow) {
                    const id = slot.from ?? slot.id
                    if (colorway.overrides[id]) (this as any).$delete(colorway.overrides, id)
                    else (this as any).$set(colorway.overrides, id, slot.ramp.slice())
                },
                addFixed() {
                    state.fixed.push('#000000')
                },
                paint(color: string) {
                    setBrushColor(color)
                },
                blendedTones(slot: SlotRow): string[] {
                    return blended(slot) ? slotTones(slot) : []
                },
                rgb(tone: string): string {
                    return rgbOf(tone)
                },
                opacity(tone: string): number {
                    return Math.round(alphaOf(tone) / 2.55)
                },
                setRgb(list: string[], index: number, event: Event) {
                    ;(this as any).$set(list, index, withRgb(list[index], (event.target as HTMLInputElement).value))
                },
                setOpacity(list: string[], index: number, event: Event, min = 0) {
                    const percent = Math.max(min, Math.min(100, Number((event.target as HTMLInputElement).value) || 0))
                    ;(this as any).$set(list, index, withAlpha(list[index], percent * 2.55))
                },
            },
            template: `
                <div class="pp-colors">
                    <h3>Colors</h3>
                    <div v-for="(slot, index) in slots" :key="slot.key" style="padding: 4px 0; border-bottom: 1px solid var(--color-border);">
                        <div class="dialog_bar form_bar" style="display: flex; align-items: center; gap: 6px;">
                            <input type="text" class="dark_bordered" style="flex: 1; min-width: 0;" v-model="slot.name">
                            <label style="flex: none;"><input type="checkbox" v-model="slot.customizable"> Players can change it</label>
                            <i class="material-icons notranslate icon" title="Remove" @click="removeSlot(index)">delete</i>
                        </div>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
                            <span v-for="(tone, t) in slot.ramp" :key="t" style="display: inline-flex; align-items: center;">
                                <input type="color" :value="rgb(tone)" @input="setRgb(slot.ramp, t, $event)" @dblclick="paint(tone)" :title="'Shade ' + (t + 1)">
                                <input type="number" class="dark_bordered" style="width: 44px;" min="1" max="100" :value="opacity(tone)" @change="setOpacity(slot.ramp, t, $event, 1)" title="Opacity (%)">
                                <i v-if="slot.ramp.length > 1" class="material-icons notranslate icon" style="font-size: 14px;" title="Remove shade" @click="removeTone(slot, t)">close</i>
                            </span>
                            <i v-if="slot.ramp.length < maxTones" class="material-icons notranslate icon" title="Add a shade" @click="addTone(slot, index)">add</i>
                        </div>
                        <div v-if="blendedTones(slot).length" style="display: flex; flex-wrap: wrap; gap: 2px; align-items: center;">
                            <span style="margin-right: 4px;">Blends into {{ blendedTones(slot).length }} shades</span>
                            <span v-for="(tone, t) in blendedTones(slot)" :key="t" :title="'Shade ' + (t + 1)" :style="{ display: 'inline-block', width: '16px', height: '16px', background: rgb(tone), cursor: 'pointer' }" @dblclick="paint(tone)"></span>
                        </div>
                    </div>
                    <button type="button" v-if="slots.length < maxSlots" @click="addSlot()"><i class="material-icons notranslate icon">add</i> Add a color</button>
                    <h3 style="margin-top: 12px;">Colorways</h3>
                    <div v-for="(colorway, index) in colorways" :key="colorway.key" style="padding: 4px 0; border-bottom: 1px solid var(--color-border);">
                        <div class="dialog_bar form_bar" style="display: flex; align-items: center; gap: 6px;">
                            <input type="text" class="dark_bordered" style="flex: 1; min-width: 0;" v-model="colorway.name">
                            <i class="material-icons notranslate icon" title="Remove" @click="removeColorway(index)">delete</i>
                        </div>
                        <div v-for="slot in slots" :key="slot.key" style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
                            <label style="flex: none; min-width: 120px;"><input type="checkbox" :checked="overridden(colorway, slot)" @change="toggleOverride(colorway, slot)"> {{ slot.name }}</label>
                            <template v-if="overridden(colorway, slot)">
                                <span v-for="(tone, t) in colorway.overrides[slot.from || slot.id]" :key="t" style="display: inline-flex; align-items: center;">
                                    <input type="color" :value="rgb(tone)" @input="setRgb(colorway.overrides[slot.from || slot.id], t, $event)">
                                    <input type="number" class="dark_bordered" style="width: 44px;" min="0" max="100" :value="opacity(tone)" @change="setOpacity(colorway.overrides[slot.from || slot.id], t, $event)" title="Opacity (%)">
                                </span>
                            </template>
                        </div>
                    </div>
                    <button type="button" @click="addColorway()"><i class="material-icons notranslate icon">add</i> Add a colorway</button>
                    <h3 style="margin-top: 12px;">Fixed colors</h3>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
                        <span v-for="(color, i) in fixed" :key="i"><input type="color" :value="rgb(color)" @input="setRgb(fixed, i, $event)"><input type="number" class="dark_bordered" style="width: 44px;" min="0" max="100" :value="opacity(color)" @change="setOpacity(fixed, i, $event)" title="Opacity (%)"><i class="material-icons notranslate icon" style="font-size: 14px;" @click="fixed.splice(i, 1)">close</i></span>
                        <i class="material-icons notranslate icon" title="Add a fixed color" @click="addFixed()">add</i>
                    </div>
                    <h3 style="margin-top: 12px;">Painted with the palette</h3>
                    <label v-for="texture in textures" :key="texture.uuid" style="display: block;"><input type="checkbox" v-model="texture.on"> {{ texture.name }}</label>
                </div>
            `,
        },
        onConfirm() {
            save(state)
        },
    } as any)
    dialog.show()
    return dialog
}

interface ColorRows {
    slots: SlotRow[]
    colorways: Array<{ from: string | null, name: string, overrides: Record<string, string[]> }>
    fixed: string[]
}

function toneCap(slot: SlotRow, index: number): number {
    return slot.interpolate === undefined ? toneLimit(index) : Math.min(slot.interpolate, toneLimit(index))
}

export function roomForTone(state: ColorRows, index: number): boolean {
    const slot = state.slots[index]
    if (!slot) return false
    const id = slot.from ?? slot.id
    const count = Math.max(slot.ramp.length, ...state.colorways.map((colorway) => colorway.overrides[id]?.length ?? 0))
    return count < toneCap(slot, index)
}

function tones(list: string[]): string[] {
    return list.map((tone) => normalizeHex(tone)).filter((tone): tone is string => !!tone)
}

function shades(list: string[]): string[] {
    return tones(list).map((tone) => alphaOf(tone) < MIN_SHADE_ALPHA ? withAlpha(tone, MIN_SHADE_ALPHA) : tone)
}

export function paletteFromRows(state: ColorRows): { palette: CosmeticPalette, renamed: Map<string, string> } {
    const taken = new Set<string>()
    const renames = new Map<string, string>()
    const slots = state.slots.map((row) => {
        const id = uniqueId(sanitizeId(row.from ?? row.name) || 'color', (candidate) => taken.has(candidate))
        taken.add(id)
        renames.set(row.from ?? row.id, id)
        return { id, name: row.name.trim() || id, ramp: shades(row.ramp), customizable: row.customizable, ...(row.interpolate !== undefined ? { interpolate: row.interpolate } : {}) }
    })
    const colorways: CosmeticPalette['colorways'] = {}
    const renamed = new Map<string, string>()
    for (const row of state.colorways) {
        const name = uniqueId(sanitizeId(row.name) || 'colorway', (candidate) => candidate in colorways)
        if (row.from) renamed.set(row.from, name)
        colorways[name] = {}
        for (const [slot, ramp] of Object.entries(row.overrides)) {
            const id = renames.get(slot)
            if (id) colorways[name][id] = tones(ramp)
        }
    }
    return { palette: { slots, colorways, fixed: tones(state.fixed) }, renamed }
}

function save(state: ColorRows & { textures: Array<{ uuid: string, on: boolean }> }) {
    const before = readCosmetic().palette
    const { palette: after, renamed } = paletteFromRows(state)
    const map = toneRemap(before, after)
    const flags = new Map(state.textures.map((row) => [row.uuid, row.on]))
    const touched = Texture.all.filter((texture) => flags.get(texture.uuid) || isPaletteTexture(texture))
    undoEdit({ [COSMETIC_PROPERTY]: true, textures: touched, layers: touched.flatMap(pixelLayers), bitmap: true }, 'Edit colors', () => {
        const data = readCosmetic()
        const targets = projectTargets()
        stampReferences(data, targets)
        const ids = keptIds(targetIds(data).colorways, renamed)
        data.palette = after
        setTargetIds(data, 'colorways', ids)
        resolveReferences(data, targets)
        cosmeticState.write(data)
        for (const texture of Texture.all) {
            const on = flags.get(texture.uuid) === true
            ;(texture as any)[PALETTE_PROPERTY] = on
            if (on) recolorTexture(texture, before, after, map)
        }
    })
    cosmeticState.notify()
}
