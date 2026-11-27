import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCosmetic, shadeIssues } from '../src/cosmetic/build'
import { CosmeticData } from '../src/cosmetic/data'
import { particleStarter } from '../src/cosmetic/effects'
import { cosmeticKindOf, fixedColorsOf, importSummaryHtml, linkStateAnimations, planCosmeticImport, readCosmeticZip, rigPlacements, withoutSavePaths } from '../src/cosmetic/import'
import { indexPixels } from '../src/cosmetic/indexed'
import { encodePng } from '../src/cosmetic/png'
import { controllerSources, detachRig, readIndexMap, readIndexPixels } from '../src/cosmetic/project'
import { applySprings, ENGINE_SPRING, SPRING_KEY, SPRING_PRESETS } from '../src/cosmetic/springs'
import { toBase64 } from '../src/material/png'
import { animation, bone, cosmetic, FEATHER, geometry, paintedTexture, sources } from './cosmeticKit'

const EYE = '#FFFF0000'
const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0])

function eyedTexture(data: CosmeticData, id: string) {
    const rgba = new Uint8Array(4 * 4 * 4)
    for (let p = 0; p < 16; p++) {
        const [r, g, b] = p === 5 ? [255, 0, 0] : p % 2 ? [0x60, 0x80, 0xa0] : [0x30, 0x40, 0x50]
        rgba.set([r, g, b, 255], p * 4)
    }
    const indexed = indexPixels(4, 4, rgba, data.palette)
    assert.equal(indexed.off, null)
    return { id, png: encodePng(4, 4, rgba, 4), index: encodePng(4, 4, indexed.index, 1) }
}

function item() {
    const data = cosmetic('item', 'storm_wings', (d) => {
        d.attach = { rig: 'player', bone: 'body', replaces: '' }
        d.palette = { slots: [{ id: 'feather', name: 'Feather', ramp: FEATHER, customizable: true }], colorways: { storm: { feather: ['#FF202020', '#FF505050'] } }, fixed: [EYE] }
        d.controllers = ['controller.animation.storm_wings.mood']
        d.reactions = [{ signal: 'is_in_rain', on: 'while', play: 'animation.storm_wings.droop', restart: false, blend: 0.25, speed: null, palette: 'storm', effect: '' }]
    })
    const geo = geometry('storm_wings', [bone('wings', 'body'), bone('tail_1', 'wings')])
    applySprings(geo, { tail_1: SPRING_PRESETS.tail })
    const input = sources((s) => {
        s.geometry = geo
        s.animations = { 'animation.storm_wings.idle': animation(['wings']), 'animation.storm_wings.droop': animation(['wings']) }
        s.controllers = { 'controller.animation.storm_wings.mood': { initial_state: 'default', states: { default: { animations: ['animation.storm_wings.idle'] } } } }
        s.textures = [eyedTexture(data, 'storm_wings')]
    })
    return { data, input }
}

test('an item zip plans back into the same cosmetic, springs and fixed colors', () => {
    const { data, input } = item()
    const built = buildCosmetic(data, input)
    const plan = planCosmeticImport(built)
    assert.deepEqual(plan.read.data, data)
    assert.deepEqual(plan.read.sources.animations, input.animations)
    assert.deepEqual(plan.read.sources.controllers, input.controllers)
    assert.deepEqual(plan.springs, { tail_1: SPRING_PRESETS.tail })
    assert.equal(plan.model!.bones.some((b: any) => SPRING_KEY in b), false)
    assert.equal(plan.model!.bones[0].parent, 'body')
    assert.deepEqual(plan.textures.map((t) => [t.id, t.palette]), [['storm_wings', true]])
    assert.deepEqual([plan.problems, plan.changed, plan.dropped], [[], [], []])
    assert.match(importSummaryHtml(plan), /Imported item <b>storm_wings<\/b>.*Everything in the zip is editable/)
})

