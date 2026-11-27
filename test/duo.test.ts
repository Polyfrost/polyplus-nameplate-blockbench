import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCosmetic } from '../src/cosmetic/build'
import { refreshChecks } from '../src/cosmetic/checks'
import { COSMETIC_FORMATS, RoleData } from '../src/cosmetic/data'
import { actorAt, controllerPlayLength, placement, roleIndex, rolePlayLength, seats, spotOf } from '../src/cosmetic/duo'
import { advanceDuo, DUO_VIEW_ROOT, duoActor, duoUi, HeldDuo, heldFrame, setDuoLength, startDuo, stopDuo } from '../src/cosmetic/duoPreview'
import { freshHolds, HOLD_STEP_SECONDS } from '../src/cosmetic/duoHold'
import { engineFromWorld, modelFromEngine, particleBuffers, particleView } from '../src/cosmetic/particles'
import { propBoneNames } from '../src/cosmetic/livePose'
import { clearPreview, setEngineDriven, setSignal } from '../src/cosmetic/preview'
import { COSMETIC_PROPERTY } from '../src/cosmetic/state'
import { EmoteDriver, IDENTITY, PLAYER_BONES, QUAD_FLOATS } from '../src/engine'
import { animation, bone as geoBone, cleanBuild, cosmetic, FEATHER, geometry, LASTING_SPARKS, paintedTexture, sources, steadySpark, using, withScene } from './cosmeticKit'

const BONE = 12

function duo(roles: RoleData[]) {
    const data = cosmetic('emote', 'wave', (d) => {
        d.emote.roles = roles
    })
    const built = cleanBuild(data, sources((s) => {
        s.animations = {
            'animation.wave.a': { ...animation(['rightArm'], 1.5), loop: true },
            'animation.wave.b': { ...animation(['leftArm'], 1.5), loop: true },
        }
    }))
    return EmoteDriver.open(built.files, built.binary)!
}

const A: RoleData = { id: 'a', animation: 'animation.wave.a', offset: [0, 0, 0], yaw: 0 }
const B: RoleData = { id: 'b', animation: 'animation.wave.b', offset: [1, 0.5, 2], yaw: 90 }

function bone(bones: Float32Array, name: string): number[] {
    const index = PLAYER_BONES.indexOf(name)
    return Array.from(bones.slice(index * BONE, index * BONE + BONE))
}

function near(actual: number[], expected: readonly number[], what: string) {
    assert.ok(actual.every((value, i) => Math.abs(value - expected[i]) < 1e-3), `${what}: ${actual.map((v) => v.toFixed(3)).join(' ')}`)
}

const moved = (values: number[]) => values.some((value, i) => Math.abs(value - IDENTITY[i]) > 1e-3)

function played(driver: EmoteDriver, actors: Parameters<EmoteDriver['frame']>[2], until = 1, step = 1 / 30): Float32Array[] {
    let frames: Float32Array[] = []
    for (let t = 0; t <= until; t += step) frames = driver.frame(t, t, actors)
    return frames
}

test('roles resolve by id the way PolyPlus seats them, and a dummy on its spot needs no correction from the engine', () => {
    assert.deepEqual([roleIndex([{ id: 'b' }, { id: 'a' }], 0), roleIndex([{ id: 'b' }, { id: 'a' }], 1), roleIndex([{ id: 'a' }, { id: 'a' }], 1)], [1, 0, 1])
    assert.deepEqual(seats([B, A]).map((seat) => [seat.seat, seat.role]), [[0, 1], [1, 0]])
    assert.deepEqual(seats([A]).map((seat) => seat.role), [0])
    const actor = actorAt(1, spotOf(B))
    assert.deepEqual([actor.role, actor.yaw], [1, -90])
    near([...actor.anchor], [-2, -0.5, 1], 'anchor seen from the spot')
    using([duo([B, A]), duo([A, B])], (seated, alone) => {
        const [first, second] = played(seated, seats([B, A]).map((seat) => seat.actor))
        near(bone(first, 'root'), IDENTITY, 'seat a root')
        near(bone(second, 'root'), IDENTITY, 'seat b root')
        near(bone(played(alone, [{ role: 1, anchor: [0, 0, 0], yaw: 0 }])[0], 'root'), placement(spotOf(B)), 'the placement matches where the engine puts the role itself')
    })
})

