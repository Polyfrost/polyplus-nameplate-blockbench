import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCosmetic } from '../src/cosmetic/build'
import { buildBundle, BundleFiles } from '../src/cosmetic/bundle'
import { normalizeCosmetic } from '../src/cosmetic/data'
import { engineColorHex, particleStarter } from '../src/cosmetic/effects'
import { planCosmeticImport } from '../src/cosmetic/import'
import { encodePng } from '../src/cosmetic/png'
import { claimRig, releaseRig, rigOwner } from '../src/cosmetic/rigOwner'
import { toBase64 } from '../src/material/png'
import { animation, bone, cosmetic, geometry, paintedTexture, sources } from './cosmeticKit'

const GLOW = ['#FF202020', '#FF808080', '#FFE0E0E0']

function trailEffect(trails: number) {
    const ribbon = encodePng(2, 2, new Uint8Array(16).fill(90), 4)
    const spark = encodePng(2, 2, new Uint8Array(16).fill(200), 4)
    const data = cosmetic('effect', 'sparks', (d) => {
        d.palette = { slots: [{ id: 'glow', name: 'Glow', ramp: GLOW, customizable: false }], colorways: {}, fixed: [] }
        d.effects.pictures = { ribbon: toBase64(ribbon), spark: toBase64(spark) }
        d.effects.particles = [{ ...particleStarter('spark'), picture: 'spark' }]
        d.effects.sounds = [{ id: 'chime', file: '', vanilla: 'minecraft:block.note_block.chime', volume: 1, pitch: 1 }]
        d.effects.emitters = [{ particle: 'spark', sound: '', vanilla: '', locator: '', count: 1 }]
        d.effects.trails = Array.from({ length: trails }, () => ({ locator: 'back', picture: 'ribbon', blend: 'alpha' as const, width: [0.25, 0.25] as [number, number], tile: false, tint: { kind: 'color' as const, color: '#FFFFFF' }, fade: 1, minSpeed: 0, while: [] }))
    })
    return buildCosmetic(data, sources(() => {}))
}

function withManifest(built: BundleFiles, change: (manifest: any) => void): BundleFiles {
    const manifest = JSON.parse(built.files['manifest.json'])
    change(manifest)
    return { files: { ...built.files, 'manifest.json': JSON.stringify(manifest) }, binary: built.binary }
}

function rebuilt(input: BundleFiles): BundleFiles {
    const plan = planCosmeticImport(input)
    return buildBundle(plan.read.data, plan.read.sources, plan.read.requires)
}

function rebuiltManifest(input: BundleFiles): any {
    return JSON.parse(rebuilt(input).files['manifest.json'])
}

test('colors the game reads as numbers pack to the same bytes as hex codes', () => {
    assert.equal(engineColorHex([1, 0, 0]), '#FFFF0000')
    assert.equal(engineColorHex([0, 0.5, 1, 0.25]), '#400080FF')
    assert.equal(engineColorHex([2, -1, '0.2', true]), '#FFFF0033')
    assert.equal(engineColorHex('#ff00aa'), '#FF00AA')
    assert.equal(engineColorHex(['v.x', 0, 0]), null)
    assert.equal(engineColorHex([1, 0]), null)
    assert.equal(engineColorHex('ff00aa'), null)
})

