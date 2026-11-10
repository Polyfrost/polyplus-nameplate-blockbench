import type { FillData } from '../model'

interface FillParts {
    kind?: unknown
    ref?: unknown
    slot?: unknown
    axis?: unknown
}

export function fillFromParts(parts: FillParts): FillData | null {
    switch (parts.kind) {
        case 'color':
            return { kind: 'color', ref: String(parts.ref ?? '') }
        case 'gradient':
            return { kind: 'gradient', slot: String(parts.slot ?? '') }
        case 'blend':
            return { kind: 'blend', slot: String(parts.slot ?? '') }
        case 'sweep':
            return { kind: 'sweep', slot: String(parts.slot ?? ''), axis: parts.axis === 'y' ? 'y' : 'x' }
        case 'flag':
            return { kind: 'flag' }
        default:
            return null
    }
}

export function paintFillJson(fill: FillData | null | undefined): Record<string, unknown> | null {
    switch (fill?.kind) {
        case 'color':
            return { color: fill.ref }
        case 'gradient':
            return { gradient: fill.slot }
        case 'blend':
            return { blend: fill.slot }
        case 'sweep':
            return { sweep: fill.slot, axis: fill.axis }
        default:
            return null
    }
}

export function fillJson(fill: FillData): Record<string, unknown> {
    return fill.kind === 'flag' ? { flag: true } : (paintFillJson(fill) ?? {})
}
