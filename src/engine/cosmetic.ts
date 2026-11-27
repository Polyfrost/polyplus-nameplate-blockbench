import { AUTHORING_CAPABILITIES, CosmeticEngine, CosmeticStatus, ENGINE_CAPABILITIES, RawCosmeticAnalysis, RawCosmeticMeta } from '@plusrenderer/renderer/cosmetic.js'
import { deflateZip } from '../util/zip'
import { EngineIssue, issuesOf } from './issues'
import { currentEngine } from './wasm'

export type { CosmeticStatus, RawCosmeticAnalysis, RawCosmeticMeta } from '@plusrenderer/renderer/cosmetic.js'

export interface CosmeticLoad {
    status: CosmeticStatus
    issues: EngineIssue[]
    skipped: string[]
    meta: RawCosmeticMeta | null
    analysis: RawCosmeticAnalysis | null
}

const PREVIEW_IDENTITY = 1

let cosmetic: CosmeticEngine | null = null

function cosmeticEngine(): CosmeticEngine | null {
    const engine = currentEngine()
    if (!engine) return null
    if (!cosmetic || cosmetic.wasm !== engine.wasm) cosmetic = new CosmeticEngine(engine.wasm)
    return cosmetic
}

export function cosmeticEngineNow(): CosmeticEngine | null {
    return cosmeticEngine()
}

export function cosmeticLimits(): Readonly<Record<string, number>> | null {
    try {
        const limits = cosmeticEngine()?.constants().limits
        return limits && typeof limits === 'object' ? limits : null
    } catch (error) {
        console.error('[polyplus_nameplate] reading the cosmetic limits failed', error)
        return null
    }
}

export function cosmeticCapabilities(): string[] {
    let host: unknown = []
    try {
        host = currentEngine()?.constants().capabilities ?? []
    } catch {
        host = []
    }
    const names = Array.isArray(host) ? host.filter((name): name is string => typeof name === 'string') : []
    return Array.from(new Set([...names, ...ENGINE_CAPABILITIES]))
}

export function unknownRequires(requires: unknown): string[] {
    const known = new Set([...cosmeticCapabilities(), ...AUTHORING_CAPABILITIES])
    return Array.isArray(requires) ? requires.filter((name): name is string => typeof name === 'string' && !known.has(name)) : []
}

export function loadCosmetic(files: Record<string, string>, binary: Record<string, Uint8Array>, mode: 'client' | 'authoring' = 'authoring'): CosmeticLoad | null {
    const engine = cosmeticEngine()
    if (!engine) return null
    const asset = engine.parse(deflateZip({ ...files, ...binary }), { mode, capabilities: cosmeticCapabilities(), identity: PREVIEW_IDENTITY })
    try {
        return {
            status: asset.status,
            issues: issuesOf(asset.issues),
            skipped: asset.skip?.requires ?? [],
            meta: asset.meta(),
            analysis: asset.analyze(),
        }
    } finally {
        asset.free()
    }
}

export function resolveCosmeticTexture(files: Record<string, string>, binary: Record<string, Uint8Array>, colorway: number): Array<{ name: string, width: number, height: number, rgba: Uint8Array }> {
    const engine = cosmeticEngine()
    if (!engine) return []
    const asset = engine.parse(deflateZip({ ...files, ...binary }), { mode: 'authoring', capabilities: cosmeticCapabilities(), identity: PREVIEW_IDENTITY })
    try {
        const meta = asset.meta()
        if (!meta) return []
        return meta.textures.map((texture, index) => ({ ...texture, rgba: asset.resolveTexture(index, { colorway }) }))
    } finally {
        asset.free()
    }
}
