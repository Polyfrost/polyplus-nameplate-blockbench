import { BlockRect, NameplateDetail } from '../engine'
import { parseJsonOrNull } from '../util/json'
import { wholeClamped } from '../util/num'
import { measure } from '../font'

export type GameLook = 'full' | 'v1214' | 'v1211' | 'v189' | 'cpu' | 'none' | 'reduced' | 'off'

export type ShadowColor = 'glyph' | 'vanilla'

export interface LookSpec {
    label: string
    detail: NameplateDetail
    still: boolean
    effects: boolean
    vanillaShadow: boolean
    gpu: boolean
    shadow: ShadowColor
    legacy: boolean
    inlineBadge: boolean
    note: string
}

const MODERN = { detail: 'full', still: false, effects: true, vanillaShadow: false, gpu: true, shadow: 'glyph', legacy: false, inlineBadge: false } as const

const CPU_EFFECTS = 'basic effects: no "Glows in the dark", block textures stand still and screen effects follow the tag.'

export const LOOKS: Record<GameLook, LookSpec> = {
    full: {
        ...MODERN,
        label: '26.3 to 1.21.8 (full effects)',
        note: '',
    },
    v1214: {
        ...MODERN,
        label: '1.21.5 and 1.21.4 (basic effects)',
        gpu: false,
        note: `1.21.5 and 1.21.4: ${CPU_EFFECTS}`,
    },
    v1211: {
        ...MODERN,
        label: '1.21.1 (basic effects, plain shadow)',
        gpu: false,
        shadow: 'vanilla',
        note: `1.21.1: ${CPU_EFFECTS} A custom name shadow color falls back to the normal dark shadow.`,
    },
    v189: {
        ...MODERN,
        label: '1.8.9 (basic effects, old text)',
        gpu: false,
        shadow: 'vanilla',
        legacy: true,
        inlineBadge: true,
        note: `1.8.9: ${CPU_EFFECTS} Name colors snap to the 16 old chat colors, the shadow color is the normal one and the PolyPlus badge sits in front of the name.`,
    },
    cpu: {
        ...MODERN,
        label: 'Shader packs (basic effects)',
        gpu: false,
        note: `Shader packs (Iris): ${CPU_EFFECTS}`,
    },
    none: {
        ...MODERN,
        label: 'No effects',
        effects: false,
        note: 'No effects: effect layers are hidden, as for players who turn nameplate effects off.',
    },
    reduced: {
        ...MODERN,
        label: 'Reduced motion',
        detail: 'reduced',
        note: 'Reduced motion: paths, particles and one-shots stop, and each reaction holds still or is skipped, as set in its properties. The loop and colors still play.',
    },
    off: {
        ...MODERN,
        label: 'Motion off',
        detail: 'reduced',
        still: true,
        note: 'Motion off: every layer shows its first frame, and paths and particles are hidden.',
    },
}

export type Backdrop = 'plain' | 'sky' | 'night' | 'water' | 'glass'
export type WorldLight = 'day' | 'night' | 'cave'
export type CompareMode = 'off' | 'split' | 'diff'

export const BACKDROPS: Record<Backdrop, string> = {
    plain: 'Plain gray',
    sky: 'Daytime sky',
    night: 'Night sky',
    water: 'Under water',
    glass: 'Behind glass',
}

export const LIGHTS: Record<WorldLight, string> = {
    day: 'Daylight',
    night: 'Night outside',
    cave: 'Dark cave',
}

export const COMPARES: Record<CompareMode, string> = {
    off: 'Off',
    split: 'Split: full left, basic right',
    diff: 'Show differences',
}

export interface PreviewOptions {
    name: string
    rank: string
    rankColor: string
    above: string
    below: string
    nameBelow: boolean
    polyNametag: boolean
    padX: number
    padY: number
    backgroundColor: string
    backgroundOpacity: number
    look: GameLook
    backdrop: Backdrop
    light: WorldLight
    compare: CompareMode
    wardrobe: boolean
}

export const MAX_PADDING = 10
export const VANILLA_BACKGROUND = 'rgba(0, 0, 0, 0.25)'
export const LINE_ABOVE = 'Line above'
export const LINE_BELOW = 'Line below'

export const DEFAULT_OPTIONS: Readonly<PreviewOptions> = Object.freeze({
    name: '',
    rank: '',
    rankColor: '#FFAA00',
    above: LINE_ABOVE,
    below: LINE_BELOW,
    nameBelow: false,
    polyNametag: false,
    padX: 2,
    padY: 1,
    backgroundColor: '#000000',
    backgroundOpacity: 25,
    look: 'full',
    backdrop: 'plain',
    light: 'day',
    compare: 'off',
    wardrobe: false,
})

