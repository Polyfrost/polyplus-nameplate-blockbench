import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { blendPixel, flattenRasterLayers, OUT, SIGNALS } from '@plusrenderer/renderer/nameplate.js'
import { blockRow, drawRasterLayer, lineBlock, loadBundle, NameplateLayer, NameplatePreview, stateOf } from '../src/engine'
import { drawnBoxes, glPixelScale, ImageSets, litRows, onlyLayer, opaqueBox, setFullReplay, signalsOf, straightRows, surfaceBox, surfacePlan } from '../src/engine/gl'
import { comparedBounds, replayJob } from '../src/gpu/compose'
import { programSignals } from '../src/engine/load'
import { inDrawOrder } from '../src/gpu/order'
import { engineSeed, identityOf, previewWearer, wearerSeed } from '../src/engine/seed'
import { absoluteFrame, clockFrame, fireOneShot, liveUi, MAIN_TAG, resetLive, resumeOnClock, setLiveClock, setReaction, setSignalValue, stageFrame, stillState, tagState } from '../src/preview/live'
import { previewUi } from '../src/preview'
import { stopPlayback, togglePlayback } from '../src/design/playback'
import { embers, FILL, GLOW, liveTest, loadPlate, plateFiles } from './plateKit'

const KITS = resolve(process.env.PLUSRENDERER_TESTDATA ?? join('..', 'plusrenderer', 'crates', 'core', 'src', 'nameplate', 'format', 'testdata'))
const START = 1_800_000_000.05
const SPAN = Math.floor((2 ** 23 - 1) / 10) * 10
const NUDGE = { body: { position: [[0, [4, 0]]] } }

function shotPreview(loop = 10) {
    return loadPlate(plateFiles({
        requires: ['nameplate', 'nameplate_one_shots'],
        loop,
        variants: { a: {}, b: {} },
        animations: {
            hello: { trigger: { appear: 3 }, length: 5, tracks: NUDGE },
            pop: { trigger: 'equip', length: 5, tracks: NUDGE },
        },
    }))
}

const shots = (frame: number, variant = 'a') => tagState(MAIN_TAG, variant, frame)?.oneShots

test('an appear one-shot plays on first sight and equip waits for a variant change', () => {
    const record = shotPreview().record()
    record.prime('tag', 'a', 20, [], false)
    assert.deepEqual([20, 21, 26].map((frame) => record.update('tag', 'a', frame, [], frame * 100).oneShots), [['hello'], ['hello'], []])
    const swapped = record.update('tag', 'b', 27, [], 2700)
    assert.deepEqual([swapped.oneShots, Array.from(swapped.starts)], [['pop'], [27]])
    assert.deepEqual(record.update('tag', 'b', 28, [], 2800).oneShots, ['pop'])
})

liveTest('the live preview plays appear on first sight, not again after a paused reaction toggle', () => {
    const frame = absoluteFrame(shotPreview(), 4, true)
    assert.deepEqual(shots(frame), ['hello'])
    assert.deepEqual(shots(frame + 1, 'b'), ['hello', 'pop'])
    setReaction('sneaking', true, true)
    setReaction('sneaking', false, true)
    assert.deepEqual(shots(frame + 9, 'b'), [])
})

test('live playback follows the UTC clock, so reopening or editing the plate keeps its phase', () => {
    const seconds = 1_800_000_000.25
    const expected = Math.floor(seconds * 10) % SPAN
    const first = shotPreview()
    try {
        setLiveClock(() => seconds)
        assert.equal(clockFrame(first), expected)
        assert.equal(absoluteFrame(first, 3, true), expected)
        assert.equal(absoluteFrame(first, 7, true), expected, 'the editor frame does not move live playback')
        const edited = shotPreview()
        assert.equal(absoluteFrame(edited, 0, true), expected, 'an edited plate keeps the phase')
        resetLive()
        assert.equal(absoluteFrame(shotPreview(), 9, true), expected, 'a reopened plate keeps the phase')
        setLiveClock(() => seconds + 0.5)
        assert.equal(absoluteFrame(edited, 0, true), expected + 5)
    } finally {
        setLiveClock(null)
        resetLive()
    }
})

liveTest('scrubbing while paused stays in the current UTC loop and playing again rejoins the clock', () => {
    const preview = shotPreview()
    const playing = absoluteFrame(preview, 2, true, START)
    const loopStart = playing - (playing % 10)
    assert.equal(absoluteFrame(preview, 2, false, START + 3), playing, 'pausing holds the frame')
    assert.equal(absoluteFrame(preview, 5, false, START + 4), loopStart + 5, 'scrubbing stays in the current loop')
    assert.equal(absoluteFrame(preview, 5, false, START + 9), loopStart + 5)
    assert.equal(absoluteFrame(preview, 5, true, START + 2), Math.floor((START + 2) * 10) % SPAN)
    resetLive()
    assert.equal(absoluteFrame(preview, 4, false, START), loopStart + 4, 'a paused preview opens on the UTC loop at the editor frame')
})

