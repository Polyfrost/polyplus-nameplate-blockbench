declare module '@plusrenderer/renderer/plusrenderer.wasm' {
    const bytes: Uint8Array
    export default bytes
}

declare module '@plusrenderer/renderer/nameplate.js' {
    export type BundleFiles = Record<string, string | Uint8Array> | Map<string, string | Uint8Array> | Array<[string, string | Uint8Array]>

    export interface LoadOptions {
        mode?: 'client' | 'authoring'
        capabilities?: string[]
        identity?: bigint | number | null
    }

    export interface RawIssue {
        code: string
        level: 'error' | 'warning' | 'info'
        path: string
        values: Record<string, number | null>
        names: Record<string, string>
    }

    export interface RawSkip {
        format?: number
        requires?: string[]
    }

    export interface RawVariant {
        key: string
        identity: string
        colorway: number | null
        owns_background: boolean
    }

    export interface RawLayer {
        slot: number
        id: string
        content: 'body' | 'sprite' | 'emitter' | 'material'
        depth: string
    }

    export interface RawReaction {
        name: string
        signal: string | null
        signal_index: number
    }

    export interface RawOneShot {
        name: string
        trigger: 'start' | 'stop' | 'appear' | 'equip'
        signal: string | null
        signal_index?: number
        restart: boolean
    }

    export interface RawMeta {
        status: 'asset' | 'draft' | 'skipped' | 'invalid'
        skip: RawSkip | null
        id?: string
        identity?: string
        fps?: number
        loop_frames?: number
        phase?: 'global' | 'per_player'
        requires?: string[]
        variants?: RawVariant[]
        layers?: RawLayer[]
        animations?: {
            reactions: RawReaction[]
            one_shots: RawOneShot[]
            schedules: Array<{ id: string, events: string[] }>
        }
        params?: Array<{ id: string, value: number, min: number, max: number }>
        textures?: Array<{ width: number, height: number }>
    }

    export interface RawLayerAnalysis {
        id: string
        states: number
        image_bytes: number
        quads: number
        cpu_units: number
        margin: number
    }

    export interface RawEffectAnalysis {
        layer: string
        states: number
        shot_states: number
        tone_slots: number
        reads: string[]
        build_ops: number
    }

    export interface RawAnalysis {
        requires: string[]
        quads: number
        cpu_units: number
        image_bytes: number
        fallback_bytes: number
        record_bytes: number
        max_out_words: number
        material_build_ops: number
        layers: RawLayerAnalysis[]
        effects: RawEffectAnalysis[]
    }

    export interface RawSampler {
        name: string
        unit: number
        texture: { kind: 'bundle', index: number } | { kind: 'vanilla' | 'atlas', name: string }
    }

    export interface RawShader {
        key: string
        material: number
        vertex: string
        fragment: string
        samplers: RawSampler[]
        uniform_words: number
        tones: number[]
        blend: 'alpha' | 'additive'
        depth_prepass: boolean
        unsupported: string[]
    }

    export interface RawShaders {
        dialect: string
        shaders: RawShader[]
        issues: RawIssue[]
    }

    export interface RawLetterPose {
        dx: number
        dy: number
        color: number
        shadow: number
        opacity: number
        scale: number
        rotation: number
        outline: number
    }

    export interface RawRaster {
        width: number
        height: number
        origin: [number, number]
        plate: [number, number]
        badge: { x: number, y: number, opacity: number } | null
        textMode: 'vanilla' | 'motion' | 'owned'
        letters: RawLetterPose[]
        data: Uint8ClampedArray
    }

    export interface RawRasterLayer {
        slot: number
        id: string | null
        depth: 'behind' | 'background' | 'over_background' | 'over_text'
        band: 'under_text' | 'over_text'
        blend: 'alpha' | 'additive'
        composite: 'source-over' | 'lighter'
        data: Uint8ClampedArray
        passes: Uint8ClampedArray[]
    }

    export interface RawRasterLayers extends Omit<RawRaster, 'data'> {
        layers: RawRasterLayer[]
    }

    export interface RawNodeInput {
        name: string
        accepts: string
        required: boolean
        default?: number[]
        default_node?: string
    }

    export interface RawNodeSetting {
        name: string
        kind: string
        required: boolean
        min: number
        max: number
        default: [number, number]
        choices: string[]
    }

    export interface RawNode {
        type: string
        inputs: RawNodeInput[]
        settings: RawNodeSetting[]
        cost: { by: 'flat' | 'width' | 'inputs' | 'octaves', values: number[] }
    }

    export interface RawConstants {
        [key: string]: unknown
        limits: Record<string, number>
        nodes: RawNode[]
        anchors: string[]
        signals: string[]
        capabilities: string[]
    }

    export interface RawDialectIssues {
        dialect: string
        issues: RawIssue[]
    }

