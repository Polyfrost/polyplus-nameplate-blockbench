import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import type { RawIssue } from '@plusrenderer/renderer/nameplate.js'
import { compiledLoad, currentBundle, finishFullChecks, fullChecksFailed, onFullChecks, setSnapshotSource, stopFullChecks } from '../src/compile'
import { FULL_CHECKS_FAILED, fullCheckProblems } from '../src/export/fullChecks'
import { AuthoringQueue, AuthoringRun, AuthoringTimers, startEngine } from '../src/engine'
import { defaultNameplate } from '../src/format'
import { defaultText } from '../src/text/types'
import { sampleSnapshot } from './plateKit'

class FakeTimers implements AuthoringTimers {
    private next = 0
    private waiting = new Map<number, () => void>()

    set(callback: () => void): unknown {
        const id = ++this.next
        this.waiting.set(id, callback)
        return id
    }

    clear(handle: unknown) {
        this.waiting.delete(handle as number)
    }

    fire() {
        const due = Array.from(this.waiting.values())
        this.waiting.clear()
        for (const callback of due) callback()
    }
}

interface FakeRun {
    zip: number
    cancelled: boolean
    finish(issues: RawIssue[]): void
}

function fakeRunner(runs: FakeRun[]): (zip: Uint8Array) => AuthoringRun {
    return (zip) => {
        let finish: (issues: RawIssue[]) => void = () => {}
        const result = new Promise<RawIssue[]>((done) => {
            finish = done
        })
        const run: FakeRun = { zip: zip[0], cancelled: false, finish: (issues) => finish(issues) }
        runs.push(run)
        return {
            result,
            cancel() {
                run.cancelled = true
            },
        }
    }
}

const flush = () => new Promise((done) => setTimeout(done, 0))

test('full checks wait for edits to settle and only run the newest bundle', async () => {
    const timers = new FakeTimers()
    const runs: FakeRun[] = []
    const queue = new AuthoringQueue(fakeRunner(runs), 500, timers)
    const results: number[] = []
    const first = {}
    const second = {}
    let built = 0
    queue.request(first, () => Uint8Array.of(++built), () => results.push(1))
    queue.request(second, () => Uint8Array.of(++built), () => results.push(2))
    assert.equal(runs.length, 0)
    timers.fire()
    assert.deepEqual(runs.map((run) => run.zip), [1])
    assert.equal(built, 1, 'the stale bundle is never zipped')
    queue.request(second, () => Uint8Array.of(++built), () => results.push(3))
    timers.fire()
    assert.equal(runs.length, 1, 'asking again for the bundle being checked does nothing')
    runs[0].finish([])
    await flush()
    assert.deepEqual(results, [2])
    assert.equal(queue.busy, false)
})

test('an edit during a full check cancels it and its result is dropped', async () => {
    const timers = new FakeTimers()
    const runs: FakeRun[] = []
    const queue = new AuthoringQueue(fakeRunner(runs), 500, timers)
    const results: string[] = []
    queue.request({}, () => Uint8Array.of(1), () => results.push('old'))
    timers.fire()
    queue.request({}, () => Uint8Array.of(2), () => results.push('new'))
    assert.equal(runs[0].cancelled, true)
    runs[0].finish([])
    await flush()
    assert.deepEqual(results, [])
    timers.fire()
    runs[1].finish([])
    await flush()
    assert.deepEqual(results, ['new'])
})

function hiddenLetters() {
    return sampleSnapshot({ ...defaultNameplate(), text: { ...defaultText(), mode: 'owned', motion: 'v.opacity = 0; return 0;' } })
}

test('editing loads the quick checks, and the full checks join them when they finish', { skip: !existsSync(resolve('..', 'plusrenderer')) }, async () => {
    await startEngine()
    setSnapshotSource(hiddenLetters)
    let finished = 0
    const remove = onFullChecks(() => finished++)
    try {
        const quick = currentBundle()
        assert.ok(!quick.issues.some((issue: any) => issue.code === 'letter_readable'))
        const preview = compiledLoad(quick.files)?.preview
        assert.ok(preview)
        assert.equal(preview.cost(false).flashChecked, false)
        const full = finishFullChecks()
        assert.equal(finished, 1)
        const readable = full.issues.find((issue: any) => issue.code === 'letter_readable') as any
        assert.ok(readable, JSON.stringify(full.issues))
        assert.equal(readable.path, 'manifest.json#text.motion')
        assert.equal(readable.values.of, 20)
        assert.equal(currentBundle(), full)
        assert.equal(preview.cost(false).flashChecked, true)
        assert.ok(preview.version > 0)
    } finally {
        remove()
        stopFullChecks()
    }
})

test('a full check that throws blocks the export until a later check succeeds', { skip: !existsSync(resolve('..', 'plusrenderer')) }, async () => {
    const engine = await startEngine()
    assert.ok(engine)
    setSnapshotSource(hiddenLetters)
    const loadSync = engine.loadSync
    let finished = 0
    const remove = onFullChecks(() => finished++)
    try {
        engine.loadSync = (zip, options) => {
            if (options?.mode === 'authoring') throw new Error('out of memory')
            return loadSync.call(engine, zip, options)
        }
        const failed = finishFullChecks()
        assert.equal(finished, 1)
        assert.equal(fullChecksFailed(failed), true)
        assert.ok(!failed.issues.some((issue: any) => issue.code === 'letter_readable'))
        assert.deepEqual(fullCheckProblems(failed).map((problem) => [problem.level, problem.text]), [['error', FULL_CHECKS_FAILED]])
        engine.loadSync = loadSync
        const checked = finishFullChecks()
        assert.equal(fullChecksFailed(checked), false)
        assert.deepEqual(fullCheckProblems(checked), [])
        assert.ok(checked.issues.some((issue: any) => issue.code === 'letter_readable'))
    } finally {
        engine.loadSync = loadSync
        remove()
        stopFullChecks()
    }
})