test('fixed colors come back from the palette map, and a map of the wrong size is reported', () => {
    const { data, input } = item()
    const texture = input.textures[0]
    assert.deepEqual(fixedColorsOf(texture.png, texture.index!), [EYE])
    assert.throws(() => fixedColorsOf(texture.png, encodePng(2, 2, new Uint8Array(4), 1)), /isn't the size/)
    const built = buildCosmetic(data, input)
    const broken = { ...built, binary: { ...built.binary, 'textures/storm_wings.idx.png': encodePng(2, 2, new Uint8Array(4), 1) } }
    const plan = planCosmeticImport(broken)
    assert.deepEqual(plan.read.data.palette.fixed, [])
    assert.equal(plan.changed.length, 1)
    assert.match(plan.changed[0], /storm_wings.*fixed colors/)
})

test('files and manifest keys the plugin does not edit are listed as not imported', () => {
    const { data, input } = item()
    const built = buildCosmetic(data, input)
    const manifest = JSON.parse(built.files['manifest.json'])
    manifest.notes = 'hello'
    const files = { ...built.files, 'manifest.json': JSON.stringify(manifest), 'extra/readme.json': '{}' }
    const binary = { ...built.binary, 'sounds/unused.ogg': OGG }
    const plan = planCosmeticImport({ files, binary }, ['huge.png'])
    assert.deepEqual(plan.dropped, ['extra/readme.json', 'manifest.json: notes', 'sounds/unused.ogg', 'huge.png'])
    assert.match(importSummaryHtml(plan), /Not imported:.*extra\/readme\.json/)
})

test('a model with mesh shapes or several models says what changed', () => {
    const { data, input } = item()
    const geo = input.geometry as any
    geo['minecraft:geometry'][0].bones[1].poly_mesh = { positions: [] }
    geo['minecraft:geometry'].push({ description: { identifier: 'geometry.other' }, bones: [] })
    const plan = planCosmeticImport(buildCosmetic(data, input))
    assert.equal(plan.model!.bones[1].poly_mesh, undefined)
    assert.deepEqual(plan.changed.map((line) => line.split(' ').slice(0, 2).join(' ')), ['Only the', "Bone 'tail_1'"])
})

test('a 1.8 geometry file opens as the first model the engine reads, with what it could not keep listed', () => {
    const { data, input } = item()
    const modern = (input.geometry as any)['minecraft:geometry'][0]
    const bones = structuredClone(modern.bones)
    bones[0].locators = { tip: [0, 30, 2] }
    bones[1][SPRING_KEY] = { damping: 0.5 }
    input.geometry = {
        format_version: '1.8.0',
        'geometry.storm_wings': { texturewidth: 16, textureheight: 16, visible_bounds_width: 3, debug: true, bones },
        'geometry.spare': { bones: [] },
    }
    const plan = planCosmeticImport(buildCosmetic(data, input))
    assert.deepEqual(plan.problems, [])
    assert.ok(plan.model)
    assert.deepEqual(plan.model.description, { identifier: 'geometry.storm_wings', texture_width: 16, texture_height: 16, visible_bounds_width: 3 })
    assert.deepEqual(plan.model.bones.map((b: any) => [b.name, b.parent]), [['wings', 'body'], ['tail_1', 'wings']])
    assert.deepEqual(plan.model.bones[0].cubes, modern.bones[0].cubes)
    assert.deepEqual(plan.model.bones[0].locators, { tip: [0, 30, 2] })
    assert.equal(plan.model.bones.some((b: any) => SPRING_KEY in b), false)
    assert.deepEqual(plan.springs, { tail_1: { ...ENGINE_SPRING, damping: 0.5 } })
    assert.ok(plan.changed.some((line) => /old 1\.8 geometry layout/.test(line)))
    assert.deepEqual(plan.dropped, ['models/storm_wings.geo.json: geometry.storm_wings.debug', 'models/storm_wings.geo.json: geometry.spare'])
    assert.doesNotMatch(importSummaryHtml(plan), /Everything in the zip is editable/)
})

test('spring settings missing from the zip take the engine defaults, not a plugin preset', () => {
    const { data, input } = item()
    const bones = (input.geometry as any)['minecraft:geometry'][0].bones
    bones[0][SPRING_KEY] = {}
    bones[1][SPRING_KEY] = { stiffness: 0.9, collide: false }
    const plan = planCosmeticImport(buildCosmetic(data, input))
    assert.deepEqual(plan.springs, { wings: ENGINE_SPRING, tail_1: { ...ENGINE_SPRING, stiffness: 0.9, collide: false } })
    assert.deepEqual(ENGINE_SPRING, { stiffness: 0.4, damping: 0.2, gravity: 0.6, drag: 0.1, limit: 50, collide: true })
})

test('pet, effect and emote zips plan back with their own settings', () => {
    const pet = cosmetic('pet', 'pup', (d) => {
        d.pet = { archetype: 'flying', leashRadius: 4, scale: 0.75, anchor: '', interactions: { greet: ['a', 'b'] } }
        d.palette = { slots: [{ id: 'fur', name: 'Fur', ramp: FEATHER, customizable: false }], colorways: {}, fixed: [] }
    })
    const petInput = sources((s) => {
        s.geometry = geometry('pup', [bone('root', null)])
        s.animations = { 'animation.pup.idle': animation(['root']), 'animation.pup.move': animation(['root']) }
        s.textures = [paintedTexture(pet, 'pup')]
    })
    assert.deepEqual(planCosmeticImport(buildCosmetic(pet, petInput)).read.data, pet)

    const picture = toBase64(encodePng(2, 2, new Uint8Array(16).fill(255), 4))
    const effect = cosmetic('effect', 'star_burst', (d) => {
        d.effects.pictures = { spark: picture }
        d.effects.audio = { chime: toBase64(OGG) }
        d.effects.particles = [{ ...particleStarter('spark'), picture: 'spark' }]
        d.effects.sounds = [{ id: 'chime', file: '', vanilla: '', volume: 0.8, pitch: 1.2 }]
        d.effects.named = { join: [{ particle: 'spark', sound: '', vanilla: '', locator: 'ring', count: 1 }, { particle: '', sound: 'chime', vanilla: '', locator: '', count: 1 }] }
    })
    const effectInput = sources((s) => {
        s.geometry = geometry('star_burst', [{ name: 'root', pivot: [0, 0, 0], locators: { ring: [0, 30, 0] } }])
    })
    const effectPlan = planCosmeticImport(buildCosmetic(effect, effectInput))
    assert.deepEqual([effectPlan.read.data, effectPlan.dropped], [effect, []])

    const emote = cosmetic('emote', 'wave', (d) => {
        d.emote.roles = [{ id: 'a', animation: 'animation.wave.a', offset: [0, 0, 0], yaw: 0 }, { id: 'b', animation: 'animation.wave.a', offset: [1, 0, 0], yaw: 180 }]
        d.emote.rules.allow_walking = true
    })
    const emoteInput = sources((s) => {
        s.geometry = geometry('wave', [bone('rightArm_parts', 'rightArm')])
        s.animations = { 'animation.wave.a': { ...animation(['rightArm']), loop: false } }
    })
    const emotePlan = planCosmeticImport(buildCosmetic(emote, emoteInput))
    assert.deepEqual(emotePlan.read.data, emote)
    assert.equal(emotePlan.model!.bones[0].parent, 'rightArm')
    assert.match(importSummaryHtml(emotePlan), /Imported emote <b>wave<\/b>/)
})

test('a zip is read from its manifest folder, json as text and the rest as bytes', async () => {
    const { data, input } = item()
    const built = buildCosmetic(data, input)
    const entries: Record<string, { name: string, dir: boolean, async(type: string): Promise<any> }> = {}
    const add = (name: string, bytes: Uint8Array, dir = false) => {
        entries[name] = { name, dir, async: async () => bytes }
    }
    for (const [path, text] of Object.entries(built.files)) add(`pack/${path}`, new TextEncoder().encode(path === 'manifest.json' ? `﻿${text}` : text))
    for (const [path, bytes] of Object.entries(built.binary)) add(`pack/${path}`, bytes)
    add('pack/', new Uint8Array(0), true)
    add('__MACOSX/pack/manifest.json', new Uint8Array(0))
    add('pack/__MACOSX/x.json', new Uint8Array(0))
    const previous = (globalThis as any).JSZip
    ;(globalThis as any).JSZip = { loadAsync: async () => ({ files: entries }) }
    try {
        const read = await readCosmeticZip('storm_wings.zip', new Uint8Array(0))
        assert.deepEqual(read.skipped, [])
        assert.deepEqual(read.input.files, built.files)
        assert.deepEqual(Object.keys(read.input.binary).sort(), Object.keys(built.binary).sort())
        assert.equal(cosmeticKindOf(read.input.files), 'item')
        assert.equal(cosmeticKindOf({ 'manifest.json': '{"kind":"nameplate"}' }), null)
        assert.deepEqual(planCosmeticImport(read.input).read.data, data)
    } finally {
        ;(globalThis as any).JSZip = previous
    }
})

test('effect pictures load from the path the bundle names, even outside the usual place', () => {
    const picture = encodePng(2, 2, new Uint8Array(16).fill(200), 4)
    const ribbon = encodePng(2, 2, new Uint8Array(16).fill(90), 4)
    const data = cosmetic('effect', 'sparks', (d) => {
        d.effects.pictures = { spark: toBase64(picture), ribbon: toBase64(ribbon) }
        d.effects.particles = [{ ...particleStarter('spark'), picture: 'spark' }, { ...particleStarter('dust'), picture: 'spark' }]
        d.effects.emitters = [{ particle: 'spark', sound: '', vanilla: '', locator: '', count: 1 }, { particle: 'dust', sound: '', vanilla: '', locator: '', count: 1 }]
        d.effects.trails = [{ locator: 'back', picture: 'ribbon', blend: 'alpha', width: [0.25, 0.25], tile: false, tint: { kind: 'color', color: '#FFFFFF' }, fade: 1, minSpeed: 0, while: [] }]
    })
    const built = buildCosmetic(data, sources(() => {}))
    const files = { ...built.files }
    const binary = { ...built.binary }
    delete binary['textures/fx_spark.png']
    delete binary['textures/fx_ribbon.png']
    binary['textures/particle/spark.png'] = picture
    binary['textures/ribbon.png'] = ribbon
    const spark = JSON.parse(files['particles/spark.json'])
    spark.particle_effect.description.basic_render_parameters.texture = 'textures/particle/spark.png'
    files['particles/spark.json'] = JSON.stringify(spark)
    const dust = JSON.parse(files['particles/dust.json'])
    dust.particle_effect.description.basic_render_parameters.texture = 'textures/particle/spark'
    files['particles/dust.json'] = JSON.stringify(dust)
    const manifest = JSON.parse(files['manifest.json'])
    manifest.trails[0].texture = 'ribbon'
    files['manifest.json'] = JSON.stringify(manifest)
    const plan = planCosmeticImport({ files, binary })
    const effects = plan.read.data.effects
    assert.deepEqual(Object.keys(effects.pictures).sort(), ['particle_spark', 'ribbon'])
    assert.equal(effects.pictures.particle_spark, toBase64(picture))
    assert.equal(effects.pictures.ribbon, toBase64(ribbon))
    assert.deepEqual(effects.particles.map((particle) => particle.picture), ['particle_spark', 'particle_spark'])
    assert.equal(effects.trails[0].picture, 'ribbon')
    assert.deepEqual(plan.dropped, [])
    assert.ok(plan.changed.includes("Picture 'textures/particle/spark.png' is now 'textures/fx_particle_spark.png'"), plan.changed.join(' | '))
    assert.ok(plan.changed.includes("Picture 'textures/ribbon.png' is now 'textures/fx_ribbon.png'"), plan.changed.join(' | '))
})

test('effects written in the short forms the game accepts import as editable effects', () => {
    const picture = encodePng(2, 2, new Uint8Array(16).fill(200), 4)
    const data = cosmetic('effect', 'sparks', (d) => {
        d.effects.pictures = { spark: toBase64(picture) }
        d.effects.audio = { chime: toBase64(OGG) }
        d.effects.particles = [{ ...particleStarter('spark'), picture: 'spark' }]
        d.effects.sounds = [{ id: 'chime', file: '', vanilla: '', volume: 1, pitch: 1 }]
        d.effects.named = { burst: [{ particle: '', sound: '', vanilla: 'minecraft:end_rod', locator: '', count: 1 }], pop: [{ particle: 'spark', sound: '', vanilla: '', locator: '', count: 1 }, { particle: '', sound: 'chime', vanilla: '', locator: '', count: 1 }] }
    })
    const built = buildCosmetic(data, sources(() => {}))
    const manifest = JSON.parse(built.files['manifest.json'])
    manifest.particles = ['spark']
    manifest.sounds = ['chime']
    manifest.effects.burst = { vanilla: 'minecraft:end_rod' }
    const files = { ...built.files, 'manifest.json': JSON.stringify(manifest) }
    const plan = planCosmeticImport({ files, binary: built.binary })
    assert.equal(plan.problems.length, planCosmeticImport(built).problems.length)
    assert.deepEqual(plan.read.data.effects, data.effects)
    assert.deepEqual(plan.dropped, [])
    const again = JSON.parse(buildCosmetic(plan.read.data, sources(() => {})).files['manifest.json'])
    assert.deepEqual(again.effects.burst, [{ vanilla: 'minecraft:end_rod' }])
    assert.deepEqual(Object.keys(again.particles), ['spark'])
    assert.deepEqual(Object.keys(again.sounds), ['chime'])

    manifest.particles = ['spark', 7]
    manifest.effects.burst = [{ vanilla: 'minecraft:end_rod' }, 'minecraft:flame']
    manifest.effects.pop = 'spark'
    const broken = planCosmeticImport({ files: { ...built.files, 'manifest.json': JSON.stringify(manifest) }, binary: built.binary })
    assert.deepEqual(broken.dropped, ['manifest.json: effects.burst.1', 'manifest.json: effects.pop', 'manifest.json: particles.1'].sort())
    assert.match(importSummaryHtml(broken), /Not imported:.*effects\.burst\.1/)
})

test('an imported palette map is kept, so shared fixed colors and see-through shades come back as they were', () => {
    const data = cosmetic('item', 'glass_hat', (d) => {
        d.attach = { rig: 'player', bone: 'head', replaces: '' }
        d.palette = { slots: [{ id: 'glass', name: 'Glass', ramp: ['#FF304050', '#FF6080A0'], customizable: true }], colorways: { dark: { glass: ['#FF101010', '#FF202020'] } }, fixed: [] }
    })
    const rgba = new Uint8Array([0x30, 0x40, 0x50, 255, 0x30, 0x40, 0x50, 255, 0x30, 0x40, 0x50, 0x80, 0x60, 0x80, 0xa0, 255])
    const index = new Uint8Array([0, 1, 1, 2])
    const input = sources((s) => {
        s.geometry = geometry('glass_hat', [bone('hat', 'head')])
        s.textures = [{ id: 'glass_hat', png: encodePng(2, 2, rgba, 4), index: encodePng(2, 2, index, 1) }]
    })
    const built = buildCosmetic(data, input)
    const plan = planCosmeticImport(built)
    assert.deepEqual(plan.read.data.palette.fixed, ['#FF304050'])
    assert.equal(plan.textures[0].palette, true)
    const kept = readIndexMap(plan.textures[0].index, 2, 2)
    assert.deepEqual(Array.from(kept!), Array.from(index))
    assert.deepEqual(Array.from(readIndexPixels(plan.textures[0].pixels, 2, 2)!), Array.from(rgba))
    assert.equal(readIndexMap(plan.textures[0].index, 4, 4), null)
    const again = indexPixels(2, 2, rgba, plan.read.data.palette, kept)
    assert.deepEqual(Array.from(again.index), Array.from(index))
    assert.equal(again.off, null)
    assert.deepEqual(shadeIssues(plan.read.data, plan.read.sources, again.guessed), [])
    const guessed = indexPixels(2, 2, rgba, plan.read.data.palette)
    assert.notDeepEqual(Array.from(guessed.index), Array.from(index))
    assert.equal(shadeIssues(plan.read.data, plan.read.sources, guessed.guessed).length, 1)
})

test('animations and controllers loaded from a zip forget its paths, so saving them asks where', () => {
    const scope = globalThis as any
    const kept = { name: 'animation.old', path: 'D:/models/old.animation.json' }
    const animations: any[] = [kept]
    const controllers: any[] = []
    scope.Animator = { animations }
    scope.AnimationController = { all: controllers }
    try {
        withoutSavePaths(() => {
            animations.push({ name: 'animation.hat.idle', path: 'animations/hat.animation.json' })
            controllers.push({ name: 'controller.animation.hat', path: 'animation_controllers/hat.animation_controllers.json' })
        })
        assert.deepEqual(animations.map((item) => item.path), ['D:/models/old.animation.json', ''])
        assert.equal(controllers[0].path, '')
    } finally {
        delete scope.Animator
        delete scope.AnimationController
    }
})

test('controller states export the full name of the animation they picked, keeping blend values', () => {
    const animations = [{ uuid: 'u-cat', name: 'animation.cat.idle' }, { uuid: 'u-dog', name: 'animation.dog.renamed' }]
    const controller = {
        name: 'controller.animation.pets',
        states: [{ name: 'default', animations: [{ uuid: 'e1', key: 'idle', animation: 'u-cat', blend_value: 0 }, { uuid: 'e2', key: 'idle', animation: 'u-dog', blend_value: 'q.x' }, { uuid: 'e3', key: 'old', animation: 'u-gone', blend_value: 0 }] }],
        compileForBedrock: () => ({ initial_state: 'default', states: { default: { animations: ['idle', { idle: 'q.x' }, 'old'] } } }),
    }
    assert.deepEqual(controllerSources([controller], animations), {
        'controller.animation.pets': { initial_state: 'default', states: { default: { animations: ['animation.cat.idle', { 'animation.dog.renamed': 'q.x' }, 'old'] } } },
    })
})

test('imported controller states link full and unambiguous short animation names', () => {
    const animations = [{ uuid: 'u-cat', name: 'animation.cat.idle' }, { uuid: 'u-dog', name: 'animation.dog.idle' }, { uuid: 'u-walk', name: 'animation.cat.walk' }]
    const entries = [{ key: 'animation.cat.idle', animation: '' }, { key: 'idle', animation: 'u-dog' }, { key: 'walk', animation: '' }, { key: 'missing', animation: '' }]
    linkStateAnimations([{ states: [{ name: 'default', animations: entries }] }], animations)
    assert.deepEqual(entries.map((entry) => entry.animation), ['u-cat', '', 'u-walk', ''])
})

test("only the wrapper export made for a rig part's own cubes is unwrapped on import", () => {
    const model: Record<string, any> = {
        bones: [
            { name: 'head', pivot: [0, 24, 0], cubes: [{ origin: [0, 24, 0], size: [1, 1, 1] }] },
            { name: 'head_parts', parent: 'head', pivot: [0, 24, 0], cubes: [{ origin: [0, 30, 0], size: [1, 1, 1] }] },
            { name: 'hair', parent: 'head_parts', pivot: [0, 30, 0] },
        ],
    }
    detachRig(model, new Set(['head']))
    applySprings({ 'minecraft:geometry': [model] }, { head_parts: SPRING_PRESETS.ear })
    assert.deepEqual(model.bones.map((b: any) => b.name), ['head_parts_2', 'head_parts', 'hair'])
    assert.deepEqual(rigPlacements(model.bones), [{ rig: 'head', unwrap: true }, { rig: 'head', unwrap: false }, null])
    const { data, input } = item()
    input.geometry = geometry('storm_wings', model.bones)
    input.animations = { 'animation.storm_wings.idle': animation(['head_parts']), 'animation.storm_wings.droop': animation(['hair']) }
    const plan = planCosmeticImport(buildCosmetic(data, input))
    assert.deepEqual(plan.springs.head_parts, SPRING_PRESETS.ear)
    assert.deepEqual(rigPlacements(plan.model?.bones ?? []), [{ rig: 'head', unwrap: true }, { rig: 'head', unwrap: false }, null])
})
