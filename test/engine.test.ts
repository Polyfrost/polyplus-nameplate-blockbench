import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { classifyIssue } from '../src/checks/codes'
import {
    displayBlock,
    disposeLoad,
    engineAnchors,
    engineLimits,
    engineNodes,
    engineSignals,
    layerBounds,
    lineBlock,
    loadBundle,
    materialLimits,
    materialNodeCost,
    NameplatePreview,
    nameplateLimits,
    placedBlock,
    holdPreview,
    previewHolds,
    previewOfLoad,
    PreviewSlot,
    releasePreview,
    stateOf,
} from '../src/engine'
import { packAtlas } from '../src/engine/gl'
import { placeholderPixels } from '../src/gpu/placeholder'
import { NODE_SPECS, specOf } from '../src/nodes/catalog'
import { nodeWeigher } from '../src/nodes/weights'
import { REACTIONS } from '../src/model'
import { ANCHORS } from '../src/elements/read'
import { SPRITE_ANCHORS } from '../src/art/layout'
import { reactionSignal } from '../src/engine/load'

const KITS = resolve(process.env.PLUSRENDERER_TESTDATA ?? join('..', 'plusrenderer', 'crates', 'core', 'src', 'nameplate', 'format', 'testdata'))

function walk(root: string, base = ''): string[] {
    return readdirSync(join(root, base)).flatMap((name) => {
        const path = base ? `${base}/${name}` : name
        return statSync(join(root, path)).isDirectory() ? walk(root, path) : [path]
    })
}

function kit(name: string): { files: Record<string, string>, binary: Record<string, Uint8Array> } {
    const files: Record<string, string> = {}
    const binary: Record<string, Uint8Array> = {}
    for (const path of walk(join(KITS, name))) {
        if (path.endsWith('.json')) files[path] = readFileSync(join(KITS, name, path), 'utf8')
        else binary[path] = new Uint8Array(readFileSync(join(KITS, name, path)))
    }
    return { files, binary }
}

const kits = existsSync(KITS) ? readdirSync(KITS).filter((name) => existsSync(join(KITS, name, 'manifest.json'))) : []

function painted(preview: NameplatePreview, lines: number): number {
    const block = lines === 1 ? lineBlock(40, 0, 40) : displayBlock([30, 40, 24].slice(0, lines), 40, 'center', 1, 0, 40, false)
    let pixels = 0
    for (const variant of preview.variants) {
        for (const frame of [0, 3, preview.loop - 1]) {
            const layers = preview.paint(variant, block, frame, 7, stateOf([]))
            for (const layer of layers) {
                assert.equal(layer.rgba.length, layer.rasterWidth * layer.rasterHeight * 4)
                for (let at = 3; at < layer.rgba.length; at += 4) if (layer.rgba[at] > 0) pixels++
            }
        }
    }
    return pixels
}

function hostTexturesOnly(preview: NameplatePreview): boolean {
    const shaders = preview.asset.shaders('es_300').shaders
    const materialsOnly = preview.meta.layers?.every((layer) => layer.content === 'material') ?? false
    return materialsOnly && shaders.every((shader) => shader.samplers.length > 0 && shader.samplers.every((sampler) => sampler.texture.kind !== 'bundle'))
}

test('the kit bundles load and draw through plusrenderer', { skip: kits.length === 0 ? `no kit bundles at ${KITS}` : false }, () => {
    for (const name of kits) {
        const { files, binary } = kit(name)
        const loaded = loadBundle(files, binary)
        assert.deepEqual(loaded.issues, [], `${name}: ${JSON.stringify(loaded.issues)}`)
        assert.equal(loaded.skipped, null, name)
        const preview = loaded.preview
        assert.ok(preview, name)
        assert.equal(preview.id, name)
        assert.ok(preview.variants.length >= 1, name)
        if (!hostTexturesOnly(preview)) {
            assert.ok(painted(preview, 1) > 0, `${name} draws nothing on a one-line tag`)
            assert.ok(painted(preview, 3) > 0, `${name} draws nothing on a three-line tag`)
        }
        assert.deepEqual(preview.analysis().requires, JSON.parse(files['manifest.json']).requires, name)
        for (const issue of loaded.warnings) assert.notEqual(classifyIssue(issue).code, 'other', `${name}: ${issue.code} has no wording`)
    }
})

test('display blocks keep the top-left origin the stage draws in', { skip: kits.includes('sample_plate') ? false : 'no sample_plate kit' }, () => {
    const { files, binary } = kit('sample_plate')
    const preview = loadBundle(files, binary).preview
    assert.ok(preview)
    const block = displayBlock([30, 40, 24], 40, 'center', 1, 0, 40, true)
    assert.equal(block.width, 40 + 11)
    assert.equal(block.height, 28)
    const bounds = layerBounds(preview.paint(preview.variants[0], block, 0, 0))
    assert.ok(bounds.minY < 10 && bounds.minY + bounds.height > 10)
    const padded = placedBlock(block, 0, { x0: -2, y0: -2, x1: block.width + 2, y1: block.height + 2 })
    assert.deepEqual(padded.background, { x0: -2 - block.shiftX, y0: -2 - block.shiftY, x1: block.width + 2 - block.shiftX, y1: block.height + 2 - block.shiftY })
})

