import { CosmeticAsset, RawCosmeticMeta, RendererExports, RIG_VALUES, SECTION_NAMES } from '@plusrenderer/renderer/cosmetic.js'
import { deflateZip } from '../util/zip'
import { cosmeticCapabilities, cosmeticEngineNow } from './cosmetic'
import { AFFINE_FLOATS, combatOverride, COMBAT_SIGNAL, IDENTITY, QUAD_FLOATS, VIEW_FLOATS } from './cosmeticDriver'

const PHYSICS_ON = 0
const PLAYER_SLOT = 0
const PROPS_SLOT = 1
const WIDE_ARMS = 0
const PREVIEW_IDENTITY = 1
const LAYOUT_INTS = 12
const LAYOUT_EMOTE = 10
const LAYOUT_EMOTE_AT = 11
const NO_CLIP = -1
const SECTIONS = { parts: 0, queries: 0, root: true, variables: 0, play: true, role: true, colorway: false, part_deltas: false, hold: true }

export const PLAYER_BONES: readonly string[] = Object.freeze(['root', 'body', 'jacket', 'head', 'hat', 'rightArm', 'rightSleeve', 'leftArm', 'leftSleeve', 'rightLeg', 'rightPants', 'leftLeg', 'leftPants'])

export interface EmoteActor {
    role: number
    anchor: readonly [number, number, number]
    yaw: number
    age?: number
    held?: boolean
    stopped?: boolean
    root?: ArrayLike<number>
}

interface Buffer {
    ptr: number
    bytes: number
}

function sectionInts(): Int32Array {
    return Int32Array.from(SECTION_NAMES, (name) => {
        const value = (SECTIONS as Record<string, number | boolean>)[name]
        return typeof value === 'boolean' ? Number(value) : value ?? 0
    })
}

export class EmoteDriver {
    readonly bones: number
    readonly meta: RawCosmeticMeta
    private disposed = false
    private readonly buffers: Buffer[] = []
    private readonly sections: Buffer
    private readonly inputLength: number
    private readonly outputLength: number
    private readonly rootAt: number
    private readonly playAt: number
    private readonly roleAt: number
    private readonly holdAt: number
    private readonly statusAt: number
    private readonly signalsAt: number
    private readonly signalCount: number
    private wearers: Buffer | null = null
    private input: Buffer | null = null
    private output: Buffer | null = null
    private capacity = 0
    private shownStatuses: number[] = []
    private view: Buffer | null = null
    private quads: Buffer | null = null

    private constructor(private readonly wasm: RendererExports, private readonly renderer: number, private readonly asset: CosmeticAsset, meta: RawCosmeticMeta, layout: Record<string, number>, private readonly signalNames: readonly string[]) {
        this.meta = meta
        const ints = sectionInts()
        this.sections = this.alloc(ints.byteLength)
        new Int32Array(wasm.memory.buffer, this.sections.ptr, ints.length).set(ints)
        const shape = this.alloc(LAYOUT_INTS * 4)
        const stride = wasm.renderer_output_layout(renderer, this.sections.ptr, ints.length, shape.ptr, LAYOUT_INTS)
        if (stride < 0) throw new Error(this.error())
        const shaped = new Int32Array(wasm.memory.buffer, shape.ptr, LAYOUT_INTS)
        this.bones = shaped[0]
        this.statusAt = shaped[LAYOUT_EMOTE] ? shaped[LAYOUT_EMOTE_AT] : -1
        this.outputLength = stride
        this.inputLength = layout.stride
        this.rootAt = layout.root_at
        this.playAt = layout.play_at
        this.roleAt = layout.role_at
        this.holdAt = layout.hold_at ?? -1
        this.signalsAt = layout.signals
        this.signalCount = Math.max(0, layout.events - layout.signals)
    }

