export type OverlayKind = 'chevron' | 'triangle' | 'circle'
export const OVERLAY_KINDS: OverlayKind[] = ['chevron', 'triangle', 'circle']

export type FlagAxis = 'rows' | 'columns'
export const FLAG_AXES: FlagAxis[] = ['rows', 'columns']

export const FLAG_LIMITS = {
    flags: 16,
    bands: 12,
    weight: 1000,
    overlayColors: 8,
    overlayWidth: 8,
    glyphHeight: 8,
}

export interface FlagBand {
    color: string
    weight: number
}

export interface FlagOverlay {
    kind: OverlayKind
    colors: string[]
    width: number
}

export interface FlagData {
    id: string
    bands: FlagBand[]
    overlay: FlagOverlay | null
    rowsOverride: Record<string, number[]>
    symmetric: boolean
    axis: FlagAxis
}

export interface FlagsState {
    flags: FlagData[]
    variants: Record<string, string>
}

export function emptyFlags(): FlagsState {
    return { flags: [], variants: {} }
}

export function overlayColorRange(kind: OverlayKind): [number, number] {
    if (kind === 'triangle') return [1, 1]
    if (kind === 'circle') return [1, 2]
    return [1, FLAG_LIMITS.overlayColors]
}