test('cost limits and node costs come from the engine', () => {
    const limits = engineLimits()
    assert.ok(limits)
    assert.deepEqual(nameplateLimits(), {
        quads: limits.quads,
        cacheBytes: limits.image_bytes,
        fallbackBytes: limits.fallback_bytes,
        cpu: limits.cpu_units,
        margin: limits.decoration_margin,
        states: limits.cached_states,
        flashes: limits.flashes_per_second,
        flashArea: limits.flash_area_pixels,
    })
    assert.equal(materialLimits()?.maxCost, limits.material_cost)
    assert.equal(materialLimits()?.toneCost, limits.material_tone_cost)
    const weigh = nodeWeigher()
    for (const node of engineNodes()) {
        const spec = NODE_SPECS.find((entry) => entry.type === node.type)
        assert.ok(spec, `the editor has no ${node.type} node`)
        assert.equal(spec.cost, node.cost.by, node.type)
        const variant = node.cost.by === 'flat' ? 0 : 1
        assert.equal(weigh(node.type, variant), node.cost.values[0], node.type)
        assert.equal(materialNodeCost(node.type, variant), node.cost.values[0], node.type)
    }
})

test('the editor offers only anchors and reactions the engine knows', () => {
    const anchors = engineAnchors()
    const signals = engineSignals()
    assert.ok(anchors.length > 0 && signals.length > 0)
    for (const anchor of [...ANCHORS, ...SPRITE_ANCHORS]) assert.ok(anchors.includes(anchor), anchor)
    for (const reaction of REACTIONS) assert.ok(signals.includes(reactionSignal(reaction)), reaction)
})

test('block sprites pack into one atlas with a texel rectangle per sprite name', () => {
    assert.equal(packAtlas([], () => placeholderPixels('atlas', 'x', false)), null)
    const names = ['minecraft:block/stone', 'minecraft:block/magma', 'minecraft:block/stone', 'block/prismarine']
    const sheet = packAtlas(names, (name) => placeholderPixels('atlas', name, false))!
    assert.deepEqual(Object.keys(sheet.sprites), ['minecraft:block/stone', 'minecraft:block/magma', 'block/prismarine'])
    assert.equal(sheet.rgba.length, sheet.width * sheet.height * 4)
    const seen = new Set<string>()
    for (const [name, [x, y, width, height]] of Object.entries(sheet.sprites)) {
        const art = placeholderPixels('atlas', name, false)
        assert.deepEqual([width, height], [art.width, art.height], name)
        assert.ok(x + width <= sheet.width && y + height <= sheet.height, name)
        assert.ok(!seen.has(`${x},${y}`), name)
        seen.add(`${x},${y}`)
        for (let row = 0; row < height; row++) {
            const from = ((y + row) * sheet.width + x) * 4
            assert.deepEqual(sheet.rgba.subarray(from, from + width * 4), art.rgba.subarray(row * width * 4, (row + 1) * width * 4), `${name} row ${row}`)
        }
    }
})

test('the node editor takes inputs and setting ranges from the engine', () => {
    for (const node of engineNodes()) {
        const spec = specOf(node.type)
        assert.ok(spec, node.type)
        for (const input of node.inputs) {
            const socket = spec.sockets.find((entry) => entry.name === input.name)
            assert.ok(socket, `${node.type}.${input.name}`)
            assert.equal(socket.accepts, input.accepts, `${node.type}.${input.name}`)
            const expected = input.required ? 'required' : input.default_node ? 'input' : input.default ? 'value' : 'absent'
            assert.equal(socket.fallback.kind, expected, `${node.type}.${input.name}`)
        }
        for (const setting of node.settings) {
            if (setting.kind === 'node') {
                assert.ok(spec.source, `${node.type}.${setting.name}`)
                continue
            }
            const found = spec.settings.find((entry) => entry.key === setting.name)
            assert.ok(found, `${node.type}.${setting.name}`)
            if (found.kind === 'int' || found.kind === 'pair') assert.deepEqual([found.min, found.max], [setting.min, setting.max], `${node.type}.${setting.name}`)
            if (found.kind === 'choice') assert.deepEqual(Object.keys(found.options), setting.choices, `${node.type}.${setting.name}`)
        }
    }
})

test('previews free their engine asset when the last holder lets go', { skip: kits.includes('sample_plate') ? false : 'no sample_plate kit' }, () => {
    const { files, binary } = kit('sample_plate')
    const block = lineBlock(40, 0, 40)
    const shared = loadBundle(files, binary)
    const preview = previewOfLoad(shared)!
    assert.ok(preview)
    holdPreview(preview)
    holdPreview(preview)
    releasePreview(preview)
    assert.equal(preview.disposed, false)
    assert.equal(previewHolds(preview), 1)
    disposeLoad(shared)
    assert.equal(preview.disposed, false)
    assert.ok(preview.paint(preview.variants[0] ?? '', block, 0, 7).length > 0)
    releasePreview(preview)
    assert.equal(preview.disposed, true)
    assert.equal(preview.asset.handle, 0)
    assert.throws(() => preview.paint(preview.variants[0] ?? '', block, 0, 7), /released/)
    assert.throws(() => preview.textures(), /released/)
    preview.dispose()

    const slot = new PreviewSlot()
    const first = loadBundle(files, binary)
    const second = loadBundle(files, binary)
    slot.set(first)
    assert.equal(slot.current, previewOfLoad(first))
    slot.set(second)
    assert.equal(previewOfLoad(first)!.disposed, true)
    assert.equal(previewOfLoad(second)!.disposed, false)
    slot.clear()
    assert.equal(previewOfLoad(second)!.disposed, true)

    const once = loadBundle(files, binary)
    disposeLoad(once)
    assert.equal(previewOfLoad(once)!.disposed, true)
})
