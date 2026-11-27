import { RawConstants, RawMolangCheck, RawNode } from '@plusrenderer/renderer/nameplate.js'
import { EngineIssue, issueMessage } from './issues'
import { MaterialLimits, NameplateLimits } from './load'
import { currentEngine } from './wasm'

export { blockRow, displayBlock, lineBlock, placedBlock } from './block'
export type { BlockRect, LineAlign, NameplateBlock } from './block'
export { drawLayers, drawPlateLayers, drawRasterLayer, layerBounds, layerLeft, layerPasses, layerTop, passCanvases, PLATE_OPACITY, rasterCanvas, setLayerDrawer } from './draw'
export type { LayerBounds, LayerDrawer, NameplateLayer, RasterStyle } from './draw'
export { describe, issueMessage, wrapIssue } from './issues'
export type { EngineIssue, IssueLevel, IssueNames, IssueValues } from './issues'
export { analysisOf, authoringInput, BUDGET_ISSUE_CODES, authoringIssues, currentBinary, disposeLoad, disposeUnheld, engineManifest, holdPreview, loadBundle, previewHolds, previewOfLoad, PreviewSlot, reactionSignal, releasePreview, setBinarySource, signalReaction, stateOf, STILL_BADGE } from './load'
import { signalReaction } from './load'
export type {
    BundleBinary,
    LoadedBundle,
    LoadMode,
    MaterialLimits,
    NameplateBadgePose,
    NameplateCost,
    NameplateDetail,
    NameplateEffectCost,
    NameplateEffectInfo,
    NameplateFallbackCost,
    NameplateLayerCost,
    NameplateLetters,
    NameplateLimits,
    NameplateLook,
    NameplateMotion,
    NameplatePreview,
    NameplateRecord,
    NameplateTagState,
    NameplateView,
    TexturePixels,
} from './load'
export type { RawConstants, RawNode, RawNodeInput, RawNodeSetting } from '@plusrenderer/renderer/nameplate.js'
export { engineSource } from './source'
export type { EngineSource } from './source'
export { currentEngine, onEngineReady, startEngine } from './wasm'
export { AuthoringQueue, authoringNow, backgroundRunner, stopBackgroundChecks } from './authoring'
export type { AuthoringRun, AuthoringRunner, AuthoringTimers } from './authoring'
export { cosmeticCapabilities, cosmeticLimits, loadCosmetic, resolveCosmeticTexture, unknownRequires } from './cosmetic'
export type { CosmeticLoad, CosmeticStatus, RawCosmeticAnalysis, RawCosmeticMeta } from './cosmetic'
export { AFFINE_FLOATS, combatOverride, COMBAT_SIGNAL, CosmeticDriver, EVENT_EQUIP, EVENT_JUMP, IDENTITY, QUAD_FLOATS, VIEW_FLOATS } from './cosmeticDriver'
export type { DriverFrame, DriverInput, DriverMoment, DriverPlay, DriverRole, DriverSound, DriverTexture } from './cosmeticDriver'
export { EmoteDriver, PLAYER_BONES } from './emoteDriver'
export type { EmoteActor } from './emoteDriver'

export type MolangContext = 'channel' | 'slot_color' | 'field' | 'text' | 'material'

function constantsOf(): RawConstants | null {
    try {
        return currentEngine()?.constants() ?? null
    } catch (error) {
        console.error('[polyplus_nameplate] reading the engine constants failed', error)
        return null
    }
}

export function engineConstants(): RawConstants | null {
    return constantsOf()
}

export function engineLimits(): Readonly<Record<string, number>> | null {
    const limits = constantsOf()?.limits
    return limits && typeof limits === 'object' ? limits : null
}

function limitOf(limits: Readonly<Record<string, number>>, key: string): number {
    const value = limits[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : Infinity
}

export function nameplateLimits(): NameplateLimits | null {
    const limits = engineLimits()
    if (!limits) return null
    return {
        quads: limitOf(limits, 'quads'),
        cacheBytes: limitOf(limits, 'image_bytes'),
        fallbackBytes: limitOf(limits, 'fallback_bytes'),
        cpu: limitOf(limits, 'cpu_units'),
        margin: limitOf(limits, 'decoration_margin'),
        states: limitOf(limits, 'cached_states'),
        flashes: limitOf(limits, 'flashes_per_second'),
        flashArea: limitOf(limits, 'flash_area_pixels'),
    }
}

export function materialLimits(): MaterialLimits | null {
    const limits = engineLimits()
    if (!limits) return null
    return {
        maxCost: limitOf(limits, 'material_cost'),
        outlineFactor: limitOf(limits, 'material_outline_factor'),
        toneCost: limitOf(limits, 'material_tone_cost'),
        maxNodes: limitOf(limits, 'material_nodes'),
        maxSamples: limitOf(limits, 'material_samples'),
        maxInputs: limitOf(limits, 'material_inputs'),
        maxRepeat: limitOf(limits, 'material_repeat'),
        maxOctaves: limitOf(limits, 'material_octaves'),
        maxMargin: limitOf(limits, 'material_margin'),
    }
}

export function engineNodes(): readonly RawNode[] {
    const nodes = constantsOf()?.nodes
    return Array.isArray(nodes) ? nodes : []
}

export function materialNodeCost(type: string, variant: number): number | null {
    const node = engineNodes().find((entry) => entry.type === type)
    if (!node) return null
    const values = node.cost?.values ?? []
    const value = node.cost?.by === 'flat' ? values[0] : values[variant - 1]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const SWITCH_PREFIX = 'is_'

function stringList(value: unknown): readonly string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

export function engineAnchors(): readonly string[] {
    return stringList(constantsOf()?.anchors)
}

export function engineSignals(): readonly string[] {
    return stringList(constantsOf()?.signals)
}

export function engineReactions(): readonly string[] {
    return engineSignals().filter((signal) => signal.startsWith(SWITCH_PREFIX)).map(signalReaction)
}

export function engineCapabilities(): readonly string[] {
    return stringList(constantsOf()?.capabilities)
}

export function offeredBy<T extends string>(list: readonly T[], known: readonly string[]): T[] {
    if (!known.length) return list.slice()
    return list.filter((entry) => known.includes(entry))
}

function checkIssue(check: RawMolangCheck): EngineIssue {
    const code = check.code ?? 'molang'
    return { path: '', code, level: 'error', values: {}, names: {}, message: issueMessage(code, {}, {}) || (check.message ?? '') }
}

export function checkMolang(source: string, context: MolangContext): EngineIssue[] {
    const engine = currentEngine()
    if (!engine) return []
    const check = engine.checkMolang(source, context)
    return check.ok ? [] : [checkIssue(check)]
}
