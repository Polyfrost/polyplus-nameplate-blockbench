import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { archiveProblem, archiveSize } from '../src/checks/report'
import { compile } from '../src/compile'
import { BodyData } from '../src/model'
import { EXTRA_PROPERTY } from '../src/import/extra'
import { parseBundle, planImport } from '../src/import/plan'
import { loadBundle, reactionSignal } from '../src/engine'
import { sampleByKey, sampleFiles } from '../src/samples'
import { sampleSnapshot } from './plateKit'

test('a sample project compiles to a bundle the engine loads', () => {
    const bundle = compile(sampleSnapshot())
    assert.deepEqual(bundle.issues, [])
    const manifest = JSON.parse(bundle.files['manifest.json'])
    assert.equal(manifest.id, 'new_nameplate')
    assert.equal(manifest.kind, 'nameplate')
    assert.deepEqual(manifest.requires, ['nameplate'])
    assert.deepEqual(manifest.layers.map((layer: { id: string }) => layer.id), ['plate'])
    assert.equal(JSON.parse(bundle.files['layers/plate.json']).kind, 'body')
    assert.ok(bundle.files['palettes.json'])
    assert.equal('version' in manifest, false)
    assert.equal(archiveProblem(archiveSize(bundle.files, bundle.binary ?? {}), null, false), null)
})

test('an imported bundle keeps requires the engine does not know, next to the ones it works out', () => {
    const exported = compile(sampleSnapshot())
    const manifest = JSON.parse(exported.files['manifest.json'])
    const files = { ...exported.files, 'manifest.json': JSON.stringify({ ...manifest, requires: ['nameplate', 'future_glow'] }) }
    const plan = planImport(parseBundle(files).bundle!)
    const kept = plan.extra.patches.filter((patch) => patch.file === 'manifest.json' && patch.path.join() === 'requires')
    assert.deepEqual(kept.map((patch) => patch.value), [['future_glow']])
    const host = globalThis as any
    host.Project = { [EXTRA_PROPERTY]: plan.extra }
    try {
        assert.deepEqual(JSON.parse(compile(sampleSnapshot()).files['manifest.json']).requires, ['nameplate', 'future_glow'])
    } finally {
        delete host.Project
    }
})

test('imported setting tracks are dropped with a note, since the game cannot animate effect settings', () => {
    const files = sampleFiles(sampleByKey('night_lights')!)
    const manifest = JSON.parse(files['manifest.json'])
    manifest.animations.sneak_dim.tracks.curtain = { 'param.glow': [[0, 0.5]], opacity: [[0, 0.5]] }
    manifest.animations.loop = { tracks: { curtain: { 'param.glow': [[0, 1], [9, 0.5, 'linear']] } } }
    const plan = planImport(parseBundle({ ...files, 'manifest.json': JSON.stringify(manifest) }).bundle!)
    assert.deepEqual(plan.dropped.filter((note) => note.includes('param.glow')), [
        "Animation 'sneak_dim': param.glow track on curtain (the game can't animate effect settings)",
        "Loop param.glow track on curtain (the game can't animate effect settings)",
    ])
    const sneak = plan.animations.find((animation) => animation.name === 'sneak_dim')
    assert.ok(sneak)
    assert.deepEqual(sneak.tracks.map((track) => [track.target, track.channel]), [['curtain', 'opacity']])
    assert.equal(plan.tracks.some((track) => String(track.channel).startsWith('param.')), false)
    assert.equal(plan.extra.patches.some((patch) => JSON.stringify(patch.path).includes('param.')), false)
})

test('the night lights sample only animates channels the engine accepts', { skip: !existsSync(resolve('..', 'plusrenderer')) }, () => {
    const files = sampleFiles(sampleByKey('night_lights')!)
    const manifest = JSON.parse(files['manifest.json'])
    for (const animation of Object.values<any>(manifest.animations)) {
        if (animation.trigger?.reaction) animation.trigger.reaction = reactionSignal(animation.trigger.reaction)
    }
    const loaded = loadBundle({ ...files, 'manifest.json': JSON.stringify(manifest) }, {})
    assert.deepEqual(loaded.issues, [])
})

test('random animation timing is exported, loaded and imported in frames on a layer that holds frames', { skip: !existsSync(resolve('..', 'plusrenderer')) }, () => {
    const snapshot = sampleSnapshot()
    snapshot.layers = [{ ...snapshot.layers[0], step: 4 } as BodyData]
    snapshot.animations = [{
        uuid: '00000000-0000-4000-8000-000000000002',
        name: 'blink',
        trigger: null,
        schedule: { window: 12, jitter: 6, chance: 1, weight: 1, id: null },
        length: 6,
        restart: false,
        tracks: [{
            target: 'plate',
            channel: 'opacity',
            keys: [
                { step: 0, value: 1, interpolation: 'step' },
                { step: 1, value: 0.5, interpolation: 'step' },
                { step: 2, value: 0, interpolation: 'step' },
                { step: 5, value: 1, interpolation: 'step' },
            ],
        }],
    }]
    const bundle = compile(snapshot)
    assert.deepEqual(bundle.issues, [])
    const exported = JSON.parse(bundle.files['manifest.json']).animations.blink
    assert.deepEqual(exported.schedule, { window: 12, jitter: 6, chance: 1 })
    assert.equal(exported.length, 6)
    assert.deepEqual(exported.tracks.plate.opacity.map((key: unknown[]) => key[0]), [0, 1, 2, 5])
    assert.deepEqual(loadBundle(bundle.files, {}).issues, [])
    const plan = planImport(parseBundle(bundle.files).bundle!)
    const imported = plan.animations.find((animation) => animation.name === 'blink')!
    assert.deepEqual(imported.schedule, { window: 12, jitter: 6, chance: 1, weight: 1, id: null })
    assert.equal(imported.length, 6)
    assert.deepEqual(imported.tracks[0].keys.map((key) => key.step), [0, 1, 2, 5])
})
