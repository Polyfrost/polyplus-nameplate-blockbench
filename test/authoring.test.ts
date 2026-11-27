import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { inflateRawSync } from 'node:zlib'
import { buildCosmetic } from '../src/cosmetic/build'
import { cosmeticCost } from '../src/cosmetic/checks'
import { encodePng } from '../src/cosmetic/png'
import { loadBundle } from '../src/engine'
import { costReport } from '../src/preview/cost'
import { replayedTag, replayFrames, replaySteps } from '../src/engine/gl'
import { FLAG_BADGE, OUT } from '@plusrenderer/renderer/nameplate.js'
import { lineBlock } from '../src/engine/block'
import { deflateRaw, deflateZip } from '../src/util/zip'
import { classifyIssue } from '../src/checks/codes'
import { buildBundle, emptySources } from '../src/cosmetic/bundle'
import { applyParticleFields, missingSlotIssues, molangList, particleFields, starterParticle } from '../src/cosmetic/effects'
import { COSMETIC_DATA_VERSION, defaultCosmetic, normalizeCosmetic } from '../src/cosmetic/data'
import { bone, cosmetic, geometry } from './cosmeticKit'
import { alphaOf, paletteFromRows, remapPixels, rgbOf, toneRemap, withAlpha, withRgb } from '../src/cosmetic/colors'
import { detachRig } from '../src/cosmetic/project'
import { groupSpring, SPRING_PRESETS, storedSpring } from '../src/cosmetic/springs'

test('a group spring is off until it is switched on, stays off after a property reset, and one saved before the switch reads as on', () => {
    const off = storedSpring(null)
    const on = storedSpring(SPRING_PRESETS.ear)
    assert.deepEqual([{}, null, undefined, off, structuredClone(off), { ...on, enabled: false }].map(groupSpring), [null, null, null, null, null, null])
    assert.deepEqual(groupSpring(structuredClone(on)), SPRING_PRESETS.ear)
    assert.deepEqual(groupSpring({ ...SPRING_PRESETS.ribbon }), SPRING_PRESETS.ribbon)
})

test('export drops only the player reference parts and keeps what was added under them', () => {
    const model = {
        bones: [
            { name: 'head', pivot: [0, 24, 0] },
            { name: 'body', pivot: [0, 24, 0], cubes: [{ origin: [1, 2, 3], size: [1, 1, 1] }], locators: { tip: [0, 30, 0] } },
            { name: 'hat', parent: 'head', pivot: [0, 32, 0], cubes: [{ origin: [0, 32, 0], size: [2, 2, 2] }] },
            { name: 'body_parts', pivot: [0, 0, 0] },
        ],
    }
    detachRig(model, new Set(['head', 'body']))
    assert.deepEqual(model.bones.map((bone: any) => bone.name), ['body_parts_2', 'hat', 'body_parts'])
    const kept: any = model.bones[0]
    assert.equal(kept.parent, 'body')
    assert.deepEqual(kept.pivot, [0, 24, 0])
    assert.deepEqual(kept.locators, { tip: [0, 30, 0] })
    assert.equal(kept.cubes.length, 1)
    assert.equal((model.bones[1] as any).parent, 'head')
})

test('recolouring remaps exact palette pixels and leaves the rest', () => {
    const data = new Uint8ClampedArray([0x11, 0x22, 0x33, 0x80, 0x11, 0x22, 0x33, 0xff, 0x11, 0x22, 0x33, 0])
    assert.equal(remapPixels(data, new Map([['80112233', '40445566']])), true)
    assert.deepEqual(Array.from(data), [0x44, 0x55, 0x66, 0x40, 0x11, 0x22, 0x33, 0xff, 0x11, 0x22, 0x33, 0])
    assert.equal(remapPixels(data, new Map([['FFABCDEF', 'FF000000']])), false)
})

test('palette tones keep their alpha through the colour inputs', () => {
    assert.deepEqual([alphaOf('#112233'), alphaOf('#80112233'), rgbOf('#80112233')], [255, 128, '#112233'])
    assert.deepEqual([withRgb('#80112233', '#445566'), withRgb('#112233', '#445566')], ['#80445566', '#445566'])
    assert.deepEqual([withAlpha('#112233', 128), withAlpha('#112233', 255), withAlpha('#80112233', 255)], ['#80112233', '#112233', '#FF112233'])
})

