import assert from 'node:assert/strict'
import test from 'node:test'
import { DETAIL_FULL, MOTION_FULL, OUT } from '@plusrenderer/renderer/nameplate.js'
import { blockRow, lineBlock, NameplatePreview, NameplateTagState } from '../src/engine'
import { drawnBoxes, replayedTag, replaySteps, setFullReplay, signalsOf } from '../src/engine/gl'
import { identityOf, previewWearer, wearerSeed } from '../src/engine/seed'
import { fireOneShot, MAIN_TAG, pauseLive, setReaction, stageFrame, tagState } from '../src/preview/live'
import { playbackRate } from '../src/preview'
import { embers, liveTest, loadPlate, plateFiles } from './plateKit'

const FPS = 10
const SPRINT = 'is_sprinting'
const HURT = 'is_hurt'
const PADDED = { kind: 'body', padding: [3, 2, 3, 2], minWidth: 30, fill: { color: 'fill' } }

function speedFiles(stall: Record<string, unknown> = {}, extra: { requires?: string[], layers?: object[], files?: Record<string, unknown> } = {}): Record<string, string> {
    return plateFiles({
        requires: ['nameplate', 'nameplate_paths', 'nameplate_reactions', 'nameplate_one_shots', ...(extra.requires ?? [])],
        loop: 20,
        layers: [{ id: 'body' }, { id: 'runner', depth: 'over_background' }, ...(extra.layers ?? [])],
        animations: {
            dash: { trigger: { reaction: SPRINT, on: 'while' }, tracks: { runner: { speed: [[0, 6]] } } },
            stall: { trigger: { reaction: HURT, on: 'start' }, length: 4, tracks: { runner: { speed: [[0, 0]] } }, ...stall },
        },
    }, {
        'layers/body.json': PADDED,
        'layers/runner.json': { kind: 'sprite', sprite: 'runner', of: 'body', anchor: 'top_left', path: { preset: 'perimeter', speed: 2, end: 'wrap' } },
        'sprites/runner.json': { colors: { R: 'border' }, frames: [['RR', 'RR']] },
        ...extra.files,
    }, [{ id: 'border', name: 'Border', ramp: ['#D94040'] }, { id: 'fill', name: 'Fill', ramp: ['#262A3A'] }])
}

type Runs = Record<string, Array<[number, number]>>

const SCRIPT: Runs = { [SPRINT]: [[10, 20], [22, 45]], [HURT]: [[30, 31], [52, 53]] }
const LAST = 100
const BLOCK = lineBlock(40, 0, 40)
const SEED = 5

const onAt = (runs: Runs, frame: number) => Object.entries(runs).filter(([, list]) => list.some(([on, off]) => frame >= on && frame < off)).map(([signal]) => signal)
const reactionOf: Record<string, string> = { [SPRINT]: 'sprinting', [HURT]: 'hurt' }

function recordStates(preview: NameplatePreview, runs: Runs, last: number, fires: readonly number[] = []): NameplateTagState[] {
    const record = preview.record()
    record.prime('tag', preview.variants[0], 0, [], false)
    const states: NameplateTagState[] = []
    for (let frame = 0; frame <= last; frame++) {
        if (fires.includes(frame)) assert.ok(record.fire('tag', 'stall', frame), `fired at ${frame}`)
        states.push(record.update('tag', preview.variants[0], frame, onAt(runs, frame).map((signal) => reactionOf[signal]), frame * 100))
    }
    return states
}

interface Crop {
    left: number
    top: number
    rgba: number[]
}

const slotOf = (preview: NameplatePreview, id: string) => preview.meta.layers!.find((layer) => layer.id === id)!.slot
const stallOf = (preview: NameplatePreview) => preview.meta.animations!.one_shots.findIndex((shot) => shot.name === 'stall')

function painted(preview: NameplatePreview, frame: number, state: NameplateTagState): Crop {
    const layer = preview.paint(preview.variants[0], BLOCK, frame, SEED, state).find((entry) => entry.layer === 'runner')!
    return { left: layer.left, top: layer.top, rgba: Array.from(layer.rgba) }
}