test('prop bones follow the engine order, parents first and only bones that draw, and each role animates its own copy', () => {
    const model = geometry('wave', [
        geoBone('tassel', 'flag'),
        geoBone('flag', 'right_arm', { cubes: [] }),
        geoBone('rightArm_parts', 'rightArm'),
        geoBone('empty', 'body', { cubes: [] }),
        geoBone('pole', 'leftArm', { cubes: [], locators: { tip: [0, 30, 0] } }),
    ])
    const props = propBoneNames(model)
    assert.deepEqual(props, ['flag', 'rightArm_parts', 'pole', 'tassel'])
    assert.deepEqual(propBoneNames(geometry('wave', [geoBone('loose', null)])), ['loose'])
    assert.deepEqual(propBoneNames(null), [])
    const data = cosmetic('emote', 'wave', (d) => {
        d.emote.roles = [A, B]
    })
    const built = buildCosmetic(data, sources((s) => {
        s.geometry = model
        s.animations = { 'animation.wave.a': { ...animation(['flag'], 1.5), loop: true }, 'animation.wave.b': { ...animation(['pole'], 1.5), loop: true } }
    }))
    using([EmoteDriver.open(built.files, built.binary)!], (driver) => {
        assert.equal(driver.bones, PLAYER_BONES.length + props.length, 'the engine draws the same prop bones')
        const at = (bones: Float32Array, name: string) => {
            const index = PLAYER_BONES.length + props.indexOf(name)
            return Array.from(bones.slice(index * BONE, index * BONE + BONE))
        }
        const [first, second] = played(driver, seats([A, B]).map((seat) => seat.actor))
        assert.deepEqual([moved(at(first, 'flag')), moved(at(first, 'pole'))], [true, false], 'role a swings only its flag')
        assert.deepEqual([moved(at(second, 'pole')), moved(at(second, 'flag'))], [true, false], 'role b swings only its pole')
    })
})

test('a duo is as long as the clips its controller states play and its constant start delays, and the length can be set by hand', () => {
    const data = cosmetic('emote', 'wave', (d) => {
        d.emote.roles = [A, { ...B, animation: 'animation.wave.a' }]
        d.controllers = ['controller.animation.wave.duo']
    })
    const built = cleanBuild(data, sources((s) => {
        s.animations = {
            'animation.wave.a': { ...animation(['rightArm'], 1.5), loop: true },
            'animation.wave.intro': animation(['leftArm'], 2),
            'animation.wave.unused': animation(['leftArm'], 9),
        }
        s.controllers = {
            'controller.animation.wave.duo': {
                initial_state: 'intro',
                states: {
                    intro: { animations: ['intro'], transitions: [{ main: 'query.all_animations_finished' }] },
                    main: { animations: [{ a: 'v.emote_role >= 0' }] },
                },
            },
            'controller.animation.wave.off': { states: { default: { animations: ['unused'] } } },
        }
    }))
    assert.equal(controllerPlayLength(built.files), 3.5)
    assert.equal(controllerPlayLength({}), 0)
    const delayed = cleanBuild(data, sources((s) => {
        s.animations = {
            'animation.wave.a': animation(['rightArm'], 1, { loop: false, start_delay: 2 }),
            'animation.wave.b': animation(['leftArm'], 1.5, { loop: false, start_delay: 'math.random(0, 4)' }),
            'animation.wave.intro': animation(['leftArm'], 2, { start_delay: '0.5' }),
        }
        s.controllers = { 'controller.animation.wave.duo': { initial_state: 'intro', states: { intro: { animations: ['intro'] } } } }
    }))
    const lengths: Record<string, number> = { 'animation.wave.a': 1, 'animation.wave.b': 1.5 }
    assert.equal(rolePlayLength(['animation.wave.a', 'animation.wave.b'], delayed.files, (name) => lengths[name] ?? 0), 3)
    assert.equal(rolePlayLength([], delayed.files, () => 1), 0)
    assert.equal(controllerPlayLength(delayed.files), 2.5)
    for (const [length, kept] of [[6, 6], [0.1, 0.25], [Number.NaN, 0.25]]) {
        setDuoLength(length)
        assert.equal(duoUi.length, kept)
    }
    stopDuo()
})

test('the duo preview clock stands still while paused and a seek asks for a replay', () => {
    assert.deepEqual(advanceDuo(3, 1, 2, false, 0.05), { clock: 3, time: 1, replay: false })
    assert.deepEqual(advanceDuo(3, 1, 2, true, 0.5), { clock: 3.5, time: 1.5, replay: false })
    assert.deepEqual(advanceDuo(3, 1.8, 2, true, 0.5), { clock: 3.5, time: 0, replay: true })
})

