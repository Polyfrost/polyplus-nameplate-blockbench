import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyIssue } from '../src/checks/codes'
import { engineKnowsBone, playerAttachBones, playerBoneOptions, TAIL_BONE } from '../src/cosmetic/attach'
import { buildCosmetic } from '../src/cosmetic/build'
import { FORMAT, MANIFEST } from '../src/cosmetic/bundle'
import { isVehicleRig, RIGS, VEHICLE_RIGS } from '../src/cosmetic/data'
import { cosmeticIssueText } from '../src/cosmetic/where'
import { addedTextures, takeBackExtraTexture, undoesExtraTexture } from '../src/cosmetic/textureGuard'
import { ON_LABELS, reactionOfRow } from '../src/cosmetic/dialogs'
import { EQUIP_EVENT, takeEvents, wearAgain } from '../src/cosmetic/preview'
import { RendererExports, RIG_VALUES, RIGS as ENGINE_RIGS } from '@plusrenderer/renderer/cosmetic.js'
import { brushAlpha, FIXED_OWNER, indexPixels, recolorIndexed, scaledAlpha, shadeClashes, slotOfIndex, slotTones, toneLimit, toneOverflows } from '../src/cosmetic/indexed'
import { recolorLayer, recolorTexture, roomForTone, toneRemap } from '../src/cosmetic/colors'
import { keepIndex } from '../src/cosmetic/project'
import { encodePng } from '../src/cosmetic/png'
import { blendTones } from '../src/palette/blend'
import { parseHex } from '../src/import/ramp'
import { toArgbKey } from '../src/palette/color'
import { applySprings, SPRING_PRESETS } from '../src/cosmetic/springs'
import { currentEngine, issueMessage, loadCosmetic, resolveCosmeticTexture } from '../src/engine'
import { plainMessage } from '../src/checks/words'
import { animation, bone, cosmetic, FEATHER, geometry, paintedTexture, roundTrip, sources } from './cosmeticKit'

const px = (argb: number) => [(argb >>> 16) & 255, (argb >>> 8) & 255, argb & 255, argb >>> 24]

function wings() {
    const data = cosmetic('item', 'storm_wings', (d) => {
        d.attach = { rig: 'player', bone: 'body', replaces: '' }
        d.palette = {
            slots: [{ id: 'feather', name: 'Feather', ramp: FEATHER, customizable: true }],
            colorways: { storm: { feather: ['#FF202020', '#FF505050'] } },
            fixed: [],
        }
        d.controllers = ['controller.animation.storm_wings.mood']
        d.reactions = [
            { signal: 'is_in_rain', on: 'while', play: 'animation.storm_wings.droop', restart: false, blend: 0.25, speed: null, palette: 'storm', effect: '' },
            { signal: 'is_hurt', on: 'start', play: 'animation.storm_wings.flinch', restart: true, blend: 0, speed: null, palette: '', effect: '' },
        ]
    })
    const geo = geometry('storm_wings', [bone('wings', 'body'), bone('tail_1', 'wings'), bone('tail_2', 'tail_1')])
    applySprings(geo, { tail_1: SPRING_PRESETS.tail, tail_2: SPRING_PRESETS.ribbon })
    const input = sources((s) => {
        s.geometry = geo
        s.animations = {
            'animation.storm_wings.idle': animation(['wings']),
            'animation.storm_wings.droop': animation(['wings']),
            'animation.storm_wings.flinch': { ...animation(['wings'], 0.5), loop: false },
        }
        s.controllers = {
            'controller.animation.storm_wings.mood': {
                initial_state: 'default',
                states: { default: { animations: ['animation.storm_wings.idle'] } },
            },
        }
        s.textures = [paintedTexture(data, 'storm_wings')]
    })
    return { data, input }
}

