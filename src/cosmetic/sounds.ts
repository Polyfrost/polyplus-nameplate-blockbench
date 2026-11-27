import type { DriverSound } from '../engine'
import { createListenerSet } from '../util/events'

export const soundUi = { muted: false, note: '' }

const MAX_VOLUME = 4
const MIN_PITCH = 0.1
const MAX_PITCH = 4

const listeners = createListenerSet('a sound listener failed')
const open = new Set<PreviewSounds>()

export interface SoundOutput {
    decode(bytes: Uint8Array): Promise<unknown>
    play(buffer: unknown, volume: number, pitch: number): void
    stop(): void
}

export interface SoundSource {
    soundFile(index: number): string | null
    soundVanilla?(index: number): string | null
}

export interface ChannelBuffer {
    readonly numberOfChannels: number
    readonly length: number
    readonly sampleRate: number
    getChannelData(channel: number): Float32Array
}

export function onSoundChange(listener: () => void): () => void {
    return listeners.on(listener)
}

export function setSoundMuted(muted: boolean) {
    soundUi.muted = muted
    if (muted) for (const sounds of open) sounds.stop()
    listeners.notify()
}

export function downmix<B extends ChannelBuffer>(buffer: B, create: (channels: number, length: number, rate: number) => B): B {
    if (buffer.numberOfChannels !== 2) return buffer
    const left = buffer.getChannelData(0)
    const right = buffer.getChannelData(1)
    const mono = create(1, buffer.length, buffer.sampleRate)
    const out = mono.getChannelData(0)
    for (let i = 0; i < out.length; i++) out[i] = (left[i] + right[i]) / 2
    return mono
}

let context: AudioContext | null = null

function audioContext(): AudioContext | null {
    if (context) return context
    const Context = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext
    if (typeof Context !== 'function') return null
    try {
        context = new Context() as AudioContext
    } catch {
        return null
    }
    return context
}

export function webAudio(): SoundOutput | null {
    if (!audioContext()) return null
    const active = new Set<AudioBufferSourceNode>()
    return {
        async decode(bytes) {
            const audio = audioContext()
            if (!audio) return null
            const decoded = await audio.decodeAudioData(bytes.slice().buffer)
            return downmix(decoded, (channels, length, rate) => audio.createBuffer(channels, length, rate))
        },
        play(buffer, volume, pitch) {
            const audio = audioContext()
            if (!audio) return
            if (audio.state === 'suspended') void audio.resume().catch(() => {})
            const source = audio.createBufferSource()
            source.buffer = buffer as AudioBuffer
            source.playbackRate.value = pitch
            const gain = audio.createGain()
            gain.gain.value = volume
            source.connect(gain).connect(audio.destination)
            active.add(source)
            source.onended = () => {
                active.delete(source)
                source.disconnect()
                gain.disconnect()
            }
            source.start()
        },
        stop() {
            for (const source of Array.from(active)) {
                try {
                    source.stop()
                } catch {
                    active.delete(source)
                }
            }
        },
    }
}

function clamp(value: number, min: number, max: number, fallback: number): number {
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

function noteText(): string {
    const names = new Set<string>()
    for (const sounds of open) for (const name of sounds.vanillaSkipped) names.add(name)
    if (!names.size) return ''
    const list = Array.from(names)
    const one = list.length === 1
    return `The preview can't play Minecraft sounds, so ${list.join(', ')} ${one ? 'is' : 'are'} silent here. ${one ? 'It plays' : 'They play'} in the game.`
}

function refreshNote() {
    const note = noteText()
    if (note === soundUi.note) return
    soundUi.note = note
    listeners.notify()
}

export class PreviewSounds {
    private readonly decoded = new Map<string, Promise<unknown>>()
    private readonly skipped = new Set<string>()
    private disposed = false

    constructor(private readonly binary: Readonly<Record<string, Uint8Array>>, private readonly output: SoundOutput | null = webAudio()) {
        open.add(this)
        for (const file of Object.keys(binary)) if (file.startsWith('sounds/')) this.buffer(file)
    }

    get vanillaSkipped(): readonly string[] {
        return Array.from(this.skipped)
    }

    play(source: SoundSource, events: readonly DriverSound[]) {
        const output = this.output
        if (this.disposed || soundUi.muted || !output) return
        for (const event of events) {
            const file = source.soundFile(event.sound)
            if (!file) {
                const vanilla = source.soundVanilla?.(event.sound)
                if (vanilla && !this.skipped.has(vanilla)) {
                    this.skipped.add(vanilla)
                    refreshNote()
                }
                continue
            }
            const decoding = this.buffer(file)
            if (!decoding) continue
            const volume = clamp(event.volume, 0, MAX_VOLUME, 1)
            const pitch = clamp(event.pitch, MIN_PITCH, MAX_PITCH, 1)
            if (volume <= 0) continue
            void decoding.then((buffer) => {
                if (buffer && !soundUi.muted && !this.disposed) output.play(buffer, volume, pitch)
            })
        }
    }

    stop() {
        this.output?.stop()
    }

    dispose() {
        if (this.disposed) return
        this.disposed = true
        this.stop()
        open.delete(this)
        refreshNote()
    }

    private buffer(file: string): Promise<unknown> | null {
        const known = this.decoded.get(file)
        if (known) return known
        const bytes = this.binary[file]
        if (!bytes || !this.output) return null
        const decoding = this.output.decode(bytes).catch((error) => {
            console.error(`[polyplus_nameplate] couldn't read the sound ${file}`, error)
            return null
        })
        this.decoded.set(file, decoding)
        return decoding
    }
}
