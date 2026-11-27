import { NameplateEngine } from '@plusrenderer/renderer/nameplate.js'
import wasmPayload from '@plusrenderer/renderer/plusrenderer.wasm'
import { inflateZlib } from './inflate'

let engine: NameplateEngine | null = null
let failure: unknown = null
let pending: Promise<NameplateEngine | null> | null = null
let inflated: Uint8Array | null = null
const readyListeners = new Set<() => void>()

function packing(): { deflated: boolean, size: number } {
    return typeof ENGINE_WASM === 'undefined' ? { deflated: false, size: wasmPayload.length } : ENGINE_WASM
}

function canStream(): boolean {
    return typeof DecompressionStream === 'function' && typeof Response === 'function' && typeof Blob === 'function'
}

async function streamed(): Promise<Uint8Array> {
    const stream = new Blob([wasmPayload as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
}

export function wasmBytesNow(): Uint8Array {
    if (!packing().deflated) return wasmPayload
    return (inflated ??= inflateZlib(wasmPayload, packing().size))
}

async function wasmBytes(): Promise<Uint8Array> {
    if (!packing().deflated || inflated) return wasmBytesNow()
    if (canStream()) {
        try {
            return (inflated = await streamed())
        } catch (error) {
            console.warn('[polyplus_nameplate] unpacking the engine in the background failed, unpacking it directly', error)
        }
    }
    return wasmBytesNow()
}

function compiledNow(bytes: Uint8Array): NameplateEngine | null {
    try {
        const module = new WebAssembly.Module(bytes as BufferSource)
        return new NameplateEngine(new WebAssembly.Instance(module, {}).exports)
    } catch (error) {
        if (error instanceof RangeError) return null
        failure = error
        return null
    }
}

function announce() {
    for (const listener of Array.from(readyListeners)) {
        try {
            listener()
        } catch (error) {
            console.error('[polyplus_nameplate] an engine listener failed', error)
        }
    }
}

async function started(): Promise<NameplateEngine | null> {
    try {
        const bytes = await wasmBytes()
        const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {})
        engine = new NameplateEngine(instance.exports)
        announce()
        return engine
    } catch (error) {
        failure = error
        console.error('[polyplus_nameplate] the nameplate engine failed to start', error)
        return null
    }
}

export function startEngine(): Promise<NameplateEngine | null> {
    if (engine) return Promise.resolve(engine)
    if (pending) return pending
    if (!packing().deflated || !canStream()) {
        try {
            engine = compiledNow(wasmBytesNow())
        } catch (error) {
            failure = error
        }
        if (engine || failure) return Promise.resolve(engine)
    }
    pending = started()
    return pending
}

export function currentEngine(): NameplateEngine | null {
    if (!engine && !pending && !failure) startEngine()
    return engine
}

export function engineFailure(): unknown {
    return failure
}

export function onEngineReady(listener: () => void): () => void {
    readyListeners.add(listener)
    return () => readyListeners.delete(listener)
}

let compiled: Promise<WebAssembly.Module> | null = null

export function engineModule(): Promise<WebAssembly.Module> {
    compiled ??= wasmBytes().then((bytes) => WebAssembly.compile(bytes as BufferSource))
    compiled.catch(() => {
        compiled = null
    })
    return compiled
}