test('an item exports with every manifest key, loads clean and reads back the same', () => {
    const { data, input } = wings()
    const built = roundTrip(data, input)
    const manifest = JSON.parse(built.files['manifest.json'])
    assert.deepEqual(Object.keys(manifest), ['format', 'kind', 'id', 'requires', 'geometry', 'textures', 'palettes', 'animations', 'animationControllers', 'controllers', 'attach', 'reactions'])
    assert.deepEqual(manifest.textures, [{ id: 'storm_wings', palette: true }])
    for (const name of ['controllers', 'reactions', 'palettes', 'custom_colors', 'springs']) assert.ok(manifest.requires.includes(name), name)
    const meta = built.load!.meta!
    assert.equal(meta.kind, 'item')
    assert.equal(meta.spring_bones, 2)
    assert.deepEqual(meta.attach, { rig: 'player', bone: 'body', replaces: null, anchor: null })
    assert.deepEqual(meta.reactions.map((r) => [r.signal, r.on, r.colorway]), [['is_in_rain', 'while', 'storm'], ['is_hurt', 'start', null]])
    assert.deepEqual(meta.textures, [{ name: 'storm_wings', width: 4, height: 4, indexed: true }])
    assert.ok(built.binary['textures/storm_wings.idx.png'])
})

test('palette painting maps each tone to its index and finds the first stray pixel', () => {
    const palette = { slots: [{ id: 'a', name: 'A', ramp: ['#FF000000', '#FFFFFFFF'], customizable: false }, { id: 'b', name: 'B', ramp: ['#FF00FF00'], customizable: false }], colorways: {}, fixed: ['#FFFF0000'] }
    const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0, 1, 2, 3, 255])
    const result = indexPixels(3, 2, rgba, palette)
    assert.deepEqual(Array.from(result.index), [1, 2, 17, 0, 0, 0])
    assert.deepEqual(slotOfIndex(17), { slot: 1, tone: 0 })
    assert.deepEqual(result.off, { x: 2, y: 1, color: '#FF010203', count: 1 })
})

test('see-through shades still match after the brush rounds their opacity to a whole percent', () => {
    assert.equal(brushAlpha(0xdf), 0xde)
    assert.equal(brushAlpha(0xdd), 0xde)
    assert.equal(brushAlpha(0x80), 0x80)
    assert.equal(brushAlpha(255), 255)
    const palette = {
        slots: [
            { id: 'glass', name: 'Glass', ramp: ['#DF000000', '#FF112233'], customizable: false },
            { id: 'mist', name: 'Mist', ramp: ['#DF405060'], customizable: false },
            { id: 'fog', name: 'Fog', ramp: ['#DD405060'], customizable: false },
            { id: 'ice', name: 'Ice', ramp: ['#DF102030', '#DE102030'], customizable: false },
        ],
        colorways: {},
        fixed: ['#DF0000FF'],
    }
    const rgba = new Uint8Array([0xdf000000, 0xde000000, 0xde0000ff, 0xde102030, 0xde405060, 0xdf405060].flatMap(px))
    const result = indexPixels(6, 1, rgba, palette)
    assert.deepEqual(Array.from(result.index), [1, 1, 0, 50, 0, 17])
    assert.deepEqual(result.off, { x: 4, y: 0, color: '#DE405060', count: 1 })
    assert.equal(result.painted, 4)
})

