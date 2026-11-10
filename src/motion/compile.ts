import type { BundleIssue } from '../model'
import {
    BURST_CHANNEL,
    isMotionLayer,
    SpriteAdaptiveData,
    WidthBreakpoint,
} from './types'

type Json = Record<string, unknown>
type SpriteIds = Map<string, string>

interface TexturedLayer {
    kind: string
    texture?: string
    sprites?: string[]
    breakpoints?: WidthBreakpoint[]
    adaptive?: SpriteAdaptiveData
}


function layerPath(id: string, field: string): string {
    return `layers/${id}.json#${field}`
}

function spriteRef(
    texture: string,
    spriteIds: SpriteIds,
    path: string,
    what: string,
    issues: BundleIssue[],
): string | null {
    if (!texture) {
        issues.push({ path, message: `${what} has no texture` })
        return null
    }
    const id = spriteIds.get(texture)
    if (!id) {
        issues.push({ path, message: `texture '${texture}' has no sprite data` })
        return null
    }
    return id
}

export function layerTextureUuids(layer: TexturedLayer): string[] {
    let uuids: unknown[] = []
    if (layer.kind === 'emitter') uuids = layer.sprites ?? []
    else if (layer.kind === 'sprite' || layer.kind === 'path') {
        const breakpoints = layer.kind === 'path' ? layer.breakpoints : layer.adaptive?.breakpoints
        uuids = [layer.texture, ...(breakpoints ?? []).map((breakpoint) => breakpoint.texture)]
    }
    return uuids.filter((uuid, index): uuid is string => typeof uuid === 'string' && !!uuid && uuids.indexOf(uuid) === index)
}

function breakpointsJson(
    breakpoints: WidthBreakpoint[],
    mainTexture: string | null,
    spriteIds: SpriteIds,
    id: string,
    issues: BundleIssue[],
    allowSprites: boolean,
): Json[] {
    return breakpoints.map((breakpoint, index) => {
        const entry: Json = { min: breakpoint.min }
        if (breakpoint.max !== null) entry.max = breakpoint.max
        if (allowSprites && breakpoint.texture && breakpoint.texture !== mainTexture) {
            const sprite = spriteRef(breakpoint.texture, spriteIds, layerPath(id, `breakpoints[${index}].sprite`), 'breakpoint', issues)
            if (sprite) entry.sprite = sprite
        }
        return entry
    })
}

export function spriteAdaptiveFields(
    id: string,
    texture: string,
    adaptive: SpriteAdaptiveData | undefined,
    spriteIds: SpriteIds,
    issues: BundleIssue[],
): Json {
    const fields: Json = {}
    if (!adaptive) return fields
    if (adaptive.repeat) {
        fields.repeat = {
            edge: adaptive.repeat.edge,
            spacing: adaptive.repeat.spacing,
            min: adaptive.repeat.min,
            max: adaptive.repeat.max,
        }
    }
    if (adaptive.breakpoints.length > 0) {
        fields.breakpoints = breakpointsJson(adaptive.breakpoints, texture, spriteIds, id, issues, true)
    }
    return fields
}

export function burstTracks(layers: Array<{ kind: string }>): Record<string, unknown[][]> {
    const result: Record<string, unknown[][]> = {}
    for (const layer of layers) {
        if (!isMotionLayer(layer) || layer.kind !== 'emitter' || layer.bursts.length === 0) continue
        result[layer.id] = layer.bursts
            .slice()
            .sort((a, b) => a.step - b.step)
            .map((key) => [key.step, key.count])
    }
    return result
}

export function applyMotionManifest(layers: Array<{ kind: string }>, manifest: Json): void {
    const bursts = burstTracks(layers)
    const targets = Object.keys(bursts)
    if (targets.length === 0) return
    const animations = (manifest.animations && typeof manifest.animations === 'object' ? manifest.animations : {}) as Json
    const loop = (animations.loop && typeof animations.loop === 'object' ? animations.loop : {}) as Json
    const tracks = (loop.tracks && typeof loop.tracks === 'object' ? loop.tracks : {}) as Record<string, Json>
    for (const target of targets) tracks[target] = { ...(tracks[target] ?? {}), [BURST_CHANNEL]: bursts[target] }
    loop.tracks = tracks
    animations.loop = loop
    manifest.animations = animations
}

export function usesSprites(layer: { kind: string }): boolean {
    return layer.kind !== 'body'
}
