const HEX_RGB = /^#?([0-9a-fA-F]{6})$/
const HEX_ARGB = /^#?([0-9a-fA-F]{8})$/
const HEX_SHORT = /^#?([0-9a-fA-F]{3})$/

export function normalizeHex(value: string): string | null {
    const text = String(value ?? '').trim()
    let match = HEX_RGB.exec(text)
    if (match) return `#${match[1].toUpperCase()}`
    match = HEX_ARGB.exec(text)
    if (match) return `#${match[1].toUpperCase()}`
    match = HEX_SHORT.exec(text)
    if (match) {
        const [r, g, b] = match[1]
        return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
    }
    return null
}

export function toArgbKey(value: string): string | null {
    const hex = normalizeHex(value)
    if (!hex) return null
    const digits = hex.slice(1)
    return digits.length === 6 ? `FF${digits}` : digits
}

export function toRgbHex(value: string): string {
    const hex = normalizeHex(value)
    if (!hex) return '#808080'
    return hex.length === 9 ? `#${hex.slice(3)}` : hex
}

export function byteHex(value: number): string {
    return value.toString(16).padStart(2, '0').toUpperCase()
}

export function rgbHex(rgb: number): string {
    return `#${(rgb & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`
}

export function splitRgb(rgb: number): [number, number, number] {
    return [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff]
}

export function hexToArgb(hex: string): number {
    const digits = hex.replace('#', '')
    const argb = digits.length === 6 ? `FF${digits}` : digits
    return Number.parseInt(argb, 16) >>> 0
}

export function lerpArgb(from: number, to: number, numerator: number, denominator: number): number {
    let result = 0
    for (let shift = 24; shift >= 0; shift -= 8) {
        const a = (from >>> shift) & 0xff
        const b = (to >>> shift) & 0xff
        result = (result | ((a + Math.floor(((b - a) * numerator) / denominator)) << shift)) >>> 0
    }
    return result >>> 0
}

const LINEAR = Array.from({ length: 256 }, (_, i) => {
    const c = i / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
})

export function luminance(rgb: number): number {
    return 0.2126 * LINEAR[(rgb >> 16) & 0xff] + 0.7152 * LINEAR[(rgb >> 8) & 0xff] + 0.0722 * LINEAR[rgb & 0xff]
}

export function pickedRgbHex(value: unknown, fallback: string): string {
    if (typeof value === 'string') return toRgbHex(value).toUpperCase()
    const color = value as { toHexString?: () => string } | null
    if (color && typeof color.toHexString === 'function') return toRgbHex(color.toHexString()).toUpperCase()
    return fallback
}

export function pixelColor(r: number, g: number, b: number, a: number): string {
    return `#${byteHex(a)}${byteHex(r)}${byteHex(g)}${byteHex(b)}`
}

export function pixelKey(r: number, g: number, b: number, a: number): string {
    return pixelColor(r, g, b, a).slice(1)
}

export function paletteHex(value: string): string {
    const hex = normalizeHex(value)
    if (!hex) return '#808080'
    return hex.length === 9 && hex.slice(1, 3) === 'FF' ? `#${hex.slice(3)}` : hex
}

export function alphaOf(value: string): number {
    const hex = normalizeHex(value)
    return hex && hex.length === 9 ? parseInt(hex.slice(1, 3), 16) : 255
}

export function isTranslucent(value: string): boolean {
    return alphaOf(value) < 255
}

export function cssColor(value: string): string {
    const hex = normalizeHex(value)
    if (!hex) return '#808080'
    return hex.length === 9 ? `#${hex.slice(3)}${hex.slice(1, 3)}` : hex
}

export function withAlpha(rgb: string, alpha: number): string {
    const base = toRgbHex(rgb)
    const a = Math.max(0, Math.min(255, Math.round(alpha)))
    return a >= 255 ? base.toUpperCase() : `#${a.toString(16).padStart(2, '0')}${base.slice(1)}`.toUpperCase()
}

export function pickerHex(value: unknown): string | null {
    if (typeof value === 'string') return normalizeHex(value) ? paletteHex(value) : null
    const color = value as { toHexString?: () => string, getAlpha?: () => number } | null
    if (!color || typeof color.toHexString !== 'function') return null
    const alpha = typeof color.getAlpha === 'function' ? Number(color.getAlpha()) : 1
    return withAlpha(color.toHexString(), (isFinite(alpha) ? alpha : 1) * 255)
}

const ALPHA_SLACK = 1

export function seeThroughDistance(r: number, g: number, b: number, a: number, cr: number, cg: number, cb: number, ca: number): number {
    if (a <= 0 || a >= 255 || ca <= 0 || ca >= 255) return -1
    const da = Math.abs(ca - a)
    if (da > ALPHA_SLACK) return -1
    const slack = Math.ceil(255 / Math.min(a, ca))
    const dr = Math.abs(cr - r)
    const dg = Math.abs(cg - g)
    const db = Math.abs(cb - b)
    if (dr > slack || dg > slack || db > slack) return -1
    return da * 1024 + dr + dg + db
}