function sparkPreview() {
    return loadPlate(plateFiles({
        requires: ['nameplate', 'nameplate_particles', 'nameplate_one_shots'],
        layers: [{ id: 'body' }, { id: 'embers' }],
        animations: {
            hello: { trigger: { appear: 2 }, length: 3, tracks: { body: { position: [[0, [2, 0]]] } } },
            pop: { trigger: { reaction: 'is_hurt', on: 'start' }, restart: true, length: 4, tracks: { embers: { burst: [[0, 3]] } } },
            once: { trigger: { reaction: 'is_on_fire', on: 'start' }, length: 4, tracks: { body: { position: [[0, [2, 0]]] } } },
        },
    }, { 'layers/embers.json': embers('ember', [6, 10]), 'sprites/ember.json': { colors: { E: 'glow' }, frames: [['E']] } }, [FILL, GLOW]))
}

const runs = (state: { oneShots: string[], starts: Int32Array }) => state.oneShots.map((name, i) => `${name}@${state.starts[i]}`).sort()

liveTest('in Animate mode the main loop plays the timeline frame and follows the playhead, while the live preview keeps UTC', () => {
    const preview = shotPreview()
    const start = 1_800_000_000.75
    assert.equal(stageFrame(preview, 2, true, false, start).local, 7, 'the live preview shows the UTC frame')
    resetLive()
    const first = stageFrame(preview, 2, true, true, start)
    assert.equal(first.local, 2, 'Animate mode shows the playhead frame')
    assert.equal(first.control, null)
    const frames = [first.frame]
    for (let local = 3; local < 13; local++) {
        const placed = stageFrame(preview, local % 10, true, true, start + (local - 2) / 10)
        assert.equal(placed.local, local % 10)
        frames.push(placed.frame)
    }
    assert.deepEqual(frames.map((frame) => frame - first.frame), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'the timeline wrap keeps counting forward')
    const back = stageFrame(preview, 0, true, true, start + 1.1)
    assert.equal(back.frame - first.frame, 18, 'scrubbing the playhead back while playing moves forward to it')
    const paused = stageFrame(preview, 4, false, true, start + 5)
    assert.equal(paused.local, 4)
    assert.equal(paused.frame, back.frame + 4)
})

liveTest('Try it on a paused preview starts the one-shot where playback resumes', () => {
    const preview = shotPreview()
    let shown = stageFrame(preview, 0, true, false, START)
    for (let step = 0; step <= 7; step++) {
        shown = stageFrame(preview, shown.local, true, false, START + step / 10)
        tagState(MAIN_TAG, 'a', shown.frame)
    }
    for (const later of [1, 2, 4]) tagState(MAIN_TAG, 'a', stageFrame(preview, shown.local, false, false, START + later).frame)
    assert.deepEqual(shots(shown.frame), [], 'appear ended before the pause')
    resumeOnClock(START + 10)
    assert.equal(fireOneShot('pop', [MAIN_TAG]), 1)
    const playing = stageFrame(preview, shown.local, true, false, START + 10.1)
    assert.equal(playing.frame, clockFrame(preview, START + 10.1))
    const state = tagState(MAIN_TAG, 'a', playing.frame)
    assert.deepEqual(state?.oneShots, ['pop'], 'the fired one-shot is still playing after playback jumps to the clock')
    assert.deepEqual(Array.from(state?.starts ?? []), [clockFrame(preview, START + 10)])
})

test('stopping Design playback with the Play Loop control does not count the pause as out of sight', () => {
    const preview = shotPreview()
    const tick = () => {}
    try {
        togglePlayback(tick)
        assert.equal(previewUi.playing, true)
        let frame = stageFrame(preview, 0, true, false, START).frame
        assert.deepEqual(shots(frame), ['hello'])
        for (let step = 1; step <= 6; step++) {
            frame = stageFrame(preview, 0, true, false, START + step / 10).frame
            tagState(MAIN_TAG, 'a', frame)
        }
        assert.deepEqual(shots(frame), [], 'appear has ended')
        togglePlayback(tick)
        assert.equal(previewUi.playing, false)
        for (const later of [1, 5, 10]) assert.deepEqual(shots(stageFrame(preview, frame % 10, false, false, START + later).frame), [])
        togglePlayback(tick)
        assert.equal(previewUi.playing, true)
        frame = stageFrame(preview, frame % 10, true, false, START + 10.1).frame
        assert.deepEqual(shots(frame), [], 'playing again after 10 s stopped does not replay appear')
        assert.deepEqual(shots(stageFrame(preview, frame % 10, true, false, START + 10.2).frame), [])
        assert.deepEqual(shots(stageFrame(preview, frame % 10, true, false, START + 14).frame), ['hello'], 'playing for 3.8 s without drawing the tag still counts as unseen')
    } finally {
        stopPlayback()
        resetLive()
    }
})

