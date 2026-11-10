import type { BundleIssue } from '../model'
import { stringifyJson } from '../util/bundleJson'
import { isRecord } from '../util/json'
import { wholeOr } from '../util/num'
import { FLAG_AXES, FLAG_LIMITS, FlagAxis, FlagData, FlagsState, OVERLAY_KINDS, OverlayKind } from './types'

export const FLAGS_FILE = 'flags.json'

type Json = Record<string, any>

function normalizeFlag(raw: any): FlagData {
    const bands = Array.isArray(raw?.bands) ? raw.bands : []
    const overlay = isRecord(raw?.overlay) && OVERLAY_KINDS.includes(raw.overlay.kind as OverlayKind)
        ? {
            kind: raw.overlay.kind as OverlayKind,
            colors: Array.isArray(raw.overlay.colors) ? raw.overlay.colors.filter((color: unknown) => typeof color === 'string') : [],
            width: Math.max(1, wholeOr(raw.overlay.width, 1)),
        }
        : null
    const rowsOverride: Record<string, number[]> = {}
    if (isRecord(raw?.rowsOverride)) {
        for (const rows of Object.keys(raw.rowsOverride)) {
            const list = raw.rowsOverride[rows]
            if (Array.isArray(list)) rowsOverride[rows] = list.map((value: unknown) => wholeOr(value, 0))
        }
    }
    return {
        id: typeof raw?.id === 'string' ? raw.id : 'flag',
        bands: bands.map((band: any) => ({
            color: typeof band?.color === 'string' ? band.color : '',
            weight: Math.max(1, wholeOr(band?.weight, 1)),
        })),
        overlay,
        rowsOverride,
        symmetric: raw?.symmetric === true,
        axis: raw?.axis === 'columns' ? 'columns' : 'rows',
    }
}

export function normalizeFlags(raw: any): FlagsState {
    const flags = Array.isArray(raw?.flags) ? raw.flags.map(normalizeFlag) : []
    const variants: Record<string, string> = {}
    if (isRecord(raw?.variants)) {
        for (const key of Object.keys(raw.variants)) {
            if (typeof raw.variants[key] === 'string' && raw.variants[key]) variants[key] = raw.variants[key]
        }
    }
    return { flags, variants }
}

function flagJson(flag: FlagData): Json {
    const entry: Json = {
        id: flag.id,
        bands: flag.bands.map((band) => ({ color: band.color, weight: band.weight })),
    }
    if (flag.overlay) entry.overlay = { kind: flag.overlay.kind, colors: flag.overlay.colors.slice(), width: flag.overlay.width }
    const rows = flag.axis === 'columns' ? [] : Object.keys(flag.rowsOverride).sort((a, b) => Number(a) - Number(b))
    if (rows.length > 0) {
        const overrides: Record<string, number[]> = {}
        for (const count of rows) overrides[count] = flag.rowsOverride[count].slice()
        entry.rowsOverride = overrides
    }
    if (flag.symmetric) entry.symmetric = true
    if (flag.axis === 'columns') entry.axis = flag.axis
    return entry
}

export function flagsJson(state: FlagsState): Json | null {
    if (state.flags.length === 0) return null
    return { flags: state.flags.map(flagJson) }
}

export function applyFlags(
    state: FlagsState | null | undefined,
    manifest: Json,
    files: Record<string, string>,
    issues: BundleIssue[],
): void {
    if (!state) return
    const json = flagsJson(state)
    if (json) files[FLAGS_FILE] = stringifyJson(json)
    if (state.flags.length > FLAG_LIMITS.flags) {
        issues.push({ path: `${FLAGS_FILE}#flags`, message: `at most ${FLAG_LIMITS.flags} flags` })
    }
    const ids = new Set(state.flags.map((flag) => flag.id))
    const variants = isRecord(manifest.variants) ? manifest.variants : null
    for (const key of Object.keys(state.variants)) {
        const flag = state.variants[key]
        if (!flag || !variants || !isRecord(variants[key])) continue
        if (!ids.has(flag)) {
            issues.push({ path: `manifest.json#variants.${key}.flag`, message: `no flag '${flag}'` })
            continue
        }
        variants[key].flag = flag
    }
}

export function importFlags(
    flagsFile: unknown,
    manifestVariants: unknown,
    change: (note: string) => void,
): FlagsState | null {
    const variants: Record<string, string> = {}
    if (isRecord(manifestVariants)) {
        for (const key of Object.keys(manifestVariants)) {
            const flag = manifestVariants[key]?.flag
            if (typeof flag === 'string' && flag) variants[key] = flag
        }
    }
    if (!isRecord(flagsFile) && Object.keys(variants).length === 0) return null
    const state = normalizeFlags({ flags: isRecord(flagsFile) ? flagsFile.flags : [], variants })
    if (isRecord(flagsFile)) {
        const raw = Array.isArray(flagsFile.flags) ? flagsFile.flags : []
        raw.forEach((flag: any, index: number) => {
            if (!isRecord(flag)) return
            for (const key of Object.keys(flag)) {
                if (!['id', 'bands', 'overlay', 'rowsOverride', 'symmetric', 'axis'].includes(key)) {
                    change(`Flag ${state.flags[index]?.id ?? index}: '${key}' is not a flag setting and was dropped`)
                }
            }
            if ('axis' in flag && !FLAG_AXES.includes(flag.axis as FlagAxis)) {
                change(`Flag ${state.flags[index]?.id ?? index}: stripe direction ${JSON.stringify(flag.axis)} is not one the plugin can use, so its stripes run across`)
            }
        })
        for (const key of Object.keys(flagsFile)) {
            if (key !== 'flags') change(`${FLAGS_FILE}: '${key}' is not a flag setting and was dropped`)
        }
    }
    return state
}
