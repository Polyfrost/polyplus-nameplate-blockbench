import { CosmeticAsset, RendererExports, RIG_VALUES, SECTION_NAMES } from '@plusrenderer/renderer/cosmetic.js'
import { deflateZip } from '../util/zip'
import { cosmeticCapabilities, cosmeticEngineNow } from './cosmetic'

export const AFFINE_FLOATS = 12
export const QUAD_FLOATS = 27
export const VIEW_FLOATS = 12
export const EVENT_JUMP = 1 << 6
export const EVENT_EQUIP = 1 << 7
export const IDENTITY: readonly number[] = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0])

const PHYSICS_ON = 0
const PREVIEW_WEARER = 1n
const PREVIEW_IDENTITY = 1
const NO_PLAY = -1
const LAYOUT_INTS = 12
const EFFECT_EVENT_INTS = 6
const EFFECT_EVENT_FLOATS = 5
const EFFECT_SOUND = 1
export const COMBAT_SIGNAL = 'is_in_combat'
const SECTIONS = { parts: 0, queries: 0, root: true, variables: 0, play: false, role: false, colorway: true, part_deltas: false }

export interface DriverRole {
    index: number
    anchor: readonly [number, number, number]
    yaw: number
    age: number
}

export interface DriverPlay {
    clip: number
    age: number
}

export interface DriverInput {
    signals: Readonly<Record<string, number>>
    variables?: Readonly<Record<string, number>>
    events: number
    root: ArrayLike<number>
    role?: DriverRole
    play?: DriverPlay | null
}

export interface DriverSound {
    wearer: number
    sound: number
    at: [number, number, number]
    volume: number
    pitch: number
}

export interface DriverMoment {
    name: string
    clip: number | null
    seconds: number
}

export function combatOverride(wasm: Pick<RendererExports, 'renderer_set_signal_override'>, renderer: number, wearer: bigint, signal: number, signals: Readonly<Record<string, number>>): number {
    if (signal < 0) return 0
    return wasm.renderer_set_signal_override(renderer, wearer, signal, Number(signals[COMBAT_SIGNAL]) ? 1 : 0)
}

export interface DriverTexture {
    name: string
    width: number
    height: number
    rgba: Uint8Array
}

export interface DriverFrame {
    bones: Float32Array
    colorway: number
}

interface Buffer {
    ptr: number
    bytes: number
}

function sectionInts(sections: Record<string, number | boolean>): Int32Array {
    return Int32Array.from(SECTION_NAMES, (name) => {
        const value = sections[name]
        return typeof value === 'boolean' ? Number(value) : value ?? 0
    })
}

export class CosmeticDriver {
    readonly bones: number
    readonly rig: string
    private disposed = false
    private readonly buffers: Buffer[] = []
    private readonly sections: Buffer
    private wearer: Buffer | null = null
    private input: Buffer | null = null
    private output: Buffer | null = null
    private capacity = 0
    private readonly view: Buffer
    private quads: Buffer | null = null
    private readonly inputLength: number
    private readonly outputLength: number
    private readonly signalsAt: number
    private readonly eventsAt: number
    private readonly rootAt: number
    private readonly variablesAt: number
    private readonly variableCount: number
    private readonly colorwayAt: number
    private readonly playAt: number
    private readonly roleAt: number
    private readonly signalNames: readonly string[]
    private readonly combatAt: number
    private readonly variableIds: ReadonlyMap<string, number>

    private constructor(private readonly wasm: RendererExports, private readonly renderer: number, private readonly asset: CosmeticAsset, rig: string, signalNames: readonly string[], variableIds: ReadonlyMap<string, number>, sections: Record<string, number | boolean>, layout: Record<string, number>) {
        this.rig = rig
        this.signalNames = signalNames
        this.combatAt = signalNames.indexOf(COMBAT_SIGNAL)
        this.variableIds = variableIds
        const ints = sectionInts(sections)
        this.sections = this.alloc(ints.byteLength)
        new Int32Array(wasm.memory.buffer, this.sections.ptr, ints.length).set(ints)
        const shape = this.alloc(LAYOUT_INTS * 4)
        const stride = wasm.renderer_output_layout(renderer, this.sections.ptr, ints.length, shape.ptr, LAYOUT_INTS)
        if (stride < 0) throw new Error(this.error())
        const out = new Int32Array(wasm.memory.buffer, shape.ptr, LAYOUT_INTS).slice()
        this.bones = out[0]
        this.colorwayAt = out[3] ? out[7] : -1
        this.outputLength = stride
        this.inputLength = layout.stride
        this.signalsAt = layout.signals
        this.eventsAt = layout.events
        this.rootAt = layout.root_at
        this.variablesAt = layout.variables_at
        this.variableCount = Number(sections.variables) || 0
        this.playAt = sections.play ? layout.play_at : -1
        this.roleAt = sections.role ? layout.role_at : -1
        this.view = this.alloc(VIEW_FLOATS * 4)
        this.reserve(1)
    }