function rastered(preview: NameplatePreview, frame: number, runs: Runs, fires: readonly number[] = []): Crop {
    const stall = stallOf(preview)
    const stopped: Array<[string, number, number]> = []
    const oneShots: Array<[number, number]> = fires.filter((at) => at <= frame).map((at) => [stall, frame - at])
    let heldFor: number | null = null
    for (const [signal, list] of Object.entries(runs)) {
        for (const [start, stop] of list) {
            if (start > frame) continue
            if (signal === HURT) oneShots.push([stall, frame - start])
            if (frame < stop) heldFor = Math.max(heldFor ?? 0, frame - start)
            else stopped.push([signal, stop - start, frame - stop])
        }
    }
    const image = preview.asset.rasterLayers(blockRow(BLOCK, 0, 0), frame, { seed: wearerSeed(SEED, identityOf(preview.meta.identity)), reactions: onAt(runs, frame), heldFor, stopped, oneShots, observedFor: frame })
    const layer = image.layers.find((entry) => entry.slot === slotOf(preview, 'runner'))!
    let [x0, y0, x1, y1] = [image.width, image.height, -1, -1]
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            if (layer.data[(y * image.width + x) * 4 + 3] === 0) continue
            ;[x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)]
        }
    }
    const rgba: number[] = []
    for (let y = y0; y <= y1; y++) rgba.push(...layer.data.subarray((y * image.width + x0) * 4, (y * image.width + x1 + 1) * 4))
    return { left: image.origin[0] + x0 + BLOCK.shiftX, top: image.origin[1] + y0 + BLOCK.shiftY, rgba }
}

function played<T>(preview: NameplatePreview, last: number, read: (out: Int32Array) => T, runs: Runs = {}, fires: readonly number[] = []): T[] {
    const nameplates = preview.asset.engine.nameplates()
    try {
        const assetId = nameplates.addAsset(preview.asset)
        const row = blockRow(BLOCK, assetId, 0)
        row[OUT.TAG_DETAIL] = DETAIL_FULL
        nameplates.setMotion(MOTION_FULL)
        const wearer = previewWearer(SEED)
        const seen: T[] = []
        for (let frame = 0; frame <= last; frame++) {
            nameplates.setSignalOverride(wearer, 'is_in_combat', 0)
            const draw = () => nameplates.frame((frame + 0.5) / FPS, [wearer], row, signalsOf(onAt(runs, frame)))
            let out = draw()
            if (fires.includes(frame)) {
                assert.ok(nameplates.fire(wearer, assetId, stallOf(preview)))
                out = draw()
            }
            seen.push(read(out))
        }
        return seen
    } finally {
        nameplates.free()
    }
}

const runnerSpot = (preview: NameplatePreview) => (out: Int32Array): [number, number] => {
    const box = drawnBoxes(out).get(slotOf(preview, 'runner'))!
    return [box.x0, box.y0]
}

function replayed(preview: NameplatePreview, frame: number, state: NameplateTagState): Int32Array {
    const out = replayedTag({ preview, block: BLOCK, variant: 0, frame, seed: SEED, state, detail: DETAIL_FULL, motion: MOTION_FULL }, null)
    assert.ok(out)
    return out
}