    export interface RawTexture {
        width: number
        height: number
        rgba: Uint8Array
    }

    export interface RasterOptions {
        scale?: number
        seed?: bigint | number
        state?: number
        index?: number
        hidden?: number
        omit?: number | number[]
        band?: 'all' | 'under_text' | 'over_text' | number
        reactions?: Array<string | number> | number
        heldFor?: number | null
        observedFor?: number | null
        stopped?: Array<[string | number, number, number] | { signal: string | number, heldFor: number, ago: number }>
        oneShots?: Array<[string | number, number] | { index?: number, name?: string, age: number }>
        glyphs?: Float32Array | number[] | number[][]
        detail?: number
        motion?: number
        textures?: RasterTextures | null
    }

    export class RasterTextures {
        readonly engine: NameplateEngine
        handle: number
        set(name: string, width: number, height: number, rgba: Uint8Array | null): void
        remove(name: string): void
        free(): void
    }

    export interface RawMolangCheck {
        ok: boolean
        code?: string
        message?: string
        cost?: number
        warnings?: Array<{ kind: string, name: string }>
    }

    export interface TagRowInput {
        asset: number
        variant?: number
        flags?: number
        detail?: number
        lines?: number[]
        nameLine?: number
        align?: number
        nameX?: number
        nameWidth?: number
        prefixWidth?: number
        background?: [number, number, number, number]
        externalColor?: number
        sneakAlpha?: number
        glyphOffset?: number
        glyphCount?: number
        colorOffset?: number
        colorCount?: number
    }

    export const OUT: Readonly<Record<string, number>>
    export const FLAG_DISPLAY: number
    export const FLAG_OWN: number
    export const FLAG_ANIMATED_NAMES_OFF: number
    export const FLAG_EFFECTS_CPU: number
    export const FLAG_EFFECTS_OFF: number
    export const FLAG_EXTERNAL_COLOR: number
    export const FLAG_BADGE: number
    export const ALIGN_LEFT: number
    export const ALIGN_RIGHT: number
    export const ALIGN_CENTER: number
    export const DETAIL_FULL: number
    export const DETAIL_REDUCED: number
    export const DETAIL_MINIMAL: number
    export const MOTION_FULL: number
    export const MOTION_REDUCED: number
    export const MOTION_OFF: number
    export const GLYPH_HEIGHT: number
    export const SIGNALS: readonly string[]
    export const MOLANG_CONTEXTS: readonly string[]
    export const RASTER_IDLE: number
    export const RASTER_WHILE: number
    export const RASTER_ONE_SHOT: number
    export const TEXT_MODE_VANILLA: number
    export const TEXT_MODE_MOTION: number
    export const TEXT_MODE_OWNED: number
    export const RASTER_INFO: Readonly<Record<string, number>>

    export function startClock(): () => number
    export function blendPixel(source: number, destination: number, blend?: 'alpha' | 'additive'): number
    export function flattenRasterLayers<T extends Uint8ClampedArray = Uint8ClampedArray>(layers: ReadonlyArray<{ blend: 'alpha' | 'additive', data: Uint8ClampedArray | Uint8Array, passes?: ReadonlyArray<Uint8ClampedArray | Uint8Array> }>, into?: T): T
    export function tagRow(input: TagRowInput, row?: Int32Array): Int32Array
    export function storeZip(files: BundleFiles): Uint8Array

    export class NameplateAsset {
        readonly engine: NameplateEngine
        handle: number
        readonly status: number
        readonly kind: 'asset' | 'draft' | 'skipped' | 'invalid'
        readonly issues: RawIssue[]
        readonly skip: RawSkip | null
        readonly meta: RawMeta
        readonly usable: boolean
        shaders(dialect?: string | number): RawShaders
        dialectIssues(dialect?: string | number): RawDialectIssues
        oneShotIndex(shot: string | number): number
        variantIndex(variant: string | number): number
        paramCurve(layer: string, param: string, variant?: string | number, count?: number): number[]
        analyze(): RawAnalysis
        raster(row: Int32Array | TagRowInput, frame?: number, options?: RasterOptions): RawRaster
        rasterLayers(row: Int32Array | TagRowInput, frame?: number, options?: RasterOptions): RawRasterLayers
        textureCount(): number
        texture(index: number): RawTexture
        textures(): RawTexture[]
        free(): void
    }

    export class Nameplates {
        readonly engine: NameplateEngine
        handle: number
        addAsset(asset: NameplateAsset): number
        removeAsset(id: number): void
        setMotion(motion: number): void
        setVanillaTexture(name: string, width: number, height: number, rgba: Uint8Array | null): void
        forgetWearer(wearer: bigint | number): boolean
        setSignalOverride(wearer: bigint | number, signal: string | number, value: number): void
        fire(wearer: bigint | number, asset: number, oneShot: number): boolean
        stripLayout(): number
        stripTexels(id: number): Uint32Array
        wearerCount(): number
        wearerBytes(): number
        frame(clock: number, wearers: BigUint64Array | ArrayLike<bigint | number>, tags: Int32Array, signals: Float32Array, glyphs?: Float32Array, colors?: Int32Array): Int32Array
        free(): void
    }