    static open(files: Record<string, string>, binary: Record<string, Uint8Array>, signalNames: readonly string[], hostVariables: readonly string[] = [], roles = false): CosmeticDriver | null {
        const engine = cosmeticEngineNow()
        if (!engine) return null
        const wasm = engine.wasm as unknown as RendererExports
        const asset = engine.parse(deflateZip({ ...files, ...binary }), { mode: 'authoring', capabilities: cosmeticCapabilities(), identity: PREVIEW_IDENTITY })
        if (!asset.usable) {
            asset.free()
            return null
        }
        const renderer = wasm.renderer_new()
        try {
            const rig = asset.meta()?.attach.rig ?? 'player'
            const rigValue = RIG_VALUES[rig as keyof typeof RIG_VALUES] ?? RIG_VALUES.player
            const fail = (code: number) => {
                if (code < 0) throw new Error(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.renderer_error(renderer), wasm.renderer_error_len(renderer))))
            }
            fail(wasm.renderer_set_rig(renderer, rigValue))
            fail(wasm.renderer_set_physics(renderer, PHYSICS_ON, PREVIEW_WEARER))
            fail(wasm.renderer_load_asset(renderer, 0, asset.live()))
            const variableIds = new Map<string, number>()
            for (const name of new Set(hostVariables)) {
                const bytes = new TextEncoder().encode(name)
                const at = wasm.alloc(Math.max(1, bytes.length))
                try {
                    new Uint8Array(wasm.memory.buffer, at, bytes.length).set(bytes)
                    const id = wasm.renderer_host_variable_id(renderer, at, bytes.length)
                    fail(id)
                    variableIds.set(name, id)
                } finally {
                    wasm.dealloc(at, Math.max(1, bytes.length))
                }
            }
            const meta = asset.meta()
            const moments = meta?.kind !== 'emote' && (meta?.effects.moments?.length ?? 0) > 0
            const sections = { ...SECTIONS, play: roles || moments, role: roles, variables: variableIds.size ? Math.max(...variableIds.values()) + 1 : 0 }
            const layout = engine.inputLayout(sections)
            return new CosmeticDriver(wasm, renderer, asset, rig, signalNames, variableIds, sections, layout)
        } catch (error) {
            wasm.renderer_free(renderer)
            asset.free()
            throw error
        }
    }

    get isDisposed(): boolean {
        return this.disposed
    }

    signalCount(): number {
        return this.eventsAt - this.signalsAt
    }

    get playsRoles(): boolean {
        return this.playAt >= 0 && this.roleAt >= 0
    }

    frame(clock: number, input: DriverInput): DriverFrame {
        return this.frameAll(clock, [input])[0]
    }

    frameAll(clock: number, inputs: readonly DriverInput[]): DriverFrame[] {
        if (this.disposed) throw new Error('This preview was closed. Open it again.')
        if (!inputs.length) return []
        this.reserve(inputs.length)
        const wasm = this.wasm
        const count = this.signalCount()
        const combat = this.combatAt < count ? this.combatAt : -1
        inputs.forEach((input, w) => {
            if (combatOverride(wasm, this.renderer, PREVIEW_WEARER + BigInt(w), combat, input.signals) < 0) throw new Error(this.error())
        })
        const memory = wasm.memory.buffer
        const ids = new BigUint64Array(memory, this.wearer!.ptr, inputs.length)
        const rows = new Float32Array(memory, this.input!.ptr, this.inputLength * inputs.length)
        rows.fill(0)
        inputs.forEach((input, w) => {
            ids[w] = PREVIEW_WEARER + BigInt(w)
            const at = w * this.inputLength
            this.signalNames.forEach((name, i) => {
                if (i < count) rows[at + this.signalsAt + i] = Number(input.signals[name] ?? 0) || 0
            })
            rows[at + this.eventsAt] = input.events >>> 0
            for (const [name, id] of this.variableIds) {
                if (id < this.variableCount) rows[at + this.variablesAt + id] = Number(input.variables?.[name] ?? 0) || 0
            }
            for (let i = 0; i < AFFINE_FLOATS; i++) rows[at + this.rootAt + i] = Number(input.root[i] ?? IDENTITY[i])
            const role = input.role
            if (role && this.playsRoles) {
                rows[at + this.playAt] = 0
                rows[at + this.playAt + 1] = role.age
                rows[at + this.roleAt] = role.index
                rows[at + this.roleAt + 1] = role.anchor[0]
                rows[at + this.roleAt + 2] = role.anchor[1]
                rows[at + this.roleAt + 3] = role.anchor[2]
                rows[at + this.roleAt + 4] = role.yaw
            } else if (this.playAt >= 0) {
                rows[at + this.playAt] = input.play ? input.play.clip : NO_PLAY
                rows[at + this.playAt + 1] = input.play ? input.play.age : 0
                if (this.roleAt >= 0) rows[at + this.roleAt] = NO_PLAY
            }
        })
        const bones = wasm.renderer_frame_wearers_shaped(this.renderer, clock, this.wearer!.ptr, inputs.length, this.sections.ptr, SECTION_NAMES.length, this.input!.ptr, this.inputLength * inputs.length, 0, this.output!.ptr, this.outputLength * inputs.length)
        if (bones < 0) throw new Error(this.error())
        const out = new Float32Array(wasm.memory.buffer, this.output!.ptr, this.outputLength * inputs.length)
        return inputs.map((_, w) => {
            const at = w * this.outputLength
            return {
                bones: out.slice(at, at + this.bones * AFFINE_FLOATS),
                colorway: this.colorwayAt >= 0 ? Math.round(out[at + this.colorwayAt]) : -1,
            }
        })
    }

    textureNames(): string[] {
        if (this.disposed) return []
        return (this.asset.meta()?.textures ?? []).map((texture) => texture.name)
    }

    texture(index: number, colorway: number): DriverTexture | null {
        if (this.disposed) return null
        const info = this.asset.meta()?.textures[index]
        if (!info) return null
        return { name: info.name, width: info.width, height: info.height, rgba: this.asset.resolveTexture(index, { colorway }) }
    }

    namedEffects(): string[] {
        if (this.disposed) return []
        return (this.asset.meta()?.effects.named ?? []).slice()
    }

    moments(): DriverMoment[] {
        if (this.disposed) return []
        return (this.asset.meta()?.effects.moments ?? []).map((moment) => ({ ...moment }))
    }

    get playsMoments(): boolean {
        return this.playAt >= 0 && !this.playsRoles
    }

    fireEffect(name: string, wearer = 0): boolean {
        if (this.disposed) return false
        const bytes = new TextEncoder().encode(name)
        const text = this.alloc(bytes.length)
        try {
            new Uint8Array(this.wasm.memory.buffer, text.ptr, bytes.length).set(bytes)
            const fired = this.wasm.renderer_fire_effect(this.renderer, PREVIEW_WEARER + BigInt(wearer), text.ptr, bytes.length)
            if (fired < 0) throw new Error(this.error())
            return fired > 0
        } finally {
            this.wasm.dealloc(text.ptr, text.bytes)
            this.buffers.splice(this.buffers.indexOf(text), 1)
        }
    }

    soundFile(index: number): string | null {
        if (this.disposed) return null
        return this.asset.meta()?.effects.sounds[index]?.file ?? null
    }

    soundVanilla(index: number): string | null {
        if (this.disposed) return null
        return this.asset.meta()?.effects.sounds[index]?.vanilla ?? null
    }

    soundEvents(): DriverSound[] {
        if (this.disposed) return []
        const wasm = this.wasm
        const count = wasm.renderer_effect_events(this.renderer, 0, 0)
        if (count <= 0) return []
        const ints = this.alloc(count * EFFECT_EVENT_INTS * 4)
        const floats = this.alloc(count * EFFECT_EVENT_FLOATS * 4)
        try {
            wasm.renderer_effect_events(this.renderer, ints.ptr, count * EFFECT_EVENT_INTS)
            wasm.renderer_effect_event_floats(this.renderer, floats.ptr, count * EFFECT_EVENT_FLOATS)
            const event = new Uint32Array(wasm.memory.buffer, ints.ptr, count * EFFECT_EVENT_INTS)
            const value = new Float32Array(wasm.memory.buffer, floats.ptr, count * EFFECT_EVENT_FLOATS)
            const sounds: DriverSound[] = []
            for (let i = 0; i < count; i++) {
                const e = i * EFFECT_EVENT_INTS
                if (event[e + 4] !== EFFECT_SOUND) continue
                const f = i * EFFECT_EVENT_FLOATS
                sounds.push({ wearer: event[e], sound: event[e + 5], at: [value[f], value[f + 1], value[f + 2]], volume: value[f + 3], pitch: value[f + 4] })
            }
            return sounds
        } finally {
            for (const buffer of [ints, floats]) {
                wasm.dealloc(buffer.ptr, buffer.bytes)
                this.buffers.splice(this.buffers.indexOf(buffer), 1)
            }
        }
    }

    hasEffects(): boolean {
        return !this.disposed && this.wasm.renderer_has_effects(this.renderer) !== 0
    }

    sampleEffectRings(view: ArrayLike<number>) {
        if (!this.hasEffects()) return
        this.setView(view)
        if (this.wasm.renderer_sample_effect_rings(this.renderer, this.view.ptr, VIEW_FLOATS) < 0) throw new Error(this.error())
    }

    effects(view: ArrayLike<number>): Float32Array {
        if (this.disposed) return new Float32Array(0)
        const wasm = this.wasm
        this.setView(view)
        const needed = wasm.renderer_effect_geometry(this.renderer, this.view.ptr, VIEW_FLOATS, 0, 0)
        if (needed < 0) throw new Error(this.error())
        if (needed === 0) return new Float32Array(0)
        if (!this.quads || this.quads.bytes < needed * QUAD_FLOATS * 4) {
            if (this.quads) {
                wasm.dealloc(this.quads.ptr, this.quads.bytes)
                this.buffers.splice(this.buffers.indexOf(this.quads), 1)
            }
            this.quads = this.alloc(needed * QUAD_FLOATS * 4 * 2)
        }
        const count = wasm.renderer_effect_geometry(this.renderer, this.view.ptr, VIEW_FLOATS, this.quads.ptr, this.quads.bytes / 4)
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
            wasm.dealloc(text.ptr, text.bytes)
            this.buffers.splice(this.buffers.indexOf(text), 1)
        }
    }

    play(clock: number) {
        if (!this.disposed) this.wasm.renderer_play_f64(this.renderer, 0, clock)
    }

    reset() {
        if (this.disposed) return
        for (let w = 0; w < this.capacity; w++) this.wasm.renderer_forget_wearer(this.renderer, PREVIEW_WEARER + BigInt(w))
    }

    breakRings(): boolean {
        if (this.disposed) return false
        let broke = false
        for (let w = 0; w < this.capacity; w++) if (this.wasm.renderer_break_rings(this.renderer, PREVIEW_WEARER + BigInt(w)) !== 0) broke = true
        return broke
    }

    dispose() {
        if (this.disposed) return
        this.disposed = true
        for (const buffer of this.buffers.splice(0)) this.wasm.dealloc(buffer.ptr, buffer.bytes)
        this.wasm.renderer_free(this.renderer)
        this.asset.free()
    }

    private setView(view: ArrayLike<number>) {
        new Float32Array(this.wasm.memory.buffer, this.view.ptr, VIEW_FLOATS).set(Array.from({ length: VIEW_FLOATS }, (_, i) => Number(view[i]) || 0))
    }

    private reserve(count: number) {
        if (count <= this.capacity) return
        for (const buffer of [this.wearer, this.input, this.output]) {
            if (!buffer) continue
            this.wasm.dealloc(buffer.ptr, buffer.bytes)
            this.buffers.splice(this.buffers.indexOf(buffer), 1)
        }
        this.wearer = this.alloc(count * 8)
        this.input = this.alloc(count * Math.max(1, this.inputLength) * 4)
        this.output = this.alloc(count * Math.max(1, this.outputLength) * 4)
        this.capacity = count
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
