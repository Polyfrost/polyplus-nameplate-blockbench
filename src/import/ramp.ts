import { byteHex, lerpArgb, rgbHex } from '../palette/color'

const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const SLOT_REF = /^([a-z0-9_]{1,64})(?:\[(\d{1,2})\])?$/

interface SlotRef {
    slot: string
    tone: number
}

export function parseHex(text: unknown): number | null {
    if (typeof text !== 'string') return null
    const match = HEX.exec(text)
    if (!match) return null
    const digits = match[1]
    const value = parseInt(digits, 16)
    return digits.length === 6 ? (value | 0xff000000) >>> 0 : value >>> 0
}

export function formatHex(argb: number): string {
    const value = argb >>> 0
    const alpha = value >>> 24
    const rgb = rgbHex(value)
    return alpha === 0xff ? rgb : `#${byteHex(alpha)}${rgb.slice(1)}`
}

export function parseSlotRef(text: unknown): SlotRef | null {
    if (typeof text !== 'string') return null
    const match = SLOT_REF.exec(text)
    if (!match) return null
    return { slot: match[1], tone: match[2] ? Number(match[2]) : 0 }
}

function along(stops: number[], position: number, positions: number): number {
    if (stops.length === 1 || positions <= 1) return stops[0]
    const segments = stops.length - 1
    const scaled = position * segments
    const segment = Math.min(Math.floor(scaled / (positions - 1)), segments - 1)
    return lerpArgb(stops[segment], stops[segment + 1], scaled - segment * (positions - 1), positions - 1)
}

export function expandRamp(stops: string[], tones: number): string[] {
    const values = stops.map(parseHex)
    if (values.some((value) => value === null)) return stops.slice()
    const parsed = values as number[]
    if (parsed.length < 2 || tones <= parsed.length) return stops.slice()
    const result: string[] = []
    for (let index = 0; index < tones; index++) result.push(formatHex(along(parsed, index, tones)))
    return result
}
