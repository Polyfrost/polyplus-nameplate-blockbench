import { CosmeticLoad, EngineIssue, issueMessage, loadCosmetic } from '../engine'
import { isRecord } from '../util/json'
import { BundleFiles, buildBundle, CosmeticSources, geometryPath, PALETTES } from './bundle'
import { CosmeticData } from './data'
import { missingSlotIssues, texturePathIssues } from './effects'
import { shadeClashes, toneOverflows } from './indexed'

export interface BuiltCosmetic extends BundleFiles {
    requires: string[]
    load: CosmeticLoad | null
    issues: EngineIssue[]
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((name, i) => name === b[i])
}

const DRAWN = ['cubes', 'poly_mesh', 'texture_meshes']

function drawnContent(value: unknown): boolean {
    return Array.isArray(value) ? value.length > 0 : isRecord(value) && Object.keys(value).length > 0
}

export function drawsGeometry(geometry: Record<string, unknown> | null): boolean {
    const models = geometry?.['minecraft:geometry']
    if (!Array.isArray(models)) return false
    return models.some((model) => isRecord(model) && Array.isArray(model.bones) && model.bones.some((bone: unknown) => isRecord(bone) && DRAWN.some((key) => drawnContent(bone[key]))))
}

function modelIssue(data: CosmeticData, code: string, values: Record<string, number> = {}): EngineIssue {
    return { path: geometryPath(data.id), code, level: 'error', values, names: {}, message: issueMessage(code, values, {}) }
}

export function modelTextureIssues(data: CosmeticData, sources: CosmeticSources): EngineIssue[] {
    if (sources.textures.length > 1) return [modelIssue(data, 'model_textures_extra', { count: sources.textures.length })]
    if (!drawsGeometry(sources.geometry)) return []
    if (!sources.textures.length) return [modelIssue(data, 'model_texture_missing')]
    return []
}

export function shadeIssues(data: CosmeticData, sources: CosmeticSources, guessed: ReadonlySet<string> | null = null): EngineIssue[] {
    if (!sources.textures.some((texture) => texture.index)) return []
    return shadeClashes(data.palette).filter((clash) => !guessed || guessed.has(clash.color.slice(1))).map((clash) => {
        const names = { color: clash.color, first: clash.first, second: clash.second }
        return { path: PALETTES, code: 'palette_shade_shared', level: 'error', values: {}, names, message: issueMessage('palette_shade_shared', {}, names) }
    })
}

export function toneIssues(data: CosmeticData): EngineIssue[] {
    return toneOverflows(data.palette).map((overflow) => {
        const names = { slot: overflow.slot }
        const values = { count: overflow.count, limit: overflow.limit }
        return { path: PALETTES, code: 'palette_tones_over', level: 'error', values, names, message: issueMessage('palette_tones_over', values, names) }
    })
}

function toneLimitIssue(issue: EngineIssue): boolean {
    return issue.code === 'palette' && typeof issue.values?.slot === 'number' && typeof issue.values?.limit === 'number' && typeof issue.values?.tone !== 'number'
}

function engineIssues(load: CosmeticLoad | null, extra: EngineIssue[]): EngineIssue[] {
    const own = extra.some((issue) => issue.code === 'palette_tones_over')
    return (load?.issues ?? []).filter((issue) => !own || !toneLimitIssue(issue))
}

export function buildCosmetic(data: CosmeticData, sources: CosmeticSources, own: EngineIssue[] = [], guessed: ReadonlySet<string> | null = null): BuiltCosmetic {
    const extra = [...own, ...missingSlotIssues(data), ...toneIssues(data), ...shadeIssues(data, sources, guessed), ...modelTextureIssues(data, sources), ...texturePathIssues(data, sources)]
    const probe = buildBundle(data, sources, [])
    const first = loadCosmetic(probe.files, probe.binary)
    const requires = first?.analysis?.requires ?? []
    if (!first || sameList(requires, [])) return { ...probe, requires, load: first, issues: [...extra, ...engineIssues(first, extra)] }
    const bundle = buildBundle(data, sources, requires)
    const load = loadCosmetic(bundle.files, bundle.binary)
    return { ...bundle, requires, load, issues: [...extra, ...engineIssues(load, extra)] }
}

export function hasErrors(issues: readonly EngineIssue[]): boolean {
    return issues.some((issue) => (issue.level ?? 'error') === 'error')
}