test('both previews steer a path walker through ended, restarted and one-shot speed episodes like the engine', () => {
    const preview = loadPlate(speedFiles())
    const states = recordStates(preview, SCRIPT, LAST)
    const game = played(preview, LAST, runnerSpot(preview), SCRIPT)
    let basicNaive = 0
    let fullNaive = 0
    for (let frame = 0; frame <= LAST; frame++) {
        const truth = rastered(preview, frame, SCRIPT)
        assert.deepEqual(painted(preview, frame, states[frame]), truth, `basic frame ${frame}`)
        assert.deepEqual(runnerSpot(preview)(replayed(preview, frame, states[frame])), game[frame], `full frame ${frame}`)
        if (JSON.stringify(painted(preview, frame, { ...states[frame], stoppedBy: undefined, endedBy: undefined, speedShots: undefined })) !== JSON.stringify(truth)) basicNaive++
        if (JSON.stringify(runnerSpot(preview)(replayed(preview, frame, { ...states[frame], stoppedBy: undefined, speedShots: undefined, observedFor: undefined }))) !== JSON.stringify(game[frame])) fullNaive++
    }
    assert.ok(basicNaive > 10 && fullNaive > 10, `history changes the walker on ${basicNaive} and ${fullNaive} frames`)
    assert.deepEqual(states[25].stoppedBy?.[SPRINT], [[15, 5]], 'turning sprint on again keeps the run it ended')
    assert.equal(states[25].endedBy?.[SPRINT], undefined)
    assert.deepEqual(states[50].stoppedBy?.[SPRINT], [[40, 30], [28, 5]])
    assert.deepEqual(states[50].endedBy?.[SPRINT], [28, 5])
    assert.deepEqual([states[32].oneShots, states[32].speedShots], [['stall'], undefined], 'a playing one-shot is not listed twice')
    assert.deepEqual([states[35].oneShots, states[35].speedShots], [[], [['stall', 30]]], 'a speed one-shot is kept after its clip ends')
    assert.deepEqual(states[60].speedShots, [['stall', 30], ['stall', 52]])
})

test('speed history stays bounded: old speed one-shots drop after ten minutes and only speed reactions keep more than their last stop', () => {
    const preview = loadPlate(speedFiles())
    const record = preview.record()
    record.prime('tag', preview.variants[0], 0, [], true)
    record.update('tag', preview.variants[0], 0, ['hurt'], 0)
    record.update('tag', preview.variants[0], 1, [], 100)
    assert.equal(record.update('tag', preview.variants[0], 1 + 600 * FPS + 10, [], 700000).speedShots, undefined)
    const busy = preview.record()
    busy.prime('tag', preview.variants[0], 0, [], true)
    let state: NameplateTagState | null = null
    for (let i = 0; i < 40; i++) {
        busy.update('tag', preview.variants[0], i * 4, ['sprinting', 'hurt'], i * 400)
        state = busy.update('tag', preview.variants[0], i * 4 + 2, [], i * 400 + 200)
    }
    assert.equal(state!.stoppedBy?.[SPRINT]?.length, 16)
    assert.deepEqual(state!.stoppedBy?.[HURT], [[2, 0]])
    assert.ok((state!.speedShots?.length ?? 0) + state!.oneShots.length <= 16 + 8)
})

test('signal times count from when the plate was first shown in both previews', () => {
    const preview = loadPlate(plateFiles({ animations: { loop: { tracks: { $plate: { position: [[0, ['q.is_sneaking_time * 2', 0]]] } } } } }))
    const record = preview.record()
    record.prime('tag', '', 100, [], false)
    record.update('tag', '', 100, [], 10000)
    const state = record.update('tag', '', 130, [], 13000)
    assert.equal(state.observedFor, 30)
    const dx = () => preview.platePose('', lineBlock(24, 0, 24), 130, 0, state).dx
    assert.equal(dx(), 6, 'sneaking has been off for the 3 s the plate was shown')
    setFullReplay(() => true)
    try {
        assert.equal(dx(), 6)
    } finally {
        setFullReplay(null)
    }
})

test('the full replay starts where the plate was first shown when that cannot show a stray appear', () => {
    const quiet = { reactions: [], oneShots: [], starts: new Int32Array(0), observedFor: 30 }
    assert.equal(replaySteps(quiet, 100, 20)[0].frame, 70)
    const hi = { name: 'hi', trigger: 'appear', signal: null, keep: 10, appear: 1 }
    const shown = replaySteps({ ...quiet, oneShots: ['hi'], starts: Int32Array.from([95]), observedFor: 5 }, 100, 20, [hi])
    assert.equal(shown[0].frame, 95, 'the first sight is the appear the record played')
    assert.ok(shown.every((step) => step.fire.length === 0), 'the engine plays that appear on its own')
    assert.equal(replaySteps({ ...quiet, observedFor: 5 }, 100, 20, [hi])[0].frame, 95 - 11, 'a plate that skipped its appear warms up first')
    assert.equal(replaySteps({ ...quiet, observedFor: 40 }, 100, 20, [hi])[0].frame, 60, 'an appear that would have ended already does not matter')
})

