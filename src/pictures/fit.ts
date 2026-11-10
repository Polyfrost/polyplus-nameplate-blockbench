import { offPalettePixels, MAX_SPRITE_COLORS } from '../palette/sprites'
import { snapToPalette } from '../palette/pixels'
import { commit, readNameplate } from '../palette/state'
import { MAX_TONES, slotIdFrom } from '../palette/ids'
import { normalizeHex } from '../palette/color'
import { pictureName } from '../elements/pictures'
import { messageBox } from '../util/dialogs'
import { plural } from '../util/text'

function shortColor(argb: string): string {
    const hex = normalizeHex(argb) ?? argb
    return hex.length === 9 && hex.slice(1, 3) === 'FF' ? `#${hex.slice(3)}` : hex
}

function brightness(color: string): number {
    const hex = color.replace('#', '')
    const rgb = hex.length === 8 ? hex.slice(2) : hex
    const value = parseInt(rgb, 16)
    return ((value >> 16) & 0xff) * 0.299 + ((value >> 8) & 0xff) * 0.587 + (value & 0xff) * 0.114
}

interface OffColors {
    total: number
    colors: string[]
    matched: number
}

function offColors(texture: Texture): OffColors | null {
    const scan = offPalettePixels(texture, readNameplate().palette)
    if (!scan || scan.total === 0) return null
    const colors = Array.from(new Set(scan.pixels.map((pixel) => shortColor(pixel.color))))
    return { total: scan.total, colors: colors.sort((a, b) => brightness(a) - brightness(b)), matched: scan.matched }
}

function addColors(texture: Texture, colors: string[]): boolean {
    const name = pictureName(texture)
    return commit('Add picture colors', (plate) => {
        const groups = Math.ceil(colors.length / MAX_TONES)
        for (let group = 0; group < groups; group++) {
            const label = groups === 1 ? `${name} colors` : `${name} colors ${group + 1}`
            const id = slotIdFrom(label, (candidate) => plate.palette.slots.some((slot) => slot.id === candidate))
            plate.palette.slots.push({ id, name: label, ramp: colors.slice(group * MAX_TONES, (group + 1) * MAX_TONES) })
        }
    })
}

function ask(texture: Texture, found: OffColors, lead: string) {
    const allColors = found.colors.length + found.matched
    const tooMany = allColors > MAX_SPRITE_COLORS
    const count = plural(found.colors.length, 'color')
    const lines = [
        `'${pictureName(texture)}' has ${plural(found.total, 'pixel')} in ${count} that ${found.total === 1 ? 'is' : 'are'} not in this nameplate's colors, so it can't export yet.`,
        '',
        '- **Match to my colors** moves each of those pixels to the nearest color you have.',
        tooMany
            ? `- **Add its colors** is not offered: the picture has ${plural(allColors, 'color')} in all, and a picture can use at most ${MAX_SPRITE_COLORS}.`
            : `- **Add its colors** adds its ${count} to your colors.`,
        '- **Leave it** changes nothing. Checks lists the pixels.',
    ]
    if (lead) lines.unshift(lead, '')
    const buttons = tooMany ? ['Match to my colors', 'Leave it'] : ['Match to my colors', 'Add its colors', 'Leave it']
    messageBox(
        {
            title: 'Picture Colors',
            icon: 'palette',
            message: lines.join('\n'),
            buttons,
            width: 560,
        },
        (button) => {
            if (button === 0) snapToPalette(texture, readNameplate().palette)
            else if (!tooMany && button === 1 && addColors(texture, found.colors)) {
                Blockbench.showQuickMessage(`Added ${count} to your colors`, 2000)
            }
        },
    )
}

export function checkPictureColors(texture: Texture, lead = ''): boolean {
    try {
        const found = offColors(texture)
        if (found) ask(texture, found, lead)
        return !!found
    } catch (error) {
        console.error('[polyplus_nameplate] could not check the picture colors', error)
        return false
    }
}