    export class NameplateEngine {
        static create(source?: URL | string | ArrayBuffer | Uint8Array): Promise<NameplateEngine>
        constructor(wasm: WebAssembly.Exports)
        readonly wasm: WebAssembly.Exports
        load(source: BundleFiles | Uint8Array | ArrayBuffer, options?: LoadOptions): Promise<NameplateAsset>
        loadSync(source: BundleFiles | Uint8Array | ArrayBuffer, options?: LoadOptions): NameplateAsset
        constants(): RawConstants
        checkMolang(source: string, context?: string | number): RawMolangCheck
        nameplates(): Nameplates
        rasterTextures(): RasterTextures
        setRasterTexture(name: string, width: number, height: number, rgba: Uint8Array | null): void
    }

    export function section(out: Int32Array, tag: number): { offset: number, length: number, status: number }
    export function events(out: Int32Array, tag: number): Array<{ code: number, target: number }>
}

declare module '@plusrenderer/renderer/nameplate-gl.js' {
    import type { Nameplates } from '@plusrenderer/renderer/nameplate.js'

    export interface DrawContext {
        tag: number
        status: number
        mode: number
        color: number
        shadow: number
        shadowUse: number
        outline: number
        letterCount: number
        plate: [number, number]
        ownsBackground: boolean
        badge: { visible: boolean, x: number, y: number, opacity: number, tint: number, decorationKind: number, decorationRgb: number }
        row: Int32Array | null
    }

    export interface DrawTagOptions {
        assetId?: number
        row?: Int32Array | null
        transform?: { x?: number, y?: number, scale?: number }
        viewport?: [number, number]
        text?: (ctx: DrawContext) => void
        badge?: (ctx: DrawContext) => void
        background?: (ctx: DrawContext) => void
    }

    export class NameplateDrawer {
        constructor(gl: WebGL2RenderingContext, nameplates: Nameplates, options?: { light?: number[] })
        setLight(rgba: ArrayLike<number>): void
        setAssetShaders(assetId: number, shaders: unknown): void
        forgetAsset(assetId: number): void
        setVanillaTexture(name: string, source: TexImageSource | Uint8Array, width?: number, height?: number): void
        setTexture(key: string, source: TexImageSource | Uint8Array, width?: number, height?: number): void
        setAtlas(source: TexImageSource | Uint8Array, width: number, height: number, sprites: Record<string, ArrayLike<number>> | Map<string, ArrayLike<number>> | ((name: string) => ArrayLike<number> | null | undefined) | null): void
        setBundleTextures(assetId: number, images: Array<{ width: number, height: number, rgba: Uint8Array } | TexImageSource | null>): void
        drawTag(out: Int32Array, tag: number, options?: DrawTagOptions): number
        dispose(): void
    }
}

declare module '@plusrenderer/renderer/cosmetic.js' {
    import type { BundleFiles, LoadOptions, RawIssue } from '@plusrenderer/renderer/nameplate.js'

    export const KINDS: readonly string[]
    export const RIGS: readonly string[]
    export const RIG_VALUES: Readonly<Record<'player' | 'actor' | 'boat' | 'minecart' | 'horse', number>>
    export const STATUSES: readonly string[]
    export const ENGINE_CAPABILITIES: readonly string[]
    export const HOST_CAPABILITIES: readonly string[]
    export const AUTHORING_CAPABILITIES: readonly string[]
    export const NO_COLORWAY: number
    export const TEXTURE_INFO_INTS: number
    export const SECTION_INTS: number
    export const INPUT_LAYOUT_INTS: number
    export const SECTION_NAMES: readonly string[]
    export const INPUT_LAYOUT_NAMES: readonly string[]