test('trail gradients keep their stop positions and numeric colors import as hex', () => {
    const input = withManifest(trailEffect(4), (m) => {
        m.trails[0].tint = { gradient: { 0: '#ff0000', 0.2: '#00ff00', 1: '#0000ff' } }
        m.trails[1].tint = [1, 0, 0]
        m.trails[2].tint = { gradient: [[0, 0.5, 1, 0.25], '#ffffff'] }
        m.trails[3].tint = ['math.sin(0)', 1, 1]
    })
    const plan = planCosmeticImport(input)
    const tints = plan.read.data.effects.trails.map((trail) => trail.tint)
    assert.deepEqual(tints, [
        { kind: 'gradient', stops: ['#FF0000', '#00FF00', '#0000FF'], at: [0, 0.2, 1] },
        { kind: 'color', color: '#FFFF0000' },
        { kind: 'gradient', stops: ['#400080FF', '#FFFFFF'] },
        { kind: 'raw', value: ['math.sin(0)', 1, 1] },
    ])
    assert.deepEqual(plan.changed, [
        "Trail 2's color [1,0,0] is now #FFFF0000",
        "Trail 3's gradient colors are now hex codes",
        "Trail 4's color is kept as written, since it can't be edited here",
    ])
    assert.deepEqual(plan.dropped, [])
    assert.deepEqual(plan.problems, [])
    assert.deepEqual(planCosmeticImport(rebuilt(input)).problems, [])
    const again = rebuiltManifest(input)
    assert.deepEqual(again.trails.map((trail: any) => trail.tint), [
        { gradient: { 0: '#FF0000', 0.2: '#00FF00', 1: '#0000FF' } },
        '#FFFF0000',
        { gradient: ['#400080FF', '#FFFFFF'] },
        ['math.sin(0)', 1, 1],
    ])
    const stored = normalizeCosmetic(JSON.parse(JSON.stringify(plan.read.data)), 'effect')
    assert.deepEqual(stored.effects.trails.map((trail) => trail.tint), tints)
})

test('a palette tint without a shade stays on the base shade through import and export', () => {
    const input = withManifest(trailEffect(2), (m) => {
        m.particles.spark = { tint: { slot: 0 } }
        m.trails[0].tint = { slot: 0 }
        m.trails[1].tint = { slot: 0, tone: 2 }
    })
    const plan = planCosmeticImport(input)
    const fx = plan.read.data.effects
    assert.deepEqual(fx.particles[0].tint, { slot: 'glow', tone: null })
    assert.deepEqual(fx.trails.map((trail) => trail.tint), [{ kind: 'slot', slot: 'glow', tone: null }, { kind: 'slot', slot: 'glow', tone: 2 }])
    assert.deepEqual(plan.problems, [])
    assert.deepEqual(planCosmeticImport(rebuilt(input)).problems, [])
    const again = rebuiltManifest(input)
    assert.deepEqual(again.particles.spark, { tint: { slot: 0 } })
    assert.deepEqual(again.trails.map((trail: any) => trail.tint), [{ slot: 0 }, { slot: 0, tone: 2 }])
    const cleared = normalizeCosmetic({ effects: { particles: [{ id: 'spark', tint: { slot: 'glow', tone: '' } }] } }, 'effect')
    assert.deepEqual(cleared.effects.particles[0].tint, { slot: 'glow', tone: null })
})

test('effect fields the plugin cannot keep are listed as not imported', () => {
    const input = withManifest(trailEffect(1), (m) => {
        m.trails[0].glow = 1
        m.emitters[0].extra = true
        m.sounds.chime = { volume: 'loud', echo: 2 }
        m.particles.spark = { tint: { slot: 4 }, size: 2 }
    })
    const plan = planCosmeticImport(input)
    assert.deepEqual([...plan.dropped].sort(), [
        'manifest.json: emitters.0.extra',
        'manifest.json: particles.spark.size',
        'manifest.json: particles.spark.tint',
        'manifest.json: sounds.chime.echo',
        'manifest.json: sounds.chime.volume',
        'manifest.json: trails.0.glow',
    ])
})