test('the duo preview drives the rig itself, so a signal toggle leaves Blockbench animations and its timeline alone', () => {
    let previews = 0
    let starts = 0
    const clips: Record<string, Record<string, unknown>> = {
        'animation.wave.a': { ...animation(['rightArm'], 1.5), loop: true },
        'animation.wave.b': { ...animation(['leftArm'], 1.5), loop: true },
    }
    const animations = Object.entries(clips).map(([name, json]) => ({ name, playing: false, compileBedrockAnimation: () => json }))
    const data = cosmetic('emote', 'wave', (d) => {
        d.emote.roles = [A, B]
        d.reactions = [
            { signal: 'is_hurt', on: 'start', play: 'animation.wave.a', restart: false, blend: 0, speed: null, palette: '', effect: '' },
            { signal: 'is_sneaking', on: 'while', play: 'animation.wave.b', restart: false, blend: 0, speed: null, palette: '', effect: '' },
        ] as any
    })
    withScene({
        Format: { id: COSMETIC_FORMATS.emote },
        Project: { [COSMETIC_PROPERTY]: data },
        Animator: { animations, MolangParser: { global_variables: {} }, showDefaultPose: () => {}, preview: () => previews++ },
        Timeline: { setTime: () => {}, start: () => starts++, pause: () => {} },
    }, () => {
        try {
            refreshChecks()
            assert.equal(startDuo(), true, duoUi.note)
            setSignal('is_hurt', 1)
            setSignal('is_sneaking', 1)
            assert.deepEqual([previews, starts, animations[0].playing, animations[1].playing], [0, 0, false, false], 'the engine pose is left alone')
            setSignal('is_hurt', 0)
            setSignal('is_sneaking', 0)
            setEngineDriven(true, 'live')
            stopDuo()
            setSignal('is_hurt', 1)
            assert.equal(previews, 0, 'stopping the duo keeps another engine preview in charge')
            setSignal('is_hurt', 0)
            setEngineDriven(false, 'live')
            assert.equal(startDuo(), true, duoUi.note)
            stopDuo()
            setSignal('is_hurt', 1)
            assert.ok(previews > 0 && starts === 1 && animations[0].playing, 'once the duo stops Blockbench plays it again')
        } finally {
            stopDuo()
            setEngineDriven(false, 'live')
            setSignal('is_hurt', 0)
            setSignal('is_sneaking', 0)
            clearPreview()
        }
    })
})

const SPARK_VIEW = particleView(engineFromWorld([...IDENTITY], DUO_VIEW_ROOT), [0, 24, -80], [1, 0, 0], [0, 1, 0])

test('rooting a duo actor on its spot for its sparks leaves its pose alone', () => {
    using([duo([A, B]), duo([A, B])], (shared, placed) => {
        const at = seats([A, B])
        const before = played(shared, at.map((seat) => seat.actor))
        const after = played(placed, at.map(duoActor))
        at.forEach((_, i) => near(Array.from(after[i]), Array.from(before[i]), `seat ${i}`))
    })
})

test('duo sparks are drawn at both participants, and a duo that catches up keeps the sparks a played one shows', () => {
    const data = cosmetic('emote', 'wave', (d) => {
        d.emote.roles = [A, B]
        d.palette = { slots: [{ id: 'fur', name: 'Fur', ramp: FEATHER, customizable: false }], colorways: {}, fixed: [] }
        steadySpark(d, 'tip', LASTING_SPARKS)
    })
    const built = cleanBuild(data, sources((s) => {
        s.geometry = geometry('wave', [geoBone('pole', 'leftArm', { locators: { tip: [0, 30, 2] } })])
        s.textures = [paintedTexture(data, 'wave')]
        s.animations = {
            'animation.wave.a': { ...animation(['pole'], 1.5), loop: true },
            'animation.wave.b': { ...animation(['pole'], 1.5), loop: true },
        }
    }))
    const open = () => EmoteDriver.open(built.files, built.binary)!
    using([open(), open()], (played, caught) => {
        const at = seats([A, B])
        const actors = at.map(duoActor)
        const playedDuo: HeldDuo = { driver: played, actors, holds: freshHolds(2), heldTo: -HOLD_STEP_SECONDS }
        for (let k = 0; k * HOLD_STEP_SECONDS < 2; k++) {
            heldFrame(playedDuo, k * HOLD_STEP_SECONDS, k * HOLD_STEP_SECONDS, {}, SPARK_VIEW)
            played.effects(SPARK_VIEW)
        }
        heldFrame(playedDuo, 2, 2, {}, SPARK_VIEW)
        const shown = played.effects(SPARK_VIEW)
        assert.ok(shown.length / QUAD_FLOATS >= 10, `a played duo shows sparks: ${shown.length / QUAD_FLOATS}`)
        const buffers = particleBuffers(shown, SPARK_VIEW.slice(0, 3), modelFromEngine(DUO_VIEW_ROOT))
        const zs = Array.from({ length: buffers.count }, (_, n) => (buffers.positions[n * 12 + 2] + buffers.positions[n * 12 + 8]) / 2)
        for (const seat of at) assert.ok(zs.some((value) => Math.abs(value - seat.spot.z * 16) < 8), `a spark near seat ${seat.seat}: ${zs}`)
        heldFrame({ driver: caught, actors, holds: freshHolds(2), heldTo: -HOLD_STEP_SECONDS }, 2, 2, {}, SPARK_VIEW)
        assert.deepEqual(Array.from(caught.effects(SPARK_VIEW)), Array.from(shown))
    })
})
