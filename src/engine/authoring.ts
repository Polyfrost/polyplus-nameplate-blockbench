import type { RawIssue } from '@plusrenderer/renderer/nameplate.js'
import workerSource from './authoringWorker?worker'
import { currentEngine, engineModule } from './wasm'

export interface AuthoringRun {
    result: Promise<RawIssue[]>
    cancel(): void
}

export type AuthoringRunner = (zip: Uint8Array) => AuthoringRun

export interface AuthoringTimers {
    set(callback: () => void, ms: number): unknown
    clear(handle: unknown): void
}

interface Request {
    key: object
    input: () => Uint8Array
    done: (issues: RawIssue[]) => void
}

const DEFAULT_TIMERS: AuthoringTimers = {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class AuthoringQueue {
    private waiting: Request | null = null
    private timer: unknown = null
    private running: { request: Request, run: AuthoringRun } | null = null

    constructor(
        private readonly runner: AuthoringRunner,
        private readonly delayMs: number,
        private readonly timers: AuthoringTimers = DEFAULT_TIMERS,
    ) {}

    request(key: object, input: () => Uint8Array, done: (issues: RawIssue[]) => void) {
        if (this.waiting?.key === key || (!this.waiting && this.running?.request.key === key)) return
        this.cancel()
        this.waiting = { key, input, done }
        this.timer = this.timers.set(() => this.start(), this.delayMs)
    }

    cancel() {
        if (this.timer !== null) this.timers.clear(this.timer)
        this.timer = null
        this.waiting = null
        const running = this.running
        this.running = null
        running?.run.cancel()
    }

    get busy(): boolean {
        return this.waiting !== null || this.running !== null
    }

    private start() {
        this.timer = null
        const request = this.waiting
        this.waiting = null
        if (!request) return
        let run: AuthoringRun
        try {
            run = this.runner(request.input())
        } catch (error) {
            console.error('[polyplus_nameplate] starting the full checks failed', error)
            return
        }
        const running = { request, run }
        this.running = running
        run.result.then(
            (issues) => {
                if (this.running !== running) return
                this.running = null
                request.done(issues)
            },
            (error) => {
                if (this.running !== running) return
                this.running = null
                console.error('[polyplus_nameplate] the full checks failed', error)
            },
        )
    }
}

export function authoringNow(zip: Uint8Array): RawIssue[] | null {
    const engine = currentEngine()
    if (!engine) return null
    const asset = engine.loadSync(zip, { mode: 'authoring' })
    try {
        return asset.issues
    } finally {
        asset.free()
    }
}

class Cancelled extends Error {}

function idleRun(zip: Uint8Array): AuthoringRun {
    let cancelled = false
    let handle: ReturnType<typeof setTimeout> | null = null
    let reject: (reason: unknown) => void = () => {}
    const result = new Promise<RawIssue[]>((resolve, fail) => {
        reject = fail
        handle = setTimeout(() => {
            handle = null
            if (cancelled) return
            try {
                const issues = authoringNow(zip)
                if (issues) resolve(issues)
                else fail(new Error('The nameplate engine is not ready.'))
            } catch (error) {
                fail(error)
            }
        }, 0)
    })
    return {
        result,
        cancel() {
            cancelled = true
            if (handle !== null) clearTimeout(handle)
            reject(new Cancelled())
        },
    }
}

interface WorkerReply {
    id: number
    issues?: RawIssue[]
    error?: string
}

class WorkerHost {
    private worker: Worker | null = null
    private url: string | null = null
    private sent = false
    private next = 0
    private waiting = new Map<number, { resolve(issues: RawIssue[]): void, reject(reason: unknown): void }>()
    broken = false

    run(zip: Uint8Array): AuthoringRun {
        const id = ++this.next
        const result = new Promise<RawIssue[]>((resolve, reject) => {
            this.waiting.set(id, { resolve, reject })
        })
        engineModule().then(
            (module) => this.post(id, module, zip),
            (error) => this.fail(id, error),
        )
        return {
            result,
            cancel: () => {
                const entry = this.waiting.get(id)
                if (!entry) return
                this.waiting.delete(id)
                entry.reject(new Cancelled())
                this.stop()
            },
        }
    }

    private post(id: number, module: WebAssembly.Module, zip: Uint8Array) {
        if (!this.waiting.has(id)) return
        try {
            const worker = this.ensure()
            worker.postMessage(this.sent ? { id, zip } : { id, module, zip }, [zip.buffer])
            this.sent = true
        } catch (error) {
            this.broken = true
            this.fail(id, error)
        }
    }

    private ensure(): Worker {
        if (this.worker) return this.worker
        this.url ??= URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
        const worker = new Worker(this.url)
        worker.onmessage = (event: MessageEvent<WorkerReply>) => {
            const entry = this.waiting.get(event.data.id)
            if (!entry) return
            this.waiting.delete(event.data.id)
            if (event.data.issues) entry.resolve(event.data.issues)
            else entry.reject(new Error(event.data.error ?? 'The full checks failed.'))
        }
        worker.onerror = (event) => {
            event.preventDefault?.()
            this.broken = true
            const error = new Error(event.message || 'The checks worker stopped.')
            for (const id of Array.from(this.waiting.keys())) this.fail(id, error)
            this.stop()
        }
        this.worker = worker
        this.sent = false
        return worker
    }

    private fail(id: number, error: unknown) {
        const entry = this.waiting.get(id)
        if (!entry) return
        this.waiting.delete(id)
        entry.reject(error)
    }

    stop() {
        this.worker?.terminate()
        this.worker = null
        this.sent = false
    }

    dispose() {
        this.stop()
        if (this.url) URL.revokeObjectURL(this.url)
        this.url = null
    }
}

let host: WorkerHost | null = null

function canUseWorker(): boolean {
    return typeof Worker === 'function' && typeof Blob === 'function' && typeof URL?.createObjectURL === 'function'
}

export function backgroundRunner(zip: Uint8Array): AuthoringRun {
    if (!canUseWorker() || host?.broken) return idleRun(zip)
    host ??= new WorkerHost()
    const copy = zip.slice()
    const first = host.run(zip)
    let fallback: AuthoringRun | null = null
    let cancelled = false
    const result = first.result.catch((error) => {
        if (cancelled || error instanceof Cancelled || !host?.broken) throw error
        console.warn('[polyplus_nameplate] the checks worker failed, running the checks here instead', error)
        fallback = idleRun(copy)
        return fallback.result
    })
    return {
        result,
        cancel() {
            cancelled = true
            first.cancel()
            fallback?.cancel()
        },
    }
}

export function stopBackgroundChecks() {
    host?.dispose()
    host = null
}