test('a palette shade never saves fully transparent, so its painted pixels stay recolourable', () => {
    const fill = (tone: string) => paletteFromRows({ slots: [{ key: 0, from: 'fill', id: 'fill', name: 'Fill', ramp: [tone], customizable: false }], colorways: [], fixed: [] }).palette
    const hidden = fill('#00112233')
    assert.ok(alphaOf(hidden.slots[0].ramp[0]) > 0)
    const data = new Uint8ClampedArray([0x11, 0x22, 0x33, 0xff])
    remapPixels(data, toneRemap(fill('#112233'), hidden))
    assert.ok(data[3] > 0)
    assert.equal(remapPixels(data, toneRemap(hidden, fill('#112233'))), true)
    assert.deepEqual(Array.from(data), [0x11, 0x22, 0x33, 0xff])
})

test('colorway overrides on a colour added in the same edit are saved under its new id', () => {
    const saved = paletteFromRows({
        slots: [
            { key: 0, from: 'fill', id: 'fill', name: 'Fill', ramp: ['#80112233'], customizable: false },
            { key: 1, from: null, id: 'color', name: 'Trim', ramp: ['#445566'], customizable: true },
        ],
        colorways: [{ key: 2, from: 'night', name: 'night', overrides: { fill: ['#40000000'], color: ['#101010'] } }],
        fixed: ['#7F000000'],
    })
    assert.deepEqual(saved.palette.slots.map((slot) => slot.id), ['fill', 'trim'])
    assert.deepEqual(saved.palette.slots[0].ramp, ['#80112233'])
    assert.deepEqual(saved.palette.colorways.night, { fill: ['#40000000'], trim: ['#101010'] })
    assert.deepEqual(saved.palette.fixed, ['#7F000000'])
    assert.equal(saved.renamed.get('night'), 'night')
})

function importedParticle(): Record<string, any> {
    return {
        format_version: '1.10.0',
        particle_effect: {
            description: { identifier: 'polyplus:aura', basic_render_parameters: { material: 'particles_blend', texture: '' } },
            components: {
                'minecraft:emitter_rate_steady': { spawn_rate: 'v.rate', max_particles: 40 },
                'minecraft:emitter_lifetime_expression': { activation_expression: 'q.is_moving', expiration_expression: 0 },
                'minecraft:emitter_shape_entity_aabb': { direction: [0, 1, 0], surface_only: true },
                'minecraft:particle_motion_dynamic': { linear_acceleration: [0, 1, 0], linear_drag_coefficient: 2, rotation_acceleration: 4 },
                'minecraft:particle_appearance_billboard': { size: [0.2, 0.2], facing_camera_mode: 'lookat_xyz', uv: { texture_width: 16, texture_height: 16, uv: [0, 0], uv_size: [16, 16] } },
            },
        },
    }
}

test('editing an imported particle keeps every Snowstorm setting the form does not show', () => {
    const json = importedParticle()
    const fields = particleFields(json)
    assert.equal(fields.shape, 'entity_aabb')
    assert.equal(fields.lifetime, 'expression')
    assert.deepEqual(applyParticleFields(json, fields), json)
    const edited = applyParticleFields(json, { ...fields, max: 60, size: [0.3, 0.3] })
    const expected = importedParticle()
    expected.particle_effect.components['minecraft:emitter_rate_steady'].max_particles = 60
    expected.particle_effect.components['minecraft:particle_appearance_billboard'].size = [0.3, 0.3]
    assert.deepEqual(edited, expected)
    const moved = applyParticleFields(json, { ...fields, shape: 'sphere', radius: 0.5 })
    assert.equal(moved.particle_effect.components['minecraft:emitter_shape_entity_aabb'], undefined)
    assert.equal(moved.particle_effect.components['minecraft:emitter_shape_sphere'].radius, 0.5)
})

test('formula lists split only at top-level commas', () => {
    assert.deepEqual(molangList('math.clamp(v.a, 0, 1), 2, "a,b"', 3), ['math.clamp(v.a, 0, 1)', 2, '"a,b"'])
    assert.deepEqual(molangList('1', 2), [1, 1])
    assert.deepEqual(molangList('q.x, math.max(1, [2, 3])', 2), ['q.x', 'math.max(1, [2, 3])'])
})