test('a kept palette map decides each pixel until the pixel is painted over or repainted since it was kept', () => {
    const palette = { slots: [{ id: 'fur', name: 'Fur', ramp: ['#FF304050', '#FF6080A0'], customizable: false }], colorways: {}, fixed: ['#FF304050'] }
    const rgba = new Uint8Array([0xff304050, 0xff304050, 0x80304050, 0xff6080a0, 0xff112233, 0xff304050].flatMap(px))
    const stored = new Uint8Array([0, 1, 1, 0, 2, 2])
    const result = indexPixels(6, 1, rgba, palette, stored)
    assert.deepEqual(Array.from(result.index), [0, 1, 1, 2, 0, 1])
    assert.deepEqual(result.off, { x: 4, y: 0, color: '#FF112233', count: 1 })
    assert.deepEqual([...result.guessed].sort(), ['FF304050', 'FF6080A0'])
    assert.deepEqual(Array.from(indexPixels(6, 1, rgba, palette, new Uint8Array(3)).index), [1, 1, 0, 2, 0, 1])
    const twoReds = { slots: [{ id: 'a', name: 'A', ramp: ['#FFFF0000'], customizable: false }, { id: 'b', name: 'B', ramp: ['#80FF0000'], customizable: false }], colorways: {}, fixed: [] }
    const snapshot = new Uint8Array([0xffff0000, 0xffff0000].flatMap(px))
    const repainted = new Uint8Array([0xffff0000, 0x80ff0000].flatMap(px))
    const marks = new Uint8Array([1, 1])
    assert.deepEqual(Array.from(indexPixels(2, 1, repainted, twoReds, marks, snapshot).index), [1, 17])
    assert.deepEqual(Array.from(indexPixels(2, 1, repainted, twoReds, marks).index), [1, 1])
    assert.deepEqual(Array.from(indexPixels(2, 1, repainted, twoReds, marks, new Uint8Array(4)).index), [1, 1])
})

const pixels = (...argb: number[]) => new Uint8ClampedArray(argb.flatMap(px))

function reds(fixed: string[]) {
    const red = { id: 'red', name: 'Red', ramp: ['#FFFF0000'], customizable: false }
    const before = { slots: [red], colorways: {}, fixed }
    const after = { slots: [{ ...red, ramp: ['#FF0000FF'] }], colorways: {}, fixed }
    return { before, after, map: toneRemap(before, after) }
}

test('recoloring a layered picture follows the kept map, so a shade two colors share only changes for one', () => {
    const a = { id: 'a', name: 'A', ramp: ['#FFFF0000'], customizable: false }
    const b = { id: 'b', name: 'B', ramp: ['#FFFF0000'], customizable: false }
    const before = { slots: [a, b], colorways: {}, fixed: [] }
    const after = { slots: [{ ...a, ramp: ['#FF00FF00'] }, b], colorways: {}, fixed: [] }
    const shown = pixels(0xffff0000, 0xffff0000, 0xff0000ff)
    const recolored = new Uint8ClampedArray(shown)
    const map = toneRemap(before, after)
    recolorIndexed(recolored, new Uint8Array([1, 17, 0]), before, after, map)
    const view = { width: 3, height: 1, before: shown, after: recolored }
    const base = pixels(0xffff0000, 0xffff0000, 0xffff0000)
    assert.equal(recolorLayer(base, 3, [0, 0], view, map), true)
    assert.deepEqual(base, pixels(0xff00ff00, 0xffff0000, 0xff00ff00))
    const top = pixels(0xffff0000)
    assert.equal(recolorLayer(top, 1, [1, 0], view, map), false)
    assert.deepEqual(top, pixels(0xffff0000))
})

test('a fixed color that matches a changed shade keeps its color when hidden or on a faded layer, while opaque palette pixels change', () => {
    const solid = reds(['#FFFF0000'])
    const shown = pixels(0xff00ff00, 0xff123456)
    const view = { width: 2, height: 1, before: shown, after: shown, index: new Uint8Array(2), fixed: new Set(['FFFF0000']), covered: new Uint8Array([1, 1]) }
    const hidden = pixels(0xffff0000, 0xffff0000)
    assert.equal(recolorLayer(hidden, 2, [0, 0], view, solid.map), false)
    assert.deepEqual(hidden, pixels(0xffff0000, 0xffff0000))
    const plain = pixels(0xffff0000)
    assert.equal(recolorLayer(plain, 1, [0, 0], { ...view, fixed: new Set<string>() }, solid.map), true)
    assert.deepEqual(plain, pixels(0xff0000ff))
    const faded = reds(['#80FF0000'])
    const layered = pixels(0x80ff0000, 0xffff0000)
    const index = indexPixels(2, 1, layered, faded.before).index
    assert.deepEqual(Array.from(index), [0, 1])
    const recolored = new Uint8ClampedArray(layered)
    recolorIndexed(recolored, index, faded.before, faded.after, faded.map)
    assert.deepEqual(recolored, pixels(0x80ff0000, 0xff0000ff))
    const kept = { width: 2, height: 1, before: layered, after: recolored, index, fixed: new Set(['80FF0000']) }
    const under = pixels(0xffff0000)
    assert.equal(recolorLayer(under, 1, [0, 0], kept, faded.map), false)
    assert.deepEqual(under, pixels(0xffff0000))
    const opaque = pixels(0xffff0000)
    assert.equal(recolorLayer(opaque, 1, [1, 0], kept, faded.map), true)
    assert.deepEqual(opaque, pixels(0xff0000ff))
})