test('a one-shot keeps its particle tail after the clip and a restart keeps the particles of the earlier run', () => {
    const preview = sparkPreview()
    assert.deepEqual(preview.shotTiming('pop'), { length: 4, tail: 11, appear: null })
    const record = preview.record()
    record.prime('tag', 'default', 0, [], true)
    assert.deepEqual(runs(record.update('tag', 'default', 10, ['hurt'], 1000)), ['pop@10'])
    const tail = record.update('tag', 'default', 14, ['hurt'], 1400)
    assert.deepEqual(runs(tail), ['pop@10'], 'the clip is over but its embers are still in the air')
    assert.ok(preview.paint('default', lineBlock(40, 0, 40), 14, 0, tail).some((layer) => layer.layer === 'embers'))
    record.update('tag', 'default', 15, [], 1500)
    assert.deepEqual(runs(record.update('tag', 'default', 16, ['hurt'], 1600)), ['pop@10', 'pop@16'])
    record.update('tag', 'default', 17, [], 1700)
    assert.deepEqual(runs(record.update('tag', 'default', 18, ['hurt'], 1800)), ['pop@16', 'pop@18'], 'a restart keeps the run it cut short as a tail')
    assert.deepEqual(runs(record.update('tag', 'default', 27, ['hurt'], 2700)), ['pop@18'])
    assert.deepEqual(runs(record.update('tag', 'default', 29, ['hurt'], 2900)), [])
    const layers = preview.paint('default', lineBlock(40, 0, 40), 0, 0)
    assert.deepEqual(layers.map((layer) => [layer.layer, layer.rasterWidth > 0]), [['body', true], ['embers', false]], 'a layer with nothing in the basic picture stays listed so the full preview can still draw it')
})

test('a one-shot that ends on the frame its trigger fires again starts again', () => {
    const record = sparkPreview().record()
    record.prime('tag', 'default', 0, [], true)
    assert.deepEqual(runs(record.update('tag', 'default', 0, ['on_fire'], 0)), ['once@0'])
    record.update('tag', 'default', 2, [], 200)
    assert.deepEqual(runs(record.update('tag', 'default', 4, ['on_fire'], 400)), ['once@4'])
    record.update('tag', 'default', 5, [], 500)
    assert.equal(record.fire('tag', 'once', 8), true, 'a manual play right as the clip ends starts it again')
})

test('appear plays again after the tag was out of sight for its authored time', () => {
    const record = sparkPreview().record()
    assert.deepEqual(runs(record.update('tag', 'default', 0, [], 0)), ['hello@0'])
    assert.deepEqual(runs(record.update('tag', 'default', 1, [], 100)), ['hello@0'])
    assert.deepEqual(runs(record.update('tag', 'default', 20, [], 2000)), [], '1.9 s away is under the authored 2 s')
    assert.deepEqual(runs(record.update('tag', 'default', 40, [], 4000)), ['hello@40'], '2 s away plays it again')
    assert.deepEqual(runs(record.update('tag', 'default', 80, [], 8000)), ['hello@80'])
    assert.deepEqual(runs(record.update('tag', 'default', 70, [], 7000)), [], 'a rewind does not count as unseen')
})

test('the basic and full previews derive the same engine seed for a tag', () => {
    assert.deepEqual([engineSeed(0n, 0n, 0n), engineSeed(1n, 2n, 3n), engineSeed((1n << 64n) - 1n, 0x0123456789abcdefn, 7n)], [0x1e35cdb4bf4f6f16n, 0xcead1f2fa8f8a720n, 0x7e88231ba7cdf7d2n])
    assert.deepEqual([previewWearer(0), previewWearer(42.7), previewWearer(Number.NaN)], [1n, 42n, 1n])
    const identity = identityOf(sparkPreview().meta.identity)
    assert.notEqual(identity, 0n)
    assert.equal(wearerSeed(42, identity), engineSeed(42n, identity))
})

function stackFiles(layers: object[], palette: Record<string, string>, bodies: Record<string, string>, extra: Record<string, unknown> = {}): Record<string, string> {
    const files: Record<string, string> = {
        'manifest.json': JSON.stringify({ format: 1, kind: 'nameplate', id: 'stack', requires: ['nameplate', 'nameplate_masks'], fps: 6, loop: 12, text: { color: 'ink' }, layers, ...extra }),
        'palettes.json': JSON.stringify({ slots: [{ id: 'ink', ramp: ['#FFFFFF'] }, ...Object.entries(palette).map(([id, color]) => ({ id, ramp: [color] }))] }),
    }
    for (const [id, fill] of Object.entries(bodies)) files[`layers/${id}.json`] = JSON.stringify({ kind: 'body', padding: [2, 1, 2, 1], fill: { color: fill } })
    return files
}

function stackPreview(files: Record<string, string>): NameplatePreview {
    const loaded = loadBundle(files)
    assert.deepEqual(loaded.issues.filter((issue) => issue.level === 'error'), [])
    assert.ok(loaded.preview)
    return loaded.preview
}

function stackPaint(files: Record<string, string>, variant = 'default'): NameplateLayer[] {
    return stackPreview(files).paint(variant, lineBlock(40, 0, 40), 0, 0)
}

function middle(layer: NameplateLayer): number[] {
    assert.ok(layer.rasterWidth > 0 && layer.rasterHeight > 0, `${layer.layer} draws something`)
    const at = (Math.floor(layer.rasterHeight / 2) * layer.rasterWidth + Math.floor(layer.rasterWidth / 2)) * 4
    return Array.from(layer.rgba.subarray(at, at + 4))
}