    static open(files: Record<string, string>, binary: Record<string, Uint8Array>, signalNames: readonly string[] = []): EmoteDriver | null {
        const engine = cosmeticEngineNow()
        if (!engine) return null
        const wasm = engine.wasm as unknown as RendererExports
        const asset = engine.parse(deflateZip({ ...files, ...binary }), { mode: 'authoring', capabilities: cosmeticCapabilities(), identity: PREVIEW_IDENTITY })
        const meta = asset.usable ? asset.meta() : null
        if (!meta || meta.kind !== 'emote') {
            asset.free()
            return null
        }
        const renderer = wasm.renderer_new()
        try {
            const fail = (code: number) => {
                if (code < 0) throw new Error(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.renderer_error(renderer), wasm.renderer_error_len(renderer))))
            }
            fail(wasm.renderer_set_rig(renderer, RIG_VALUES.player))
            fail(wasm.renderer_set_physics(renderer, PHYSICS_ON, 1n))
            wasm.renderer_load_player(renderer, PLAYER_SLOT, WIDE_ARMS)
            fail(wasm.renderer_load_emote(renderer, PLAYER_SLOT, PROPS_SLOT, asset.live()))
            return new EmoteDriver(wasm, renderer, asset, meta, engine.inputLayout(SECTIONS), signalNames)
        } catch (error) {
            wasm.renderer_free(renderer)
            asset.free()
            throw error
        }
    }

    get isDisposed(): boolean {
        return this.disposed
    }

    get statuses(): readonly number[] {
        return this.shownStatuses
    }

    frame(clock: number, age: number, actors: readonly EmoteActor[], signals: Readonly<Record<string, number>> = {}): Float32Array[] {
        if (this.disposed) throw new Error('This preview was closed. Open it again.')
        this.reserve(actors.length)
        const wasm = this.wasm
        const combat = this.signalNames.indexOf(COMBAT_SIGNAL)
        actors.forEach((_, i) => {
            if (combatOverride(wasm, this.renderer, BigInt(i + 1), combat < this.signalCount ? combat : -1, signals) < 0) throw new Error(this.error())
        })
        const memory = wasm.memory.buffer
        const ids = new BigUint64Array(memory, this.wearers!.ptr, actors.length)
        const rows = new Float32Array(memory, this.input!.ptr, this.inputLength * actors.length)
        rows.fill(0)
        actors.forEach((actor, i) => {
            ids[i] = BigInt(i + 1)
            const at = i * this.inputLength
            this.signalNames.forEach((name, k) => {
                if (k < this.signalCount) rows[at + this.signalsAt + k] = Number(signals[name] ?? 0) || 0
            })
            for (let k = 0; k < AFFINE_FLOATS; k++) rows[at + this.rootAt + k] = Number(actor.root?.[k] ?? IDENTITY[k])
            rows[at + this.playAt] = actor.stopped ? NO_CLIP : 0
            rows[at + this.playAt + 1] = actor.age ?? age
            rows[at + this.roleAt] = actor.role
            rows[at + this.roleAt + 1] = actor.anchor[0]
            rows[at + this.roleAt + 2] = actor.anchor[1]
            rows[at + this.roleAt + 3] = actor.anchor[2]
            rows[at + this.roleAt + 4] = actor.yaw
            if (this.holdAt >= 0) rows[at + this.holdAt] = actor.held ? 1 : 0
        })
        const bones = wasm.renderer_frame_wearers_shaped(this.renderer, clock, this.wearers!.ptr, actors.length, this.sections.ptr, SECTION_NAMES.length, this.input!.ptr, this.inputLength * actors.length, 0, this.output!.ptr, this.outputLength * actors.length)
        if (bones < 0) throw new Error(this.error())
        const out = new Float32Array(wasm.memory.buffer, this.output!.ptr, this.outputLength * actors.length)
        this.shownStatuses = actors.map((_, i) => (this.statusAt >= 0 ? Math.trunc(out[i * this.outputLength + this.statusAt]) : 0))
        return actors.map((_, i) => out.slice(i * this.outputLength, i * this.outputLength + this.bones * AFFINE_FLOATS))
    }

    hasEffects(): boolean {
        return !this.disposed && this.wasm.renderer_has_effects(this.renderer) !== 0
    }

    sampleEffectRings(view: ArrayLike<number>) {
        if (!this.hasEffects()) return
        if (this.wasm.renderer_sample_effect_rings(this.renderer, this.setView(view), VIEW_FLOATS) < 0) throw new Error(this.error())
    }

    effects(view: ArrayLike<number>): Float32Array {
        if (this.disposed) return new Float32Array(0)
        const wasm = this.wasm
        const at = this.setView(view)
        const needed = wasm.renderer_effect_geometry(this.renderer, at, VIEW_FLOATS, 0, 0)
        if (needed < 0) throw new Error(this.error())
        if (needed === 0) return new Float32Array(0)
        if (!this.quads || this.quads.bytes < needed * QUAD_FLOATS * 4) {
            if (this.quads) this.free(this.quads)
            this.quads = this.alloc(needed * QUAD_FLOATS * 4 * 2)
        }
        const count = wasm.renderer_effect_geometry(this.renderer, at, VIEW_FLOATS, this.quads.ptr, this.quads.bytes / 4)
        if (count < 0) throw new Error(this.error())
        return new Float32Array(wasm.memory.buffer, this.quads.ptr, count * QUAD_FLOATS).slice()
    }

    effectTexture(id: number): string | null {
        if (this.disposed) return null
        const wasm = this.wasm
        const length = wasm.renderer_effect_texture(this.renderer, id, 0, 0, 0)
        if (length < 0) return null
        const text = this.alloc(length)
        try {
            wasm.renderer_effect_texture(this.renderer, id, 0, text.ptr, length)
            return new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, text.ptr, length))
        } finally {
            this.free(text)
        }
    }

    reset() {
        if (this.disposed) return
        for (let i = 0; i < this.capacity; i++) this.wasm.renderer_forget_wearer(this.renderer, BigInt(i + 1))
    }

    dispose() {
        if (this.disposed) return
        this.disposed = true
        for (const buffer of this.buffers.splice(0)) this.wasm.dealloc(buffer.ptr, buffer.bytes)
        this.wasm.renderer_free(this.renderer)
        this.asset.free()
    }

    private reserve(count: number) {
        if (count <= this.capacity) return
        for (const buffer of [this.wearers, this.input, this.output]) {
            if (!buffer) continue
            this.wasm.dealloc(buffer.ptr, buffer.bytes)
            this.buffers.splice(this.buffers.indexOf(buffer), 1)
        }
        this.wearers = this.alloc(count * 8)
        this.input = this.alloc(count * Math.max(1, this.inputLength) * 4)
        this.output = this.alloc(count * Math.max(1, this.outputLength) * 4)
        this.capacity = count
    }

    private setView(view: ArrayLike<number>): number {
        this.view ??= this.alloc(VIEW_FLOATS * 4)
        new Float32Array(this.wasm.memory.buffer, this.view.ptr, VIEW_FLOATS).set(Array.from({ length: VIEW_FLOATS }, (_, i) => Number(view[i]) || 0))
        return this.view.ptr
    }

    private free(buffer: Buffer) {
        this.wasm.dealloc(buffer.ptr, buffer.bytes)
        this.buffers.splice(this.buffers.indexOf(buffer), 1)
    }

    private alloc(bytes: number): Buffer {
        const buffer = { ptr: this.wasm.alloc(Math.max(1, bytes)), bytes: Math.max(1, bytes) }
        this.buffers.push(buffer)
        return buffer
    }

    private error(): string {
        const wasm = this.wasm
        return new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.renderer_error(this.renderer), wasm.renderer_error_len(this.renderer)))
    }
}