test('a tint that points at a deleted palette colour is a check, not slot 0', () => {
    const data = cosmetic('effect', 'glow', (d) => {
        d.palette = { slots: [{ id: 'fill', name: 'Fill', ramp: ['#FF112233'], customizable: false }], colorways: {}, fixed: [] }
        d.effects.particles = [{ id: 'spark', picture: '', json: starterParticle('spark'), tint: { slot: 'gone', tone: 0 } }]
        d.effects.trails = [{ locator: 'back', picture: '', blend: 'alpha', width: [0.25, 0.25], tile: false, tint: { kind: 'slot', slot: 'gone', tone: 1 }, fade: 1, minSpeed: 0, while: [] }]
    })
    const issues = missingSlotIssues(data)
    assert.deepEqual(issues.map((issue) => [issue.code, issue.path, issue.names.slot]), [
        ['palette_slot_missing', 'manifest.json#particles.spark.tint', 'gone'],
        ['palette_slot_missing', 'manifest.json#trails.0.tint', 'gone'],
    ])
    assert.equal(classifyIssue(issues[0]).code, 'palette_slot_missing')
    const manifest = JSON.parse(buildBundle(data, emptySources(), []).files['manifest.json'])
    assert.equal(manifest.particles.spark.tint, undefined)
    assert.equal(manifest.trails[0].tint, undefined)
})

test('cosmetic data keeps fields this plugin does not know and a newer version', () => {
    const base = defaultCosmetic('item', 'hat') as any
    const raw = {
        ...base,
        version: COSMETIC_DATA_VERSION + 1,
        future: { glow: 2 },
        attach: { ...base.attach, offset: [1, 2, 3] },
        palette: { slots: [{ id: 'fill', name: 'Fill', ramp: ['#112233'], customizable: false, shine: 1 }], colorways: {}, fixed: [], mood: 'warm' },
        reactions: [{ signal: 'is_hurt', on: 'start', play: 'a', restart: false, blend: 0, speed: null, palette: '', effect: '', weight: 3 }],
        effects: { ...base.effects, trails: [{ locator: 'back', picture: 'p', blend: 'alpha', width: [1, 1], tile: false, tint: { kind: 'color', color: '#FFFFFF' }, fade: 1, minSpeed: 0, while: [], sparkle: true }], extra: 1 },
    }
    const data = normalizeCosmetic(raw, 'item') as any
    assert.equal(data.version, COSMETIC_DATA_VERSION + 1)
    assert.deepEqual(data.future, { glow: 2 })
    assert.deepEqual(data.attach.offset, [1, 2, 3])
    assert.equal(data.palette.mood, 'warm')
    assert.equal(data.palette.slots[0].shine, 1)
    assert.equal(data.reactions[0].weight, 3)
    assert.equal(data.effects.extra, 1)
    assert.equal(data.effects.trails[0].sparkle, true)
    assert.deepEqual(normalizeCosmetic(JSON.parse(JSON.stringify(data)), 'item'), data)
    assert.equal(normalizeCosmetic({ ...base, version: 0 }, 'item').version, COSMETIC_DATA_VERSION)
})