const layerOf = (layers: NameplateLayer[], id: string) => layers.find((layer) => layer.layer === id)!

test('a variant that swaps a back layer for an over-text layer draws it over the name', () => {
    const files = stackFiles(
        [{ id: 'back', depth: 'background' }, { id: 'front', depth: 'over_text' }, { id: 'alt', depth: 'over_text', mask: 'front' }],
        { red: '#FF0000', blue: '#0000FF', green: '#00FF00' },
        { back: 'red', front: 'blue', alt: 'green' },
        { variants: { plain: { hide: ['alt'] }, swapped: { hide: ['alt'], swap: { back: 'alt' } } } },
    )
    const plain = layerOf(stackPaint(files, 'plain'), 'back')
    assert.deepEqual([plain.depth, plain.mask, middle(plain)], ['background', null, [255, 0, 0, 255]])
    const layers = stackPaint(files, 'swapped')
    const back = layerOf(layers, 'back')
    assert.deepEqual([back.depth, back.mask, middle(back)], ['over_text', 'front', [0, 255, 0, 255]])
    assert.deepEqual(inDrawOrder(layers).filter((layer) => layer.rasterWidth > 0).map((layer) => [layer.layer, layer.depth]), [['back', 'over_text'], ['front', 'over_text']])
})

test('the basic preview asks the engine for one raster per painted frame however many layers the plate has', () => {
    const ids = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7']
    const preview = stackPreview(stackFiles(
        ids.map((id, index) => ({ id, depth: index % 2 ? 'over_text' : 'background' })),
        { red: '#FF0000', blue: '#0000FF' },
        Object.fromEntries(ids.map((id, index) => [id, index % 2 ? 'blue' : 'red'])),
        { animations: { loop: { tracks: { l0: { position: [[0, [0, 0]], [11, [4, 0]]] } } } } },
    ))
    const asset = preview.asset
    let calls = 0
    const raster = asset.raster.bind(asset)
    const rasterLayers = asset.rasterLayers.bind(asset)
    asset.raster = (...args) => (calls++, raster(...args))
    asset.rasterLayers = (...args) => (calls++, rasterLayers(...args))
    const block = lineBlock(40, 0, 40)
    for (let frame = 0; frame < 6; frame++) {
        const before = calls
        const layers = preview.paint('default', block, frame, 7)
        preview.platePose('default', block, frame, 7, null, undefined)
        assert.equal(calls - before, 1, `frame ${frame}`)
        assert.deepEqual(layers.map((layer) => layer.layer), ids)
        assert.ok(layers.every((layer) => layer.rasterWidth > 0))
    }
    assert.deepEqual(middle(layerOf(preview.paint('default', block, 0, 7), 'l3')), [0, 0, 255, 255])
})

function drawLog(drawn: unknown[]) {
    return {
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        save() {},
        restore() {},
        drawImage(source: unknown) {
            drawn.push([this.globalCompositeOperation, source])
        },
    } as unknown as CanvasRenderingContext2D
}

test('the basic preview keeps every draw pass of a layer and draws them in order', () => {
    const preview = stackPreview(stackFiles([{ id: 'glow', depth: 'background' }], { red: '#FF0000' }, { glow: 'red' }))
    const asset = preview.asset
    const rasterLayers = asset.rasterLayers.bind(asset)
    asset.rasterLayers = (...args) => {
        const image = rasterLayers(...args)
        return {
            ...image,
            layers: image.layers.map((entry) => {
                const left = new Uint8ClampedArray(entry.data)
                const right = new Uint8ClampedArray(entry.data)
                for (let at = 0; at < entry.data.length; at += 4) {
                    if ((at / 4) % image.width >= image.width / 2) left[at + 3] = 0
                    else right[at + 3] = 0
                    right[at + 1] = 200
                }
                return { ...entry, passes: [left, right] }
            }),
        }
    }
    const glow = layerOf(preview.paint('default', lineBlock(40, 0, 40), 0, 0), 'glow')
    assert.equal(glow.passes.length, 2)
    for (const pass of glow.passes) assert.equal(pass.length, glow.rasterWidth * glow.rasterHeight * 4)
    const row = Math.floor(glow.rasterHeight / 2) * glow.rasterWidth
    const alphaAt = (pass: Uint8ClampedArray, x: number) => pass[(row + x) * 4 + 3]
    const right = glow.rasterWidth - 1
    assert.ok(alphaAt(glow.passes[0], 0) > 0 && alphaAt(glow.passes[1], right) > 0)
    assert.deepEqual([alphaAt(glow.passes[0], right), alphaAt(glow.passes[1], 0), glow.passes[1][(row + right) * 4 + 1]], [0, 0, 200])
    const drawn: unknown[] = []
    const first = {} as CanvasImageSource
    const second = {} as CanvasImageSource
    drawRasterLayer(drawLog(drawn), { ...glow, blend: 'additive' }, 1, 0, 0, { raster: [first, second] })
    assert.deepEqual(drawn, [['lighter', first], ['lighter', second]])
})

