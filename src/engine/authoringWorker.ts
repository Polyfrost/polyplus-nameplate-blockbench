import { NameplateEngine } from '@plusrenderer/renderer/nameplate.js'

interface Job {
    id: number
    module?: WebAssembly.Module
    zip: Uint8Array
}

const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<Job>) => void) | null, postMessage(message: unknown): void }
let engine: NameplateEngine | null = null

scope.onmessage = (event) => {
    const { id, module, zip } = event.data
    try {
        if (module) engine = new NameplateEngine(new WebAssembly.Instance(module, {}).exports)
        if (!engine) throw new Error('The nameplate engine is not ready.')
        const asset = engine.loadSync(zip, { mode: 'authoring' })
        try {
            scope.postMessage({ id, issues: asset.issues })
        } finally {
            asset.free()
        }
    } catch (error) {
        scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
    }
}