test('a palette pixel hidden under an opaque fixed layer takes the new color while the fixed top stays', () => {
    const { before, after, map } = reds(['#FF00FF00'])
    const surface = (...argb: number[]) => {
        const held = { data: pixels(...argb) }
        return {
            held,
            canvas: { width: 2, height: 1 },
            ctx: { getImageData: () => ({ data: new Uint8ClampedArray(held.data) }), putImageData: (image: { data: Uint8ClampedArray }) => { held.data = new Uint8ClampedArray(image.data) } },
        }
    }
    const composite = surface(0xff00ff00, 0xffff0000)
    const layer = { offset: [0, 0], visible: true, opacity: 100, blend_mode: 'default' }
    const bottom = { ...surface(0xffff0000, 0xffff0000), ...layer }
    const top = { ...surface(0xff00ff00, 0), ...layer }
    const texture: any = { canvas: composite.canvas, ctx: composite.ctx, layers_enabled: true, layers: [bottom, top], updateChangesAfterEdit: () => {} }
    keepIndex(texture, 2, 1, indexPixels(2, 1, composite.held.data, before).index, composite.held.data)
    recolorTexture(texture, before, after, map)
    assert.deepEqual(bottom.held.data, pixels(0xff0000ff, 0xff0000ff))
    assert.deepEqual(top.held.data, pixels(0xff00ff00, 0))
})

test('editing colors repaints kept-map pixels by their slot, even see-through ones and moved slots', () => {
    const fur = { id: 'fur', name: 'Fur', ramp: ['#FF304050'], customizable: false }
    const before = { slots: [fur], colorways: {}, fixed: ['#FF304050'] }
    const after = { slots: [{ id: 'mane', name: 'Mane', ramp: ['#FFAABBCC'], customizable: false }, { ...fur, ramp: ['#80102030'] }], colorways: {}, fixed: ['#FF304050'] }
    const rgba = pixels(0xff304050, 0xff304050, 0x40304050, 0xff304050, 0xff998877)
    const result = recolorIndexed(rgba, new Uint8Array([0, 1, 1, 9, 1]), before, after, new Map([['FF304050', '80102030']]))
    assert.equal(result.changed, true)
    assert.deepEqual(Array.from(result.index), [0, 17, 17, 0, 0])
    assert.deepEqual(rgba, pixels(0xff304050, 0x80102030, 0x20102030, 0x80102030, 0xff998877))
    assert.deepEqual([scaledAlpha(64, 128, 255), scaledAlpha(255, 128, 255)], [128, 255])
})