test('the zip deflates each file and inflates back byte for byte', () => {
    const random = new Uint8Array(5000)
    for (let i = 0, x = 7; i < random.length; i++) random[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24
    const runs = new Uint8Array(70000).fill(9)
    const text = new TextEncoder().encode('{"bones":[' + Array.from({ length: 400 }, (_, i) => `{"name":"b${i % 37}","pivot":[0,${i},0]}`).join(',') + ']}')
    for (const input of [new Uint8Array(0), new Uint8Array([1, 2]), random, runs, text]) {
        assert.deepEqual(new Uint8Array(inflateRawSync(deflateRaw(input))), input)
    }
    assert.ok(deflateRaw(runs).length < 1000)
    const zip = deflateZip({ 'b.json': new TextDecoder().decode(text), 'a.bin': random })
    assert.equal(zip.length < text.length + random.length, true)
})

test('a bundle that is big only before compression passes the download limit', () => {
    const size = 1024
    const solid = new Uint8Array(size * size * 4).fill(200)
    const data = cosmetic('item', 'big_hat', () => {})
    const input = emptySources()
    input.geometry = geometry('big_hat', [bone('hat', 'head')]) as any
    input.textures = [{ id: 'a', png: encodePng(size, size, solid, 4), index: null }, { id: 'b', png: encodePng(size, size, solid.slice(), 4), index: null }]
    const built = buildCosmetic(data, input)
    assert.ok(built.load)
    assert.deepEqual(built.issues.filter((issue) => issue.code === 'download_too_large'), [])
})

test('the graphics card preview replays signals and one-shots up to the shown frame without moving it', () => {
    const plain = replaySteps(null, 500, 20)
    assert.deepEqual(plain, [{ frame: 499, on: [], fire: [] }, { frame: 500, on: [], fire: [] }])
    const pop = { name: 'pop', trigger: 'start', signal: 'is_sneaking', keep: 5, appear: null }
    const state = { reactions: ['sneaking'], oneShots: ['pop'], starts: Int32Array.from([95]), held: 10 }
    assert.deepEqual(replaySteps(state, 100, 20, [pop]), [
        { frame: 89, on: [], fire: [] },
        { frame: 90, on: ['is_sneaking'], fire: [] },
        { frame: 95, on: ['is_sneaking'], fire: ['pop'] },
        { frame: 100, on: ['is_sneaking'], fire: [] },
    ])
    const edge = replaySteps({ ...state, starts: Int32Array.from([90]) }, 100, 20, [pop])
    assert.ok(edge.every((step) => step.fire.length === 0), 'the engine fires a start shot on its own edge, so the replay does not fire it again')
    const both = replaySteps({ reactions: ['sneaking', 'sprinting'], oneShots: [], starts: new Int32Array(0), held: 50, heldBy: { is_sneaking: 2, is_sprinting: 50 } }, 100, 20)
    assert.deepEqual(both.map((step) => [step.frame, step.on]), [[49, []], [50, ['is_sprinting']], [98, ['is_sneaking', 'is_sprinting']], [100, ['is_sneaking', 'is_sprinting']]])
    const held = replaySteps({ reactions: ['sneaking'], oneShots: [], starts: new Int32Array(0) }, 3, 20)
    assert.ok(held.every((step) => step.on.includes('is_sneaking')))
    const hi = { name: 'hi', trigger: 'appear', signal: null, keep: 30, appear: 1 }
    const seen = replaySteps({ reactions: [], oneShots: ['hi'], starts: Int32Array.from([10]), held: undefined }, 12, 20, [hi])
    assert.equal(seen[0].frame, 10 - 31, 'the first sight runs its own appear out before the replayed one')
    assert.equal(seen[seen.length - 1].frame, 12)
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i].frame - seen[i - 1].frame < 20, 'no gap long enough to count as unseen')
    assert.deepEqual(seen.filter((step) => step.fire.length).map((step) => [step.frame, step.fire]), [[10, ['hi']]])
})

test('the cost section shows the engine analysis against the limits it knows', () => {
    const analysis = { requires: [], quads: 2400, bones: 12, spring_bones: 2, live_particles: 10.5, trail_points: 0, record_bytes: 3072, texture_bytes: 4096 }
    const over = { path: 'models/x.json', code: 'quads_over_budget', level: 'error' as const, values: { limit: 2000, actual: 2400 }, names: {}, message: '' }
    const rows = cosmeticCost(analysis, [over], 'pet', { bones_per_pet: 128, wearer_record_bytes: 2048 })
    assert.deepEqual(rows.map((row) => [row.label, row.value, row.percent, row.over]), [
        ['Shapes drawn', '2,400 / 2,000', 100, true],
        ['Bones', '12 / 128', 9, false],
        ['Swinging bones', '2', null, false],
        ['Particles alive at once', '11', null, false],
        ['Wearer memory', '3.0 KB / 2.0 KB', 100, true],
        ['Picture memory', '4.0 KB', null, false],
    ])
    assert.deepEqual(cosmeticCost(null, [], 'item', null), [])
})

function kit(name: string): { files: Record<string, string>, binary: Record<string, Uint8Array> } {
    const root = resolve('..', 'plusrenderer', 'crates', 'core', 'src', 'nameplate', 'format', 'testdata', name)
    const files: Record<string, string> = {}
    const binary: Record<string, Uint8Array> = {}
    const walk = (base: string) => {
        for (const entry of readdirSync(join(root, base), { withFileTypes: true })) {
            const path = base ? `${base}/${entry.name}` : entry.name
            if (entry.isDirectory()) walk(path)
            else if (path.endsWith('.json')) files[path] = readFileSync(join(root, path), 'utf8')
            else binary[path] = new Uint8Array(readFileSync(join(root, path)))
        }
    }
    walk('')
    return { files, binary }
}