    export interface RendererExports {
        readonly memory: WebAssembly.Memory
        alloc(len: number): number
        dealloc(ptr: number, len: number): void
        renderer_new(): number
        renderer_free(r: number): void
        renderer_error(r: number): number
        renderer_error_len(r: number): number
        renderer_set_rig(r: number, kind: number): number
        renderer_set_physics(r: number, mode: number, own: bigint): number
        renderer_load_asset(r: number, slot: number, asset: number): number
        renderer_load_emote(r: number, slot: number, props: number, asset: number): number
        renderer_load_player(r: number, slot: number, slim: number): void
        renderer_has_effects(r: number): number
        renderer_effect_geometry(r: number, view: number, viewLen: number, out: number, outLen: number): number
        renderer_sample_effect_rings(r: number, view: number, viewLen: number): number
        renderer_effect_texture_count(r: number): number
        renderer_effect_texture(r: number, id: number, slotOut: number, pathOut: number, pathLen: number): number
        renderer_play(r: number, slot: number, at: number): void
        renderer_play_f64(r: number, slot: number, at: number): void
        renderer_stop(r: number, slot: number): void
        renderer_forget_wearer(r: number, wearer: bigint): number
        renderer_break_rings(r: number, wearer: bigint): number
        renderer_set_signal_override(r: number, wearer: bigint, signal: number, value: number): number
        renderer_fire_effect(r: number, wearer: bigint, name: number, nameLen: number): number
        renderer_effect_events(r: number, out: number, outLen: number): number
        renderer_effect_event_floats(r: number, out: number, outLen: number): number
        renderer_host_variable_id(r: number, name: number, nameLen: number): number
        renderer_output_layout(r: number, sections: number, sectionsLen: number, out: number, outLen: number): number
        renderer_frame_wearers_shaped(r: number, clock: number, wearers: number, wearerCount: number, sections: number, sectionsLen: number, input: number, inputLen: number, space: number, out: number, outLen: number): number
    }

    export type CosmeticStatus = 'asset' | 'draft' | 'skipped' | 'invalid' | 'legacy'

    export interface RawCosmeticReaction {
        signal: string | null
        signal_index: number
        on: 'start' | 'stop' | 'while' | 'appear' | 'equip'
        play: string | null
        restart: boolean
        blend: number
        speed: number | null
        colorway: string | null
        effect: string | null
    }

    export interface RawCosmeticMeta {
        id: string
        identity: string
        kind: string
        requires: string[]
        attach: { rig: string, bone: string | null, replaces: string | null, anchor: string | null }
        model: { identifier: string, bones: number, locators: string[] } | null
        textures: Array<{ name: string, width: number, height: number, indexed: boolean }>
        palette: { slots: Array<{ id: string, name: string, customizable: boolean }>, colorways: string[] }
        animations: string[]
        controllers: string[]
        reactions: RawCosmeticReaction[]
        spring_bones: number
        effects: {
            particles: Array<{ id: string, texture: string }>
            sounds: Array<{ id: string, file: string | null, vanilla: string | null, volume: number, pitch: number }>
            emitters: number
            trails: Array<{ texture: string }>
            named: string[]
            moments?: Array<{ name: string, clip: number | null, seconds: number }>
            locators: string[]
        }
        pet: { archetype: string, leash_radius: number, scale: number, anchor: string | null, controllers: string[], interactions: Record<string, Array<'a' | 'b'>> } | null
        roles: Array<{ id: string, interaction?: string, animation: string | null, offset: [number, number, number], yaw: number }>
        rules: Record<string, boolean> | null
        requirement?: string
        fallback?: string | null
        main?: string | null
    }

    export interface RawCosmeticAnalysis {
        requires: string[]
        quads: number
        bones: number
        spring_bones: number
        live_particles: number
        trail_points: number
        record_bytes: number
        texture_bytes: number
    }

    export class CosmeticAsset {
        readonly handle: number
        readonly status: CosmeticStatus
        readonly issues: RawIssue[]
        readonly skip: { format?: number, requires?: string[] } | null
        readonly legacy: { files: string[] } | null
        readonly usable: boolean
        meta(): RawCosmeticMeta | null
        analyze(): RawCosmeticAnalysis | null
        textureCount(): number
        textureInfo(index: number): { width: number, height: number, indexed: boolean, bytes: number }
        resolveTexture(index: number, options?: { colorway?: number, custom?: Array<[number, number]> | Map<number, number> }): Uint8Array
        textureKey(index: number, options?: { colorway?: number, custom?: Array<[number, number]> | Map<number, number> }): bigint
        live(): number
        free(): void
    }

    export class CosmeticEngine {
        static create(source?: URL | string | ArrayBuffer | Uint8Array): Promise<CosmeticEngine>
        constructor(wasm: WebAssembly.Exports)
        readonly wasm: WebAssembly.Exports
        parse(source: BundleFiles | Uint8Array | ArrayBuffer, options?: LoadOptions): CosmeticAsset
        constants(): { limits: Record<string, number> }
        inputLayout(sections: Record<string, number | boolean> | ArrayLike<number>): Record<string, number>
        pairSeed(a: bigint | number, b: bigint | number, minute: number): bigint
        actorWearer(owner: bigint | number, slot: number): bigint
        eventWearer(owner: bigint | number, event: number, seq: number, nonce?: number): bigint
    }

    export function parseCosmetic(engine: CosmeticEngine | { wasm: WebAssembly.Exports } | WebAssembly.Exports, source: BundleFiles | Uint8Array | ArrayBuffer, options?: LoadOptions): CosmeticAsset
}