test('two colors or a fixed color sharing a shade fail Checks, so colorways never hit the wrong pixels', () => {
    const fur = { id: 'fur', name: 'Fur', ramp: ['#FF304050', '#FF6080A0'], customizable: false }
    const mane = { id: 'mane', name: 'Mane', ramp: ['#FF304050', '#FF112233'], customizable: false }
    assert.deepEqual(shadeClashes({ slots: [fur, mane], colorways: {}, fixed: ['#6080A0'] }), [
        { color: '#FF304050', first: 'Fur', second: 'Mane' },
        { color: '#FF6080A0', first: 'Fur', second: FIXED_OWNER },
    ])
    assert.deepEqual(shadeClashes({ slots: [{ ...fur, ramp: ['#FF304050', '#FF304050'] }], colorways: {}, fixed: [] }), [{ color: '#FF304050', first: 'Fur', second: 'Fur' }])
    assert.deepEqual(shadeClashes({ slots: [fur, { ...mane, ramp: ['#FF112233'] }], colorways: {}, fixed: [] }), [])

    const { data, input } = wings()
    data.palette.slots.push({ id: 'mane', name: 'Mane', ramp: [FEATHER[0]], customizable: false })
    const issues = buildCosmetic(data, input).issues.filter((issue) => issue.code === 'palette_shade_shared')
    assert.equal(issues.length, 1)
    assert.equal(issues[0].level, 'error')
    assert.equal(classifyIssue(issues[0]).code, 'palette_shade_shared')
    assert.equal(cosmeticIssueText(issues[0]), "The palette has shade '#FF304050' in both 'Feather' and 'Mane'. Change one of them.")
    const twice = { ...issues[0], names: { color: '#FF304050', first: 'Fur', second: 'Fur' } }
    assert.equal(plainMessage(issueMessage(twice.code, {}, twice.names)), "has shade '#FF304050' twice in 'Fur'. Change one of them.")

    const plain = cosmetic('item', 'plain', (d) => {
        d.palette = { slots: [fur, mane], colorways: {}, fixed: [] }
    })
    const unpainted = sources((s) => {
        s.geometry = geometry('plain', [bone('hat', 'head')])
        s.textures = [{ ...paintedTexture(plain, 'plain'), index: null }]
    })
    assert.equal(buildCosmetic(plain, unpainted).issues.some((issue) => issue.code === 'palette_shade_shared'), false)
})

test('Replaces part is only for vehicle parts', () => {
    assert.ok(VEHICLE_RIGS.every((rig) => isVehicleRig(rig)))
    assert.ok(!isVehicleRig('player'))
    const data = cosmetic('item', 'oak_paddle', (d) => {
        d.attach = { rig: 'boat', bone: '', replaces: 'left_paddle' }
    })
    const input = sources((s) => {
        s.geometry = geometry('oak_paddle', [bone('paddle', null)])
        s.textures = [paintedTexture(data, 'oak_paddle')]
    })
    const built = roundTrip(data, input)
    assert.deepEqual(JSON.parse(built.files['manifest.json']).attach, { rig: 'boat', replaces: 'left_paddle' })
    assert.equal(built.load!.meta!.attach.replaces, 'left_paddle')
    const wrong = cosmetic('item', 'oak_paddle', (d) => {
        d.attach = { rig: 'player', bone: '', replaces: 'shield' }
    })
    const texts = buildCosmetic(wrong, input).issues.filter((issue) => issue.code === 'attach_invalid').map(cosmeticIssueText)
    assert.deepEqual(texts, ["Attach settings can't replace a part of the 'player' rig. Clear Replaces part, or pick a boat, minecart or horse."])
})