test('effect layers report their material, settings and pictures from the bundle and the engine', { skip: !existsSync(resolve('..', 'plusrenderer')) }, () => {
    const { files, binary } = kit('material_plate')
    const manifest = JSON.parse(files['manifest.json'])
    manifest.params = { glow: { value: 0.5, min: 0, max: 1 } }
    manifest.variants = { soft: {}, bright: { params: { glow: 0.75 } } }
    const graph = JSON.parse(files['materials/halo.json'])
    graph.nodes.splice(-1, 0, { id: 'glow', type: 'Param', set: { name: 'glow' } }, { id: 'dim', type: 'mul', in: { a: 'fall', b: 'glow' } })
    graph.nodes.find((node: { id: string }) => node.id === 'light').in.alpha = 'dim'
    const loaded = loadBundle({ ...files, 'manifest.json': JSON.stringify(manifest), 'materials/halo.json': JSON.stringify(graph) }, binary)
    const preview = loaded.preview ?? loaded.draft?.() ?? null
    assert.ok(preview, JSON.stringify(loaded.issues))
    const analysis = preview.analysis()
    const effects = preview.effects()
    const measured = new Map(analysis.effects.map((effect) => [effect.layer, effect]))
    assert.deepEqual(effects.map((effect) => [effect.layer, effect.material]), [['halo', 'halo'], ['plate', 'tide'], ['crest', 'crest']])
    for (const effect of effects) {
        const engine = measured.get(effect.layer)!
        assert.equal(effect.states, engine.states)
        assert.equal(effect.shotStates, engine.shot_states)
        assert.equal(effect.toneSlots, engine.tone_slots)
        assert.ok(effect.states > 0)
    }
    assert.deepEqual(effects[0].reads, ['glow'])
    assert.deepEqual(effects[0].animated, [])
    assert.deepEqual(preview.paramCurve('halo', 'glow', 'bright', 0, 3), [0.75, 0.75, 0.75])
    assert.deepEqual(preview.paramCurve('halo', 'glow', 'soft', 0, 2), [0.5, 0.5])
    const cost = preview.cost(false)
    assert.deepEqual(cost.effects.map((effect) => effect.layer), ['halo', 'plate', 'crest'])
    assert.equal(cost.flashChecked, true)
    assert.equal(cost.materialBuildOps, analysis.material_build_ops)
    assert.ok(analysis.material_build_ops > 0)
    assert.deepEqual(cost.layers.map((layer) => layer.margin), analysis.layers.map((layer) => layer.margin))
    assert.equal(cost.margin, Math.max(...analysis.layers.map((layer) => layer.margin)))
    const report = costReport({ preview, skipped: null, issues: [], warnings: [] })
    assert.equal(report.flashPending, false)
    assert.equal(report.rows.find((row) => row.id === 'flash')?.value, 'Passes')
    assert.ok(report.rows.some((row) => row.id === 'rebuild'))
    assert.equal(report.rows.find((row) => row.id === 'margin')?.value, `${cost.margin} px / 32 px`)
})

