import { NameplateData } from '../model'
import { alphaOf, cssColor, isTranslucent, toRgbHex } from './color'
import { mainColorway } from './colorway'
import { colorRef } from './sprites'
import { createListenerSet } from '../util/events'
import { readNameplate } from './state'

export interface ToneChoice {
    name: string
    icon: string
    color?: string
}

const SWATCH_ICON = 'stop'
const MISSING_ICON = 'warning'

let shownColorway = ''

const shownListeners = createListenerSet(null)

export function setShownColorway(name: string) {
    if (name === shownColorway) return
    shownColorway = name
    shownListeners.notify()
}

export function onShownColorway(listener: () => void): () => void {
    return shownListeners.on(listener)
}

function shownOverrides(plate: NameplateData): Record<string, string[]> {
    return shownColorway && shownColorway !== mainColorway(plate.palette) ? plate.palette.colorways[shownColorway] ?? {} : {}
}

function toneText(tone: string): string {
    const hex = toRgbHex(tone)
    return isTranslucent(tone) ? `${hex}, ${Math.round((alphaOf(tone) / 255) * 100)}% opaque` : hex
}

function missing(ref: string): ToneChoice {
    return { name: `${ref} (missing)`, icon: MISSING_ICON }
}

export function toneChoices(current: string[] = []): Record<string, ToneChoice> {
    const result: Record<string, ToneChoice> = {}
    const plate = readNameplate()
    const overrides = shownOverrides(plate)
    for (const slot of plate.palette.slots) {
        const ramp = overrides[slot.id]
        slot.ramp.forEach((main, index) => {
            const tone = ramp?.[index] ?? main
            result[colorRef(slot.id, index)] = { name: `${slot.name}, shade ${index + 1} (${toneText(tone)})`, icon: SWATCH_ICON, color: cssColor(tone) }
        })
    }
    for (const ref of current) {
        if (ref && !(ref in result)) result[ref] = missing(ref)
    }
    return result
}

export function slotChoices(current: string[] = []): Record<string, ToneChoice> {
    const result: Record<string, ToneChoice> = {}
    const plate = readNameplate()
    const overrides = shownOverrides(plate)
    for (const slot of plate.palette.slots) {
        const ramp = overrides[slot.id] ?? slot.ramp
        const middle = ramp[ramp.length >> 1] ?? ramp[0]
        result[slot.id] = middle ? { name: slot.name, icon: SWATCH_ICON, color: cssColor(middle) } : { name: slot.name, icon: SWATCH_ICON }
    }
    for (const ref of current) {
        if (ref && !(ref in result)) result[ref] = missing(ref)
    }
    return result
}