test('Sticks to lists the player parts and offers Tail as soon as the engine has it', () => {
    assert.ok(engineKnowsBone('player', 'body'))
    assert.ok(!engineKnowsBone('player', 'wing'))
    const bones = playerAttachBones()
    assert.deepEqual(bones.slice(0, 7), ['body', 'head', 'hat', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'])
    assert.ok(engineKnowsBone('player', TAIL_BONE))
    assert.equal(bones.at(-1), TAIL_BONE)
    const options = playerBoneOptions('')
    assert.equal(options[''], 'Set by the model')
    assert.equal(options.rightArm, 'Right arm')
    assert.equal(options[TAIL_BONE], 'Tail')
    assert.ok(!engineKnowsBone('boat', TAIL_BONE))
    assert.equal(playerBoneOptions('cape').cape, 'cape')
})

test('a tail exports as the tail bone, keeps its geometry around the tailbone and the engine hangs it on the body', () => {
    const data = cosmetic('item', 'fox_tail', (d) => {
        d.attach = { rig: 'player', bone: TAIL_BONE, replaces: '' }
    })
    const geo = geometry('fox_tail', [
        bone('tail', null, { pivot: [0, 0, 0], cubes: [{ origin: [-1, -1, -6], size: [2, 2, 6], uv: [0, 0] }] }),
        bone('tip', 'tail', { pivot: [0, 0, -6], cubes: [{ origin: [-1, -1, -9], size: [2, 2, 3], uv: [0, 0] }] }),
    ])
    const input = sources((s) => {
        s.geometry = geo
        s.textures = [paintedTexture(data, 'fox_tail')]
    })
    const built = roundTrip(data, input)
    assert.deepEqual(JSON.parse(built.files['manifest.json']).attach, { rig: 'player', bone: 'tail' })
    const bones = (JSON.parse(built.files['models/fox_tail.geo.json'])['minecraft:geometry'] as any)[0].bones
    assert.deepEqual(bones[0].pivot, [0, 0, 0])
    assert.deepEqual(bones[0].cubes[0].origin, [-1, -1, -6])
    assert.equal(bones[0].parent, undefined)
    assert.deepEqual(built.load!.meta!.attach, { rig: 'player', bone: 'body', replaces: null, anchor: 'tail' })
})

test('rigs match the engine, with player 0, actor 2, boat 3, minecart 4, horse 5 and nothing at 1', () => {
    assert.deepEqual([...RIGS], [...ENGINE_RIGS])
    for (const rig of RIGS) {
        const load = loadCosmetic({ [MANIFEST]: JSON.stringify({ format: FORMAT, kind: 'item', id: 'rig_check', requires: [], attach: { rig } }) }, {})
        assert.deepEqual(load!.issues.map((issue) => issue.code).filter((code) => code === 'rig_unknown' || code === 'attach_invalid'), [], rig)
    }
    const wasm = currentEngine()!.wasm as unknown as RendererExports
    const renderer = wasm.renderer_new()
    try {
        const accepted = [0, 1, 2, 3, 4, 5, 6].filter((number) => wasm.renderer_set_rig(renderer, number) === 0)
        assert.deepEqual(accepted, [0, 2, 3, 4, 5])
        assert.deepEqual(RIGS.map((rig) => RIG_VALUES[rig as keyof typeof RIG_VALUES]), accepted)
        wasm.renderer_play_f64(renderer, 0, 1_700_000_000.25)
    } finally {
        wasm.renderer_free(renderer)
    }
})

test('a model with cubes and no texture fails Checks, while locators alone need none', () => {
    const { data, input } = wings()
    input.textures = []
    const built = buildCosmetic(data, input)
    const missing = built.issues.find((issue) => issue.code === 'model_texture_missing')
    assert.ok(missing, JSON.stringify(built.issues.map((issue) => issue.code)))
    assert.equal(missing!.level, 'error')
    assert.equal(cosmeticIssueText(missing!), plainMessage(`The model ${issueMessage('model_texture_missing', {}, {})}`))
    assert.equal(classifyIssue(missing!).code, 'model_texture_missing')
    const bare = sources((s) => {
        s.geometry = geometry('storm_wings', [{ name: 'root', pivot: [0, 0, 0], locators: { ring: [0, 30, 0] } }])
    })
    assert.equal(buildCosmetic(data, bare).issues.some((issue) => issue.code === 'model_texture_missing'), false)
})

test('a cosmetic keeps one texture: extras fail Checks and adding a second one is taken back, with its redo', () => {
    const { data, input } = wings()
    input.textures.push(paintedTexture(data, 'spare'))
    const extra = buildCosmetic(data, input).issues.find((issue) => issue.code === 'model_textures_extra')
    assert.equal(cosmeticIssueText(extra!), 'The model has 2 textures, but the game only uses one. Delete the extras.')
    const added = { before: { textures: { a: {} } }, post: { textures: { a: {}, b: {} } }, action: 'Add texture', type: 'edit', time: 0 }
    assert.deepEqual(addedTextures(added), ['b'])
    assert.deepEqual([
        undoesExtraTexture(added, new Set(['b']), 2),
        undoesExtraTexture(added, new Set(['b']), 1),
        undoesExtraTexture(added, new Set(['c']), 2),
        undoesExtraTexture({ before: {}, post: { elements: {} } }, new Set(['b']), 2),
        undoesExtraTexture({ before: { textures: { a: {} } }, after: { textures: { a: {}, b: {} } } }, new Set(['b']), 2),
        undoesExtraTexture(null, new Set(['b']), 2),
    ], [true, false, false, false, false, false])
    const paint = { before: { textures: { a: {} } }, post: { textures: { a: {} } }, action: 'Paint' }
    const undo = {
        history: [paint, added] as unknown[],
        index: 2,
        undo() { this.index-- },
        redo() { if (this.index < this.history.length) this.index++ },
    }
    assert.equal(takeBackExtraTexture(undo, new Set(['b']), 2), true)
    assert.deepEqual([undo.history, undo.index], [[paint], 1])
    undo.redo()
    assert.equal(undo.index, 1, 'redo cannot bring it back')
    assert.equal(takeBackExtraTexture(undo, new Set(['b']), 2), false)
})

test('an equip reaction exports without a signal, reads back, loads as equip, and Wear again pulses its event for one frame', () => {
    const { data, input } = wings()
    data.reactions.push({ signal: '', on: 'equip', play: 'animation.storm_wings.flinch', restart: true, blend: 0.2, speed: null, palette: 'storm', effect: '' })
    const built = roundTrip(data, input)
    assert.deepEqual(JSON.parse(built.files['manifest.json']).reactions[2], { on: 'equip', play: 'animation.storm_wings.flinch', restart: true, blend: 0.2, palette: 'storm' })
    const loaded = built.load!.meta!.reactions[2]
    assert.deepEqual([loaded.on, loaded.signal, loaded.play], ['equip', null, 'animation.storm_wings.flinch'])
    assert.deepEqual(reactionOfRow({ key: 0, signal: 'is_hurt', on: 'equip', play: 'a', restart: true, blend: 0.3, speed: '2', palette: 'storm', effect: 'burst' }), {
        signal: '', on: 'equip', play: 'a', restart: true, blend: 0.3, speed: null, palette: 'storm', effect: 'burst',
    })
    assert.equal(ON_LABELS.equip, 'When you put it on')
    assert.equal(takeEvents(), 0)
    wearAgain()
    assert.deepEqual([EQUIP_EVENT, takeEvents(), takeEvents()], [128, 128, 0])
})

function sixteenColors(last: number, storm: number) {
    const ramp = (slot: number, count: number) => Array.from({ length: count }, (_, tone) => `#FF${(slot * 16 + tone + 1).toString(16).padStart(6, '0').toUpperCase()}`)
    const slots = Array.from({ length: 16 }, (_, s) => ({ id: s ? `c${s}` : 'feather', name: s ? `C${s}` : 'Feather', ramp: s === 15 ? ramp(s, last) : s ? ramp(s, 1) : FEATHER, customizable: false }))
    return { slots, colorways: { storm: { c15: ramp(17, storm) } }, fixed: [] }
}

test('the last palette color stops at 15 shades, counting its colorways', () => {
    assert.equal(toneLimit(0), 16)
    assert.equal(toneLimit(14), 16)
    assert.equal(toneLimit(15), 15)
    assert.deepEqual(toneOverflows(sixteenColors(15, 15)), [])
    assert.deepEqual(toneOverflows(sixteenColors(16, 15)), [{ slot: 'C15', count: 16, limit: 15 }])
    assert.deepEqual(toneOverflows(sixteenColors(15, 16)), [{ slot: 'C15', count: 16, limit: 15 }])

    const { data, input } = wings()
    data.palette = sixteenColors(15, 16)
    data.reactions = data.reactions.filter((reaction) => !reaction.palette)
    const issues = buildCosmetic(data, input).issues.filter((issue) => issue.code === 'palette_tones_over' || issue.code === 'palette')
    assert.equal(issues.length, 1)
    assert.equal(issues[0].code, 'palette_tones_over')
    assert.equal(classifyIssue(issues[0]).code, 'palette_tones_over')
    assert.equal(cosmeticIssueText(issues[0]), "The palette has 16 shades in 'C15', and that color can have up to 15. Remove some shades.")
    const engine = { code: 'palette', values: { slot: 15, count: 16, limit: 15 }, names: {} }
    assert.equal(plainMessage(issueMessage(engine.code, engine.values, engine.names)), 'has 16 shades in color 16, and that color can have up to 15. Remove some shades.')

    data.palette = sixteenColors(15, 15)
    assert.equal(buildCosmetic(data, input).issues.some((issue) => issue.code === 'palette_tones_over' || issue.code === 'palette'), false)
})

test('the Colors window will not add a sixteenth shade to the last color', () => {
    const palette = sixteenColors(15, 1)
    const rows = {
        slots: palette.slots.map((slot, key) => ({ key, from: slot.id, ...slot, ramp: slot.ramp.slice() })),
        colorways: [{ from: 'storm', name: 'storm', overrides: { c14: Array(16).fill('#FF000000') } }],
        fixed: [],
    }
    assert.equal(roomForTone(rows, 15), false)
    assert.equal(roomForTone(rows, 14), false)
    assert.equal(roomForTone(rows, 13), true)
    rows.slots[15].ramp.pop()
    assert.equal(roomForTone(rows, 15), true)
})

function rgbaOf(tones: string[], size: number): Uint8Array {
    const rgba = new Uint8Array(size * size * 4)
    for (let p = 0; p < size * size; p++) {
        const argb = parseHex(tones[p % tones.length])!
        rgba.set([(argb >>> 16) & 0xff, (argb >>> 8) & 0xff, argb & 0xff, argb >>> 24], p * 4)
    }
    return rgba
}

test('blended colors paint with every blended shade and come back from the engine the same way', () => {
    const stops = ['#FF000000', '#FFFFFFFF']
    const storm = ['#FF000040', '#FF4080C0']
    const { data, input } = wings()
    data.palette = { slots: [{ id: 'feather', name: 'Feather', ramp: stops, customizable: true, interpolate: 5 }], colorways: { storm: { feather: storm } }, fixed: [] }
    const shades = slotTones(data.palette.slots[0])
    assert.deepEqual(shades, blendTones(stops, 5))
    assert.equal(shades.length, 5)
    const rgba = rgbaOf(shades, 4)
    const indexed = indexPixels(4, 4, rgba, data.palette)
    assert.equal(indexed.off, null)
    assert.deepEqual(Array.from(indexed.index), Array.from({ length: 16 }, (_, p) => (p % 5) + 1))
    input.textures = [{ id: 'storm_wings', png: encodePng(4, 4, rgba, 4), index: encodePng(4, 4, indexed.index, 1) }]

    const built = roundTrip(data, input)
    assert.deepEqual(JSON.parse(built.files['palettes.json']).slots[0], { id: 'feather', name: 'Feather', ramp: stops, interpolate: 5, customizable: true })
    const [plain] = resolveCosmeticTexture(built.files, built.binary, -1)
    assert.deepEqual(Array.from(plain.rgba), Array.from(rgba))
    const [stormy] = resolveCosmeticTexture(built.files, built.binary, 0)
    assert.deepEqual(Array.from(stormy.rgba), Array.from(rgbaOf(blendTones(storm, 5), 4)))

    const brighter = { ...data.palette, slots: [{ ...data.palette.slots[0], ramp: [stops[0], '#FFFF0000'] }] }
    const remap = toneRemap(data.palette, brighter)
    assert.equal(remap.get(toArgbKey(shades[2])!), toArgbKey(blendTones(brighter.slots[0].ramp, 5)[2]))

    const rows = { slots: [{ key: 0, from: 'feather', id: 'feather', name: 'Feather', ramp: stops.slice(), customizable: true, interpolate: 2 }], colorways: [], fixed: [] }
    assert.equal(roomForTone(rows, 0), false)
    rows.slots[0].interpolate = 5
    assert.equal(roomForTone(rows, 0), true)
})