test('the full replay fires kept speed one-shots and replays every kept episode', () => {
    const stall = { name: 'stall', trigger: 'start', signal: HURT, keep: 4, appear: null, length: 4 }
    const state = {
        reactions: ['sprinting'],
        oneShots: [],
        starts: new Int32Array(0),
        heldBy: { [SPRINT]: 10 },
        held: 10,
        stoppedBy: { [SPRINT]: [[40, 30], [25, 15]] as Array<[number, number]> },
        speedShots: [['stall', 70]] as Array<[string, number]>,
        observedFor: 50,
    }
    const steps = replaySteps(state, 100, 20, [stall])
    const at = (frame: number) => steps.find((step) => step.frame === frame)
    assert.deepEqual([at(60)?.on, at(70)?.on, at(70)?.fire], [[SPRINT], [], ['stall']])
    assert.ok(at(74), 'the replay draws the frame the clip ends on, so its speed episode ends there')
    assert.deepEqual([at(75)?.on, at(85)?.on, at(90)?.on], [[SPRINT], [], [SPRINT]])
})

test('a speed one-shot restarted inside its clip keeps its first run in both previews like the engine', () => {
    const preview = loadPlate(speedFiles({ length: 20, restart: true }))
    const last = 60
    const unfired = played(preview, last, runnerSpot(preview))
    for (const fires of [[2, 7], [2, 12], [2, 7, 12]]) {
        const states = recordStates(preview, {}, last, fires)
        const game = played(preview, last, runnerSpot(preview), {}, fires)
        for (let frame = 0; frame <= last; frame++) {
            const label = `fires ${fires.join(',')} frame ${frame}`
            const basic = painted(preview, frame, states[frame])
            assert.deepEqual(basic, rastered(preview, frame, {}, fires), label)
            assert.deepEqual(runnerSpot(preview)(replayed(preview, frame, states[frame])), game[frame], label)
            const plain = painted(preview, frame, recordStates(preview, {}, frame)[frame])
            assert.deepEqual([basic.left - plain.left, basic.top - plain.top], [game[frame][0] - unfired[frame][0], game[frame][1] - unfired[frame][1]], `${label} basic walker offset`)
        }
    }
})

test('a restarted one-shot drops the later bursts of the run it replaced in the basic preview like the engine', () => {
    const preview = loadPlate(speedFiles({ length: 20, restart: true, tracks: { runner: { speed: [[0, 0]] }, embers: { burst: [[15, 3]] } } }, {
        requires: ['nameplate_particles'],
        layers: [{ id: 'embers', depth: 'over_text' }],
        files: { 'layers/embers.json': embers('runner', [6, 10]) },
    }))
    const fires = [2, 7]
    const last = 40
    const states = recordStates(preview, {}, last, fires)
    const game = played(preview, last, runnerSpot(preview), {}, fires)
    const unfired = played(preview, last, runnerSpot(preview))
    const sparks = (frame: number) => preview.paint(preview.variants[0], BLOCK, frame, SEED, states[frame]).find((layer) => layer.layer === 'embers')!.rgba.length > 0
    assert.deepEqual(states[18].retired, [['stall', 2, 7]])
    for (let frame = 0; frame <= last; frame++) {
        assert.equal(sparks(frame), drawnBoxes(replayed(preview, frame, states[frame])).has(slotOf(preview, 'embers')), `frame ${frame} sparks`)
        const plain = painted(preview, frame, recordStates(preview, {}, frame)[frame])
        const basic = painted(preview, frame, states[frame])
        assert.deepEqual([basic.left - plain.left, basic.top - plain.top], [game[frame][0] - unfired[frame][0], game[frame][1] - unfired[frame][1]], `frame ${frame} basic walker offset`)
    }
    assert.equal(sparks(18), false, 'the replaced run never bursts at frame 17')
    assert.equal(sparks(22), true, 'the restarted run bursts at frame 22')
})