test('animation and controller files under other names are merged, not reported as dropped', () => {
    const data = cosmetic('item', 'storm', (d) => {
        d.attach = { rig: 'player', bone: 'body', replaces: '' }
        d.controllers = ['controller.animation.storm.mood']
    })
    const input = sources((s) => {
        s.geometry = geometry('storm', [bone('wings', 'body')])
        s.animations = { 'animation.storm.idle': animation(['wings']), 'animation.storm.walk': animation(['wings']) }
        s.controllers = { 'controller.animation.storm.mood': { initial_state: 'default', states: { default: { animations: ['animation.storm.idle'] } } } }
    })
    const built = buildCosmetic(data, input)
    const files = { ...built.files }
    const anims = JSON.parse(files['animations/storm.animation.json'])
    const walk = { format_version: anims.format_version, animations: { 'animation.storm.walk': anims.animations['animation.storm.walk'], 'animation.storm.idle': animation(['wings'], 2) } }
    delete anims.animations['animation.storm.walk']
    files['animations/storm.animation.json'] = JSON.stringify(anims)
    files['animations/walk.animation.json'] = JSON.stringify(walk)
    files['animation_controllers/moods.animation_controllers.json'] = files['animation_controllers/storm.animation_controllers.json']
    delete files['animation_controllers/storm.animation_controllers.json']
    files['models/wings.geo.json'] = files['models/storm.geo.json']
    delete files['models/storm.geo.json']
    const manifest = JSON.parse(files['manifest.json'])
    manifest.animations = ['storm', 'walk']
    manifest.animationControllers = ['moods']
    manifest.geometry = 'wings'
    files['manifest.json'] = JSON.stringify(manifest)
    const plan = planCosmeticImport({ files, binary: built.binary })
    assert.deepEqual(plan.dropped, [])
    assert.deepEqual(Object.keys(plan.read.sources.animations).sort(), ['animation.storm.idle', 'animation.storm.walk'])
    assert.deepEqual(plan.read.sources.animations['animation.storm.idle'], input.animations['animation.storm.idle'])
    assert.deepEqual(plan.changed.sort(), [
        "Animation 'animation.storm.idle' is in both 'animations/storm.animation.json' and 'animations/walk.animation.json'. Only the one in 'animations/storm.animation.json' was kept",
        "File 'animation_controllers/moods.animation_controllers.json' is now 'animation_controllers/storm.animation_controllers.json'",
        "File 'animations/walk.animation.json' is now part of 'animations/storm.animation.json'",
        "File 'models/wings.geo.json' is now 'models/storm.geo.json'",
    ])
})

test('emote rules written in camelCase import like the snake_case ones', () => {
    const emote = cosmetic('emote', 'wave', () => {})
    const input = sources((s) => {
        s.geometry = geometry('wave', [bone('rightArm_parts', 'rightArm')])
        s.animations = { 'animation.wave.a': { ...animation(['rightArm']), loop: false } }
    })
    const changed = withManifest(buildCosmetic(emote, input), (m) => {
        m.rules = { allowWalking: true, absoluteHead: false, allow_falling: false, allowFalling: true }
    })
    const rules = planCosmeticImport(changed).read.data.emote.rules
    assert.equal(rules.allow_walking, true)
    assert.equal(rules.absolute_head, false)
    assert.equal(rules.allow_falling, false)
    assert.deepEqual(rebuiltManifest(changed).rules, { allow_walking: true, allow_falling: false, absolute_head: false })
})

test('a pet attach without a rig means the player rig, as in the game', () => {
    const pet = cosmetic('pet', 'pup', (d) => {
        d.pet = { archetype: 'walking', leashRadius: 3, scale: 1, anchor: '', interactions: {}, roles: [] }
    })
    const input = sources((s) => {
        s.geometry = geometry('pup', [bone('root', null)])
        s.animations = { 'animation.pup.idle': animation(['root']) }
        s.textures = [paintedTexture(pet, 'pup')]
    })
    const changed = withManifest(buildCosmetic(pet, input), (m) => {
        m.attach = { bone: 'head' }
    })
    const plan = planCosmeticImport(changed)
    assert.equal(plan.read.data.attach.rig, 'player')
    assert.deepEqual(rebuiltManifest(changed).attach, { rig: 'player', bone: 'head' })
})

test('starting one rig preview stops the other one', () => {
    const stopped: string[] = []
    const stopLive = () => {
        stopped.push('live')
        releaseRig('live')
    }
    claimRig('live', stopLive)
    claimRig('live', stopLive)
    assert.deepEqual(stopped, [])
    claimRig('pets', () => stopped.push('pets'))
    assert.deepEqual(stopped, ['live'])
    assert.equal(rigOwner(), 'pets')
    releaseRig('live')
    assert.equal(rigOwner(), 'pets')
    releaseRig('pets')
    assert.equal(rigOwner(), null)
})