class PixelCanvas {
    private size = [0, 0]
    data = new Uint8ClampedArray(0)
    readonly context: PixelContext
    constructor(width = 0, height = 0) {
        this.context = new PixelContext(this)
        this.width = width
        this.height = height
    }
    get width() {
        return this.size[0]
    }
    set width(value: number) {
        this.size[0] = value
        this.data = new Uint8ClampedArray(this.size[0] * this.size[1] * 4)
    }
    get height() {
        return this.size[1]
    }
    set height(value: number) {
        this.size[1] = value
        this.data = new Uint8ClampedArray(this.size[0] * this.size[1] * 4)
    }
    getContext() {
        return this.context
    }
}

class PixelContext {
    globalAlpha = 1
    globalCompositeOperation = 'source-over'
    imageSmoothingEnabled = true
    private matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    private stack: Array<[number, string, { a: number, b: number, c: number, d: number, e: number, f: number }]> = []
    constructor(readonly canvas: PixelCanvas) {}
    save() {
        this.stack.push([this.globalAlpha, this.globalCompositeOperation, { ...this.matrix }])
    }
    restore() {
        const top = this.stack.pop()
        if (top) [this.globalAlpha, this.globalCompositeOperation, this.matrix] = top
    }
    getTransform() {
        return { ...this.matrix }
    }
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
        this.matrix = { a, b, c, d, e, f }
    }
    getImageData(x: number, y: number, width: number, height: number) {
        const data = new Uint8ClampedArray(width * height * 4)
        for (let row = 0; row < height; row++) data.set(this.canvas.data.subarray(((y + row) * this.canvas.width + x) * 4, ((y + row) * this.canvas.width + x + width) * 4), row * width * 4)
        return { data, width, height }
    }
    putImageData(image: { data: Uint8ClampedArray, width: number, height: number }, x: number, y: number) {
        for (let row = 0; row < image.height; row++) this.canvas.data.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4), ((y + row) * this.canvas.width + x) * 4)
    }
    clearRect(x: number, y: number, width: number, height: number) {
        for (let row = y; row < y + height; row++) this.canvas.data.fill(0, (row * this.canvas.width + x) * 4, (row * this.canvas.width + x + width) * 4)
    }
    drawImage(source: PixelCanvas, x: number, y: number) {
        assert.equal(this.globalCompositeOperation, 'source-over')
        for (let row = 0; row < source.height; row++) {
            for (let col = 0; col < source.width; col++) {
                const from = (row * source.width + col) * 4
                const to = ((y + row) * this.canvas.width + x + col) * 4
                const blended = blendPixel(pack(source.data.subarray(from, from + 4)), pack(this.canvas.data.subarray(to, to + 4)))
                this.canvas.data.set(unpack(blended), to)
            }
        }
    }
}