test('the graphics card preview replays long-stopped signals in a bounded number of frames, with their edges where they happened', () => {
    const fps = 20
    const frame = 100_000
    const hi = { name: 'hi', trigger: 'appear', signal: null, keep: 30, appear: 1 }
    const state = { reactions: [], oneShots: [], starts: new Int32Array(0), endedBy: { is_sneaking: [6020, 6000] as const } }
    const steps = replaySteps(state, frame, fps, [hi])
    assert.ok(steps.length < 100, `${steps.length} frames for a toggle 5 minutes ago`)
    const at = (wanted: number) => steps.find((step) => step.frame === wanted)
    assert.deepEqual(at(frame - 6020)?.on, ['is_sneaking'], 'it still turns on at its real start')
    assert.deepEqual(at(frame - 6000)?.on, [], 'and off at its real stop')
    assert.equal(steps[steps.length - 1].frame, frame)
    for (let i = 1; i < steps.length; i++) {
        const gap = steps[i].frame - steps[i - 1].frame
        assert.ok(gap > 0 && gap <= 200, `no gap long enough for the engine to forget the wearer (${gap})`)
        if (steps[i - 1].frame >= frame - 2 * hi.keep) assert.ok(gap < 20, 'near the shown frame no gap is long enough to replay the appear')
    }
    const hour = 72_000
    const old = replaySteps({ reactions: ['sneaking', 'sprinting'], oneShots: [], starts: new Int32Array(0), heldBy: { is_sneaking: hour, is_sprinting: hour + 10 }, endedBy: { is_swimming: [hour * 2, hour * 2 - 5] as const } }, frame, fps, [hi])
    assert.ok(old.length < 120, `${old.length} frames for signals held for an hour`)
    assert.ok(frame - old[0].frame <= 600 * fps + 2 * hi.keep + 32, 'history further back than ten minutes is not replayed')
    const firstOn = (signal: string) => old.find((step) => step.on.includes(signal))!.frame
    assert.ok(firstOn('is_sprinting') < firstOn('is_sneaking'), 'signals that started long ago keep their order')
    assert.ok(old.every((step) => !step.on.includes('is_swimming')), 'a signal that stopped long ago stays off')
    assert.ok(old[old.length - 1].on.includes('is_sneaking') && old[old.length - 1].on.includes('is_sprinting'))
})

test('the graphics card preview sets In combat on the wearer for every replayed frame, off included', () => {
    const calls: string[] = []
    const nameplates = {
        setMotion: (motion: number) => calls.push(`motion ${motion}`),
        forgetWearer: (wearer: bigint | number) => (calls.push(`forget ${wearer}`), true),
        setSignalOverride: (wearer: bigint | number, signal: string | number, value: number) => calls.push(`${wearer} ${signal}=${value}`),
        frame: (clock: number, _wearers: unknown, _row: Int32Array, signals: Float32Array) => {
            calls.push(`frame ${clock.toFixed(3)} raw=${signals[15]}`)
            return new Int32Array(1)
        },
        fire: () => true,
    }
    const state = { reactions: ['is_in_combat'], oneShots: [], starts: new Int32Array(0), heldBy: { is_in_combat: 10 } }
    const input = { wearer: 7n, assetId: 0, motion: 2, fps: 20, frame: 100, state, shotNames: [], shots: [] }
    replayFrames(nameplates as any, input, new Int32Array(0))
    assert.deepEqual(calls.slice(0, 2), ['motion 2', 'forget 7'])
    assert.deepEqual(calls.filter((call) => call.includes('is_in_combat')), ['7 is_in_combat=0', '7 is_in_combat=1', '7 is_in_combat=1'])
    calls.length = 0
    replayFrames(nameplates as any, { ...input, state: { ...state, reactions: ['hurt'], heldBy: { is_hurt: 10 } } }, new Int32Array(0))
    assert.ok(calls.filter((call) => call.includes('is_in_combat')).every((call) => call.endsWith('=0')), 'hurt alone keeps combat off')
})
test('the graphics card preview replays the plate with its own badge flag', () => {
    const flags: number[] = []
    const nameplates = {
        addAsset: () => 3,
        setMotion: () => {},
        forgetWearer: () => true,
        setSignalOverride: () => {},
        frame: (_clock: number, _wearers: unknown, row: Int32Array) => (flags.push(row[OUT.TAG_FLAGS]), new Int32Array(1)),
        fire: () => true,
        removeAsset: () => true,
        dispose: () => {},
    }
    const preview = { disposed: false, fps: 20, meta: {}, asset: { engine: { nameplates: () => nameplates } }, shotTiming: () => ({ length: 0, tail: 0, appear: 0 }) }
    const state = { reactions: [], oneShots: [], starts: new Int32Array(0), heldBy: {} }
    const job = { preview: preview as any, variant: 0, frame: 4, seed: 0, state, detail: 0, motion: 2 }
    assert.ok(replayedTag({ ...job, block: lineBlock(40, 0, 40) }, null))
    assert.ok(flags.length > 0 && flags.every((flag) => (flag & FLAG_BADGE) === 0), 'a plate without a badge replays without one')
    flags.length = 0
    assert.ok(replayedTag({ ...job, block: { ...lineBlock(40, 0, 40), badge: true } }, null))
    assert.ok(flags.length > 0 && flags.every((flag) => (flag & FLAG_BADGE) !== 0), 'a plate with a badge replays with it')
})
