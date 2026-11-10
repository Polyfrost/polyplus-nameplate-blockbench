import type { PaletteData } from '../model'
import { sanitizeId, uniqueId } from './ids'
import { readNameplate } from './state'

let solo = ''

export function mainColorway(palette: PaletteData): string {
    const first = Object.keys(palette.colorways)[0] ?? ''
    return Object.keys(palette.colorways[first] ?? {}).length ? '' : first
}

export function startColorwayPreview(name: string) {
    solo = name
}

export function endColorwayPreview() {
    solo = ''
}

export function previewColorway(): string | null {
    if (!solo) return null
    const plate = readNameplate()
    if (!(solo in plate.palette.colorways) || Object.values(plate.variants).some((variant) => variant.palette === solo)) {
        solo = ''
        return null
    }
    return solo
}

export function withColorwayPreview(files: Record<string, string>, colorway: string): { files: Record<string, string>, variant: string } | null {
    try {
        const manifest = JSON.parse(files['manifest.json'] ?? '')
        if (!manifest || typeof manifest !== 'object') return null
        const variants: Record<string, Record<string, unknown>> = manifest.variants && typeof manifest.variants === 'object' ? manifest.variants : {}
        const base = Object.values(variants)[0] ?? {}
        const variant = uniqueId(sanitizeId(colorway) || 'colorway', (candidate) => candidate in variants)
        manifest.variants = { ...variants, [variant]: { ...base, palette: colorway } }
        return { files: { ...files, 'manifest.json': JSON.stringify(manifest) }, variant }
    } catch {
        return null
    }
}