export const previewOptions: PreviewOptions = { ...DEFAULT_OPTIONS }

export interface PreviewPreset {
    id: string
    name: string
    icon: string
    description: string
    lines: number
    options: Partial<PreviewOptions>
}

export const PRESETS: PreviewPreset[] = [
    {
        id: 'short',
        name: 'Short name',
        icon: 'short_text',
        description: 'A two-letter name',
        lines: 1,
        options: { name: 'Mo' },
    },
    {
        id: 'long',
        name: 'Long name',
        icon: 'notes',
        description: 'A 16-letter name, the longest Minecraft allows',
        lines: 1,
        options: { name: 'Sir_Builds_A_Lot' },
    },
    {
        id: 'rank',
        name: 'With rank',
        icon: 'military_tech',
        description: 'A server rank before the name, like "[VIP] Steve"',
        lines: 1,
        options: { rank: '[VIP] ' },
    },
    {
        id: 'server',
        name: 'Server tag, 2 lines',
        icon: 'dns',
        description: 'A server tag with a rank line above the name, as some servers draw it',
        lines: 2,
        options: { nameBelow: true, above: '[VIP] Red Team' },
    },
    {
        id: 'padding',
        name: 'PolyNametag padding',
        icon: 'padding',
        description: 'The tag as PolyNametag draws it with its background on and some padding',
        lines: 1,
        options: { polyNametag: true, padX: 3, padY: 2 },
    },
]

export function resetOptions(keep: Partial<PreviewOptions> = {}) {
    Object.assign(previewOptions, DEFAULT_OPTIONS, keep)
}

export const KEPT_OPTIONS = ['look', 'backdrop', 'light', 'compare', 'wardrobe'] as const

export function keptOptions(): Partial<PreviewOptions> {
    const kept: Partial<PreviewOptions> = {}
    for (const key of KEPT_OPTIONS) (kept as any)[key] = previewOptions[key]
    return kept
}

export function currentLook(): LookSpec {
    return LOOKS[previewOptions.look] ?? LOOKS.full
}

export function rankAdvance(rank: string): number {
    return rank ? measure(rank) : 0
}

export interface TagPadding {
    x: number
    y: number
}

export function tagPadding(): TagPadding | null {
    if (!previewOptions.polyNametag) return null
    return { x: wholeClamped(previewOptions.padX, 0, MAX_PADDING, 0), y: wholeClamped(previewOptions.padY, 0, MAX_PADDING, 0) }
}

export function backgroundRect(width: number, height: number, padding: TagPadding | null): BlockRect {
    const x = padding?.x ?? 0
    const y = padding?.y ?? 0
    return { x0: -1 - x, y0: -1 - y, x1: width + x, y1: height + 1 + y }
}

function channel(hex: string, at: number): number {
    return parseInt(hex.slice(at, at + 2), 16)
}

export function backgroundColor(): string {
    if (!previewOptions.polyNametag) return VANILLA_BACKGROUND
    const match = /^#?([0-9a-f]{6})/i.exec(String(previewOptions.backgroundColor).trim())
    const hex = match ? match[1] : '000000'
    const opacity = Math.min(100, Math.max(0, Number(previewOptions.backgroundOpacity) || 0)) / 100
    return `rgba(${channel(hex, 0)}, ${channel(hex, 2)}, ${channel(hex, 4)}, ${opacity})`
}

const effects: { files: Record<string, string> | null, variant: string, indices: Set<number> } = { files: null, variant: '', indices: new Set() }

export function effectLayers(files: Record<string, string>, variant: string): Set<number> {
    if (effects.files === files && effects.variant === variant) return effects.indices
    const indices = new Set<number>()
    const manifest = parseJsonOrNull(files['manifest.json'])
    const slots: unknown[] = Array.isArray(manifest?.layers) ? manifest.layers : []
    const swaps = manifest?.variants?.[variant]?.swap ?? {}
    slots.forEach((slot: any, index) => {
        const id = String(swaps?.[slot?.id] ?? slot?.id ?? '')
        if (parseJsonOrNull(files[`layers/${id}.json`])?.kind === 'material') indices.add(index)
    })
    effects.files = files
    effects.variant = variant
    effects.indices = indices
    return indices
}

export function colorText(value: unknown, fallback: string): string {
    const color = value as { toHexString?: () => string } | null
    if (color && typeof color.toHexString === 'function') return color.toHexString().toUpperCase()
    const text = String(value ?? '').trim()
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : fallback
}