function shotPreview(): NameplatePreview {
    return loadPlate(plateFiles({ requires: ['nameplate', 'nameplate_one_shots'], animations: { pop: { trigger: 'equip', length: 8, tracks: { body: { position: [[0, [4, 0]]] } } } } }))
}

const START = 1_800_000_000.05
const ageOf = (state: NameplateTagState | null, frame: number) => (state && state.oneShots.length ? frame - state.starts[0] : null)

liveTest('resuming Design playback after a long pause keeps a one-shot and a held reaction where they were', () => {
    const preview = shotPreview()
    let shown = stageFrame(preview, 0, true, false, START)
    tagState(MAIN_TAG, '', shown.frame)
    setReaction('sneaking', true)
    assert.equal(fireOneShot('pop', [MAIN_TAG]), 1)
    for (let step = 1; step <= 3; step++) {
        shown = stageFrame(preview, shown.local, true, false, START + step / 10)
        tagState(MAIN_TAG, '', shown.frame)
    }
    const before = tagState(MAIN_TAG, '', shown.frame)
    assert.equal(ageOf(before, shown.frame), 3)
    pauseLive()
    for (const later of [2, 10, 30]) tagState(MAIN_TAG, '', stageFrame(preview, shown.local, false, false, START + later).frame)
    const resumed = stageFrame(preview, shown.local, true, false, START + 30.05)
    const after = tagState(MAIN_TAG, '', resumed.frame)
    assert.equal(resumed.local, Math.floor((START + 30.05) * 10) % 10, 'the shown frame follows the clock')
    assert.equal(ageOf(after, resumed.frame), 3, 'the one-shot carries on from where it was paused')
    assert.equal(after?.heldBy?.is_sneaking, before?.heldBy?.is_sneaking, 'the pause does not count as held time')
    const next = stageFrame(preview, resumed.local, true, false, START + 30.15)
    const moved = tagState(MAIN_TAG, '', next.frame)
    assert.equal(ageOf(moved, next.frame), 4)
    assert.equal(moved?.heldBy?.is_sneaking, (before?.heldBy?.is_sneaking ?? 0) + 1)
})

liveTest('a custom Animate playback range counts each wrap as one frame of reaction time', () => {
    const preview = shotPreview()
    let placed = stageFrame(preview, 2, true, true, START)
    setReaction('sneaking', true)
    tagState(MAIN_TAG, '', placed.frame)
    assert.equal(fireOneShot('pop', [MAIN_TAG]), 1)
    for (let step = 1; step <= 12; step++) {
        placed = stageFrame(preview, 2 + (step % 4), true, true, START + step / 10 + 0.01)
        assert.equal(placed.local, 2 + (step % 4))
        const state = tagState(MAIN_TAG, '', placed.frame)
        assert.equal(state?.heldBy?.is_sneaking, step, `step ${step}`)
        assert.equal(ageOf(state, placed.frame), step < 8 ? step : null, `step ${step}`)
    }
})

liveTest('a playback speed of 0 holds reaction time and only bad values fall back to normal speed', () => {
    assert.deepEqual([playbackRate(0), playbackRate(50), playbackRate('100')], [0, 0.5, 1])
    for (const bad of [-10, Number.NaN, Infinity, null, undefined, '', 'fast']) assert.equal(playbackRate(bad), 1, String(bad))
    const preview = shotPreview()
    const first = stageFrame(preview, 3, true, true, START, 1)
    setReaction('sneaking', true)
    tagState(MAIN_TAG, '', first.frame)
    tagState(MAIN_TAG, '', stageFrame(preview, 3, true, true, START + 0.11, 0).frame)
    for (const later of [0.5, 2, 5]) assert.equal(tagState(MAIN_TAG, '', stageFrame(preview, 3, true, true, START + later, 0).frame)?.heldBy?.is_sneaking, 0, `at ${later} s`)
})