const pack = (n: ArrayLike<number>) => (n[3] * 0x1000000 + (n[0] << 16) + (n[1] << 8) + n[2]) >>> 0
const unpack = (value: number) => [(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff, value >>> 24]

test('the basic preview blends additive passes like the engine, keeping the larger alpha', () => {
    const red = (alpha: number) => [255, 0, 0, alpha]
    const first = new Uint8ClampedArray([...red(128), ...red(0)])
    const second = new Uint8ClampedArray([...red(128), ...red(128)])
    const layer = {
        index: 0, layer: 'glow', depth: 'background', x: 0, y: 0, mirrorX: false, width: 2, opacity: 255, left: 0, top: 0,
        rasterWidth: 2, rasterHeight: 1, rgba: second, passes: [first, second], blend: 'additive', quads: 0, mask: null,
    } as NameplateLayer
    const pixel = (canvas: PixelCanvas, x: number, y: number) => Array.from(canvas.data.subarray((y * canvas.width + x) * 4, (y * canvas.width + x + 1) * 4))
    const scope = globalThis as any
    scope.document = { createElement: () => new PixelCanvas() }
    try {
        const empty = new PixelCanvas(6, 3)
        drawRasterLayer(empty.context as unknown as CanvasRenderingContext2D, layer, 2, 1, 1)
        const engine = flattenRasterLayers([{ blend: 'additive', data: second, passes: [first, second] }])
        assert.deepEqual(pixel(empty, 1, 1), Array.from(engine.subarray(0, 4)), 'two half-transparent red passes stay half-transparent')
        assert.equal(pixel(empty, 1, 1)[3], 128)
        assert.deepEqual(pixel(empty, 2, 2), pixel(empty, 1, 1), 'each raster pixel covers a 2x2 block')
        assert.deepEqual(pixel(empty, 3, 1), Array.from(engine.subarray(4, 8)))
        assert.deepEqual([pixel(empty, 0, 0), pixel(empty, 5, 1)], [[0, 0, 0, 0], [0, 0, 0, 0]], 'pixels outside the layer stay untouched')

        const base = new PixelCanvas(2, 1)
        base.data.set([0, 0, 255, 100, 0, 0, 255, 100])
        drawRasterLayer(base.context as unknown as CanvasRenderingContext2D, layer, 1, 0, 0)
        const blue = 0x640000ff
        assert.deepEqual(pixel(base, 0, 0), unpack(blendPixel(pack(red(128)), blendPixel(pack(red(128)), blue, 'additive'), 'additive')), 'over a translucent pixel the engine rule applies too')
        assert.deepEqual(pixel(base, 1, 0), unpack(blendPixel(pack(red(128)), blue, 'additive')))

        const mirrored = new PixelCanvas(2, 1)
        drawRasterLayer(mirrored.context as unknown as CanvasRenderingContext2D, { ...layer, mirrorX: true, opacity: 128 }, 1, 0, 0)
        const faded = (alpha: number) => Math.round(alpha * (128 / 255))
        const half = flattenRasterLayers([{ blend: 'additive', data: second, passes: [new Uint8ClampedArray([...red(faded(128)), ...red(0)]), new Uint8ClampedArray([...red(faded(128)), ...red(faded(128))])] }])
        assert.deepEqual([pixel(mirrored, 1, 0), pixel(mirrored, 0, 0)], [Array.from(half.subarray(0, 4)), Array.from(half.subarray(4, 8))], 'a mirrored layer puts its first column on the right, faded by its opacity')

        const passCanvas = (data: Uint8ClampedArray) => {
            const canvas = new PixelCanvas(2, 1)
            canvas.data.set(data)
            return canvas
        }
        const tinted = new PixelCanvas(2, 1)
        drawRasterLayer(tinted.context as unknown as CanvasRenderingContext2D, layer, 1, 0, 0, { raster: [passCanvas(first), passCanvas(second)] as unknown as CanvasImageSource[] })
        assert.deepEqual(Array.from(tinted.data), Array.from(engine), 'pictures handed in by the preview light blend the same way')
    } finally {
        delete scope.document
    }
})

test('graphics card read-back is turned from premultiplied into straight alpha and flipped', () => {
    const pixels = new Uint8Array([64, 32, 0, 128, 10, 20, 30, 255, 0, 0, 0, 0, 255, 255, 255, 255])
    assert.deepEqual(Array.from(straightRows(pixels, 2, 2)), [0, 0, 0, 0, 255, 255, 255, 255, 128, 64, 0, 128, 10, 20, 30, 255])
})

function walk(root: string, base = ''): string[] {
    return readdirSync(join(root, base)).flatMap((name) => {
        const path = base ? `${base}/${name}` : name
        return statSync(join(root, path)).isDirectory() ? walk(root, path) : [path]
    })
}

function drawnParts(out: Int32Array): Array<{ layer: number, area: number }> {
    const at = out[OUT.OUT_HEADER + OUT.DIR_OFFSET]
    const opsAt = at + OUT.TAG_HEAD
    const parts: Array<{ layer: number, area: number }> = []
    for (let k = 0; k < out[at + OUT.HEAD_OPS]; k++) {
        const op = opsAt + k * OUT.OP_WORDS
        parts.push({ layer: (out[op + OUT.OP_BAND_LAYER_KIND] >> 8) & 0xff, area: (out[op + OUT.OP_X1] - out[op + OUT.OP_X0]) * (out[op + OUT.OP_Y1] - out[op + OUT.OP_Y0]) })
    }
    let material = opsAt + out[at + OUT.HEAD_OPS] * OUT.OP_WORDS
    for (let m = 0; m < out[at + OUT.HEAD_MATERIALS]; m++) {
        parts.push({ layer: (out[material + OUT.MAT_BAND_LAYER] >> 8) & 0xff, area: (out[material + OUT.MAT_AREA_X1] - out[material + OUT.MAT_AREA_X0]) * (out[material + OUT.MAT_AREA_Y1] - out[material + OUT.MAT_AREA_Y0]) })
        material += OUT.MAT_FIXED + out[material + OUT.MAT_CLIP_COUNT] * OUT.CLIP_WORDS + out[material + OUT.MAT_UNIFORM_WORDS]
    }
    return parts
}

function frameOf(preview: NameplatePreview, shot?: string): Int32Array {
    const nameplates = preview.asset.engine.nameplates()
    try {
        const id = nameplates.addAsset(preview.asset)
        const row = blockRow(lineBlock(40, 0, 40), id, 0)
        const quiet = new Float32Array(OUT.SIGNAL_FLOATS)
        const first = nameplates.frame(0.05, [1n], row, quiet)
        if (!shot) return first.slice()
        assert.ok(nameplates.fire(1n, id, preview.oneShots.indexOf(shot)))
        return nameplates.frame(0.35, [1n], row, quiet).slice()
    } finally {
        nameplates.free()
    }
}

function checkOnlyLayer(out: Int32Array) {
    const parts = drawnParts(out)
    const slots = Array.from(new Set(parts.filter((part) => part.area !== 0).map((part) => part.layer)))
    assert.ok(slots.length >= 2, `${slots}`)
    for (const slot of slots) {
        const only = drawnParts(onlyLayer(out, slot))
        assert.equal(only.length, parts.length)
        only.forEach((part, i) => assert.equal(part.area, part.layer === slot ? parts[i].area : 0, `slot ${slot} part ${i}`))
    }
}

test('the full preview draws one layer at a time from the engine draw output, each with its own box', () => {
    const out = frameOf(sparkPreview(), 'pop')
    checkOnlyLayer(out)
    const boxes = drawnBoxes(out)
    const parts = drawnParts(out).filter((part) => part.area !== 0)
    assert.deepEqual(Array.from(boxes.keys()).sort(), Array.from(new Set(parts.map((part) => part.layer))).sort())
    for (const box of boxes.values()) {
        assert.ok(box.x1 > box.x0 && box.y1 > box.y0)
        assert.equal(box.material, false)
    }
})

test('a material layer draws alone, has a marked box and an additive one draws lighter in the basic preview', { skip: existsSync(join(KITS, 'material_plate')) ? false : 'no material_plate kit' }, () => {
    const files: Record<string, string> = {}
    const binary: Record<string, Uint8Array> = {}
    for (const path of walk(join(KITS, 'material_plate'))) {
        if (path.endsWith('.json')) files[path] = readFileSync(join(KITS, 'material_plate', path), 'utf8')
        else binary[path] = new Uint8Array(readFileSync(join(KITS, 'material_plate', path)))
    }
    const preview = loadBundle(files, binary).preview
    assert.ok(preview)
    const out = frameOf(preview)
    assert.ok(out[out[OUT.OUT_HEADER + OUT.DIR_OFFSET] + OUT.HEAD_MATERIALS] > 0)
    checkOnlyLayer(out)
    assert.ok(Array.from(drawnBoxes(out).values()).some((box) => box.material), 'only body and sprite layers get the preview light')
    const layers = preview.paint(preview.variants[0], lineBlock(40, 0, 40), 0, 0)
    assert.deepEqual([layerOf(layers, 'halo').blend, layerOf(layers, 'crest').blend], ['additive', 'normal'])
    const drawn: unknown[] = []
    drawRasterLayer(drawLog(drawn), layerOf(layers, 'halo'), 1, 0, 0, { raster: {} as CanvasImageSource })
    assert.deepEqual(drawn.map((entry) => (entry as unknown[])[0]), ['lighter'])
})

test('the full preview draws at the zoom it is shown at, within the surface limit', () => {
    assert.deepEqual([glPixelScale(100, 20, 6), glPixelScale(100, 20, 0), glPixelScale(100, 20, 64), glPixelScale(1000, 20, 8), glPixelScale(10000, 20, 8)], [6, 1, 16, 4.096, 1])
    assert.deepEqual(opaqueBox([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4], 2, 2), [1, 1, 1, 1])
    assert.equal(opaqueBox([0, 0, 0, 0], 1, 1), null)
})

test('the full preview draws on a surface the size of the stage so screen effects use stage positions', () => {
    const near = surfacePlan({ width: 800, height: 400, originX: 120, originY: 60 }, 8)
    assert.deepEqual(near, { pixels: 8, width: 800, height: 400, originX: 120, originY: 60 })
    assert.deepEqual(surfacePlan({ width: 800, height: 400, originX: 120, originY: 60 }, 32), { pixels: 16, width: 400, height: 200, originX: 60, originY: 30 })
    const moved = surfacePlan({ width: 800, height: 400, originX: 200, originY: 60 }, 8)
    const box = { x0: 0, y0: 0, x1: 10, y1: 4, material: true }
    assert.deepEqual(surfaceBox(box, near, 2, 1), { x0: 136, y0: 68, x1: 216, y1: 100, material: true })
    assert.deepEqual(surfaceBox(box, moved, 2, 1), { x0: 216, y0: 68, x1: 296, y1: 100, material: true })
    assert.deepEqual(surfaceBox(box, near, -30, 0), null)
    assert.deepEqual(surfaceBox({ x0: 0, y0: 0, x1: 200, y1: 4, material: false }, near, 0, 0), { x0: 120, y0: 60, x1: 800, y1: 92, material: false })
    assert.ok(surfacePlan({ width: 6000, height: 400, originX: 0, originY: 0 }, 8).width <= 4096)
})

test('the full preview keeps cached pictures under a byte limit and drops the oldest set first', () => {
    const sets = new ImageSets<string>(10, 100)
    for (const id of ['a', 'b']) sets.set(id, id, 40)
    assert.equal(sets.get('a'), 'a')
    sets.set('c', 'c', 40)
    assert.deepEqual([sets.has('a'), sets.has('b'), sets.has('c'), sets.bytes], [true, false, true, 80])
    sets.set('huge', 'huge', 500)
    assert.deepEqual([sets.has('huge'), sets.size, sets.bytes], [false, 2, 80])
    sets.set('a', 'too big now', 101)
    assert.deepEqual([sets.has('a'), sets.bytes], [false, 40])
    sets.set('d', 'd', 100)
    assert.deepEqual([sets.has('c'), sets.has('d'), sets.bytes], [false, true, 100])
    const many = new ImageSets<number>(3, 1000)
    for (let i = 0; i < 5; i++) many.set(String(i), i, 0)
    assert.deepEqual([many.size, many.has('1')], [3, false])
})

test('the full preview dims body and sprite layers by the preview light, and comparing covers pixels outside the basic box', () => {
    const rgba = new Uint8ClampedArray([200, 100, 50, 255, 9, 9, 9, 0])
    litRows(rgba, [0.5, 0.5, 1])
    assert.deepEqual(Array.from(rgba), [100, 50, 50, 255, 9, 9, 9, 0])
    const layer = { index: 3, rasterWidth: 0, rasterHeight: 0, left: 5, top: 5, x: 0, y: 0, mirrorX: false, width: 0 } as unknown as NameplateLayer
    const image = { image: { width: 8, height: 4 } as HTMLCanvasElement, left: 2, top: -1, scale: 2 }
    assert.deepEqual(comparedBounds([layer], new Map([[3, image]])), { minX: 2, minY: -1, width: 4, height: 2 })
})

function readingFiles(): Record<string, string> {
    return plateFiles({ animations: { loop: { tracks: { body: { position: [[0, ['q.is_sneaking * 4 + Query.Is_In_Rain_time * 0', 'q.ground_speed']]] } } } } })
}

test('every signal a plate reads gets a Try it control, even without a reaction', () => {
    assert.deepEqual(programSignals(readingFiles()), ['is_sneaking', 'is_in_rain', 'ground_speed'])
    assert.deepEqual(programSignals({ 'a.json': JSON.stringify({ x: 'q.ground_speed_time + q.mystery + v.is_sneaking' }), 'b.txt': 'q.is_hurt' }), [])
    const preview = loadPlate(readingFiles())
    assert.deepEqual(preview.reactions, ['sneaking', 'is_in_rain'])
    assert.deepEqual(preview.levels, ['ground_speed'])
    const block = lineBlock(40, 0, 40)
    const corner = (state: ReturnType<typeof stateOf>) => {
        const layers = preview.paint('', block, 0, 0, state)
        return [Math.min(...layers.map((layer) => layer.left)), Math.min(...layers.map((layer) => layer.top))]
    }
    assert.notEqual(corner(stateOf(['sneaking']))[0], corner(stateOf([]))[0])
    assert.notEqual(corner(stateOf([], false, { ground_speed: 3 }))[1], corner(stateOf([]))[1])
    const speed = signalsOf(['is_sneaking'], { ground_speed: 3, is_sneaking: 0 })
    assert.deepEqual([speed[SIGNALS.indexOf('ground_speed')], speed[SIGNALS.indexOf('is_sneaking')]], [3, 1])
    try {
        const frame = absoluteFrame(preview, 0, false)
        setSignalValue('ground_speed', 3)
        setSignalValue('time_of_day', 0.5)
        assert.deepEqual(tagState(MAIN_TAG, '', frame)?.values, { ground_speed: 3 })
        assert.deepEqual(stillState(preview).values, { ground_speed: 3 })
        setSignalValue('ground_speed', 0)
        assert.equal(tagState(MAIN_TAG, '', frame + 1)?.values, undefined)
    } finally {
        resetLive()
    }
    assert.deepEqual(liveUi.values, {})
    const layers = preview.paint('', block, 0, 0, stateOf([], false, { ground_speed: 3 }))
    assert.equal(preview.hasMaterials, false)
    assert.deepEqual(replayJob(layers)?.state?.values, { ground_speed: 3 }, 'a plate with only body and sprite layers still goes through the full replay')
})

test('with full effects, letter and plate poses follow real signal values and edge times', () => {
    const loaded = loadBundle(plateFiles({
        requires: ['nameplate', 'nameplate_letters'],
        text: { mode: 'motion', motion: 'q.ground_speed + q.is_sneaking_time * 10' },
        animations: { loop: { tracks: { $plate: { position: [[0, ['q.ground_speed', 0]]] } } } },
    }))
    assert.deepEqual(loaded.issues.filter((issue) => issue.level === 'error'), [])
    const preview = loaded.preview
    assert.ok(preview)
    const block = lineBlock(24, 0, 24)
    const glyphX = Int32Array.from([0, 6, 12, 18])
    const glyphWidth = Int32Array.from([6, 6, 6, 6])
    const speed = (value: number) => stateOf([], false, { ground_speed: value })
    const sneaking = (held: number) => ({ ...stateOf(['sneaking']), heldBy: { is_sneaking: held }, held })
    const plate = (state: ReturnType<typeof stateOf>) => preview.platePose('', block, 40, 0, state).dx
    const lift = (state: ReturnType<typeof stateOf>) => preview.letters!('', block, 40, 0, glyphX, glyphWidth, state)?.dy[0]
    assert.equal(plate(speed(1)), plate(speed(3)), 'the basic preview only knows the signal is on')
    assert.equal(lift(speed(1)), lift(speed(3)))
    setFullReplay(() => true)
    try {
        assert.deepEqual([plate(speed(1)), plate(speed(3)), plate(stateOf([]))], [1, 3, 0])
        assert.notEqual(lift(speed(1)), lift(speed(3)), 'letters read the real speed')
        assert.notEqual(lift(sneaking(2)), lift(sneaking(10)), 'letters read how long the signal has been on')
    } finally {
        setFullReplay(null)
    }
})
