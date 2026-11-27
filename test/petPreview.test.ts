import assert from 'node:assert/strict'
import test from 'node:test'
import { refreshChecks } from '../src/cosmetic/checks'
import { COSMETIC_FORMATS, CosmeticData, ReactionData } from '../src/cosmetic/data'
import { NO_ROLE, petPairSeats, petPairSignals, placement, Seat } from '../src/cosmetic/duo'
import { HOLD_STEP_SECONDS } from '../src/cosmetic/duoHold'
import { multiply } from '../src/cosmetic/livePose'
import { modelFromEngine, particleBuffers, particleView, engineFromWorld } from '../src/cosmetic/particles'
import { PET_VARIABLES, petRoleVariables } from '../src/cosmetic/pet'
import { choosePetInteraction, duePetEvents, loopPetEvents, loopPetSignals, nextPetLap, PET_CATCH_UP_SECONDS, PET_PAIR_VIEW_ROOT, PetEvent, petHostAt, petLapTime, petPairInput, petRoots, PetSignalChange, petSignalsAt, petUi, playPetRoles, recordPetEvent, recordPetSignals, replayPetSession, scrubPetRoles, startPetPlay, stopPetPlay } from '../src/cosmetic/petPreview'
import { preview, setSignal, takeEvents, wearAgain } from '../src/cosmetic/preview'
import { ColorwayPaint } from '../src/cosmetic/recolor'
import { PreviewSounds } from '../src/cosmetic/sounds'
import { COSMETIC_PROPERTY } from '../src/cosmetic/state'
import { CosmeticDriver, DriverInput, engineSignals, EVENT_EQUIP, IDENTITY, QUAD_FLOATS } from '../src/engine'
import { animation, bone, cleanBuild, cosmetic, FEATHER, geometry, LASTING_SPARKS, paintedTexture, sources, steadySpark, using, withGlobals, withScene } from './cosmeticKit'

const SCALE = 0.75

function reaction(signal: string, on: ReactionData['on'], palette: string): ReactionData {
    return { signal, on, play: '', restart: false, blend: 0, speed: null, palette, effect: '' } as ReactionData
}

function pet(change: (data: CosmeticData) => void, bones = [bone('root', null), bone('ear', 'root'), bone('tail', 'root')]) {
    const data = cosmetic('pet', 'pup', (d) => {
        d.pet = { archetype: 'flying', leashRadius: 4, scale: SCALE, anchor: '', interactions: { play: ['a', 'b'] }, roles: [] } as any
        d.palette = { slots: [{ id: 'fur', name: 'Fur', ramp: FEATHER, customizable: false }], colorways: {}, fixed: [] }
        change(d)
    })
    const built = cleanBuild(data, sources((s) => {
        s.geometry = geometry('pup', bones)
        s.animations = {
            'animation.pup.idle': animation(['root']),
            'animation.pup.play_a': { loop: true, animation_length: 1, bones: { ear: { rotation: [0, 0, 60] } } },
        }
        s.textures = [paintedTexture(data, 'pup')]
    }))
    return { data, open: () => CosmeticDriver.open(built.files, built.binary, engineSignals(), PET_VARIABLES, true)! }
}

function dryEquip(d: CosmeticData) {
    d.palette.colorways = { dry: { fur: ['#FF405060', '#FF7090B0'] } }
    d.reactions = [reaction('', 'equip', 'dry')]
}

const ROLE_A = { interaction: 'play', id: 'a', animation: 'animation.pup.play_a', offset: [0.25, 0, -0.75] as [number, number, number], yaw: 30 }

function pairInputs(seats: Seat[], t: number, events: number[] = [], interaction = 'play'): DriverInput[] {
    const { size } = petRoots(SCALE)
    return seats.map((seat, i) => petPairInput(seat, seat.spot, size, t, petPairSignals({}, interaction, seat), petRoleVariables({}, interaction, seat.seat, t), events[i] ?? 0))
}

test('each pet in the pair gets an engine root at its own spot, posing it where the preview places it', () => {
    const { open } = pet((d) => {
        d.pet.roles = [ROLE_A]
    })
    const seats = petPairSeats([ROLE_A], 'play', SCALE)
    assert.deepEqual(seats.map((seat) => seat.role), [0, NO_ROLE])
    const { root, unroot } = petRoots(SCALE)
    using([open(), open()], (shared, placed) => {
        const legacy = (t: number): DriverInput[] => seats.map((seat) => ({
            signals: petPairSignals({}, 'play', seat),
            variables: petRoleVariables({}, 'play', seat.seat, t),
            events: 0,
            root,
            ...(seat.role === NO_ROLE ? {} : { role: { index: seat.role, anchor: seat.actor.anchor, yaw: seat.actor.yaw, age: t } }),
        }))
        shared.play(0)
        placed.play(0)
        let before = shared.frameAll(0, legacy(0))
        let after = placed.frameAll(0, pairInputs(seats, 0))
        for (let t = 1 / 20; t <= 0.5; t += 1 / 20) {
            before = shared.frameAll(t, legacy(t))
            after = placed.frameAll(t, pairInputs(seats, t))
        }
        seats.forEach((seat, i) => {
            const shift = multiply(multiply(PET_PAIR_VIEW_ROOT, placement(seat.spot)), unroot)
            for (let b = 0; b < shared.bones; b++) {
                const expected = multiply(shift, Array.from(before[i].bones.slice(b * 12, b * 12 + 12)))
                Array.from(after[i].bones.slice(b * 12, b * 12 + 12)).forEach((value, k) => assert.ok(Math.abs(value - expected[k]) < 1e-3, `pet ${i} bone ${b} entry ${k}: ${value} vs ${expected[k]}`))
            }
        })
    })
})

test('pair particles are drawn at each pet, and a replayed pair session keeps the sparks a live one shows', () => {
    const { open } = pet((d) => {
        d.pet.interactions = { greet: ['a', 'b'] }
        steadySpark(d, 'ring', LASTING_SPARKS)
    }, [bone('root', null, { locators: { ring: [0, 30, 0] } })])
    const seats = petPairSeats([], 'greet', SCALE)
    assert.notEqual(seats[0].spot.z, seats[1].spot.z)
    const inputs = (t: number) => pairInputs(seats, t, [], 'greet')
    const view = particleView(engineFromWorld([...IDENTITY], PET_PAIR_VIEW_ROOT), [0, 24, -80], [1, 0, 0], [0, 1, 0])
    using([open(), open()], (live, replayed) => {
        live.play(0)
        for (let k = 0; k * HOLD_STEP_SECONDS < 2; k++) {
            live.frameAll(k * HOLD_STEP_SECONDS, inputs(k * HOLD_STEP_SECONDS))
            live.effects(view)
        }
        live.frameAll(2, inputs(2))
        const shown = live.effects(view)
        assert.ok(shown.length / QUAD_FLOATS >= 10, `a live session shows sparks: ${shown.length / QUAD_FLOATS}`)
        const built = particleBuffers(shown, view.slice(0, 3), modelFromEngine(PET_PAIR_VIEW_ROOT))
        const zs = Array.from({ length: built.count }, (_, n) => (built.positions[n * 12 + 2] + built.positions[n * 12 + 8]) / 2)
        for (const seat of seats) assert.ok(zs.some((z) => Math.abs(z - seat.spot.z * 16) < 1), `a particle near pet ${seat.seat}: ${zs}`)
        replayPetSession(replayed, 2, 2, inputs, [], [], view)
        replayed.frameAll(2, inputs(2))
        assert.deepEqual(Array.from(replayed.effects(view)), Array.from(shown))
    })
})

test('each pet in the pair shows its own reaction colourway, and Wear again recolours only the first', () => {
    const { open } = pet((d) => {
        d.pet.roles = [ROLE_A]
        d.palette.colorways = { dry: { fur: ['#FF405060', '#FF7090B0'] }, wet: { fur: ['#FF101010', '#FF202020'] } }
        d.reactions = [reaction('is_emoting', 'while', 'wet'), reaction('', 'equip', 'dry')]
    })
    const seats = petPairSeats([ROLE_A], 'play', SCALE)
    using([open()], (driver) => {
        driver.play(0)
        let frames = driver.frameAll(0, pairInputs(seats, 0))
        for (let t = 1 / 20; t <= 0.3; t += 1 / 20) frames = driver.frameAll(t, pairInputs(seats, t))
        assert.deepEqual(frames.map((frame) => frame.colorway), [-1, 1])
        frames = driver.frameAll(0.35, pairInputs(seats, 0.35, [EVENT_EQUIP, 0]))
        for (let t = 0.4; t <= 0.6; t += 1 / 20) frames = driver.frameAll(t, pairInputs(seats, t))
        assert.deepEqual(frames.map((frame) => frame.colorway), [0, 1])
    })
})

class FakeShader {
    disposed = false
    constructor(public uniforms: Record<string, { value: unknown }>) {}
    clone() {
        return new FakeShader(Object.fromEntries(Object.entries(this.uniforms).map(([name, uniform]) => [name, { value: uniform.value }])))
    }
    dispose() {
        this.disposed = true
    }
}

class FakeTree {
    constructor(readonly meshes: Array<{ material: any }>) {}
    traverse(visit: (object: any) => void) {
        visit(this)
        for (const mesh of this.meshes) visit(mesh)
    }
}

test('a colourway repaints only the pet it belongs to and puts the textures back', () => {
    const base = { name: 'base' }
    const shared = new FakeShader({ map: { value: base }, light: { value: 1 } })
    const other = new FakeShader({ map: { value: { name: 'other' } } })
    const painted: number[] = []
    const driver = {
        textureNames: () => ['pup'],
        texture: (index: number, colorway: number) => {
            painted.push(colorway)
            return { name: 'pup', width: 1, height: 1, rgba: new Uint8Array(4) }
        },
    } as unknown as CosmeticDriver
    withGlobals({
        THREE: { CanvasTexture: class { disposed = false; constructor(readonly image: unknown) {} dispose() { this.disposed = true } } },
        Texture: { all: [{ getMaterial: () => shared }] },
        document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) }) },
    }, () => {
        const single = { material: shared }
        const faces = { material: [shared, other] }
        const partner = { material: shared }
        const first = new FakeTree([single, faces])
        const second = new FakeTree([partner])
        const mine = new ColorwayPaint()
        const theirs = new ColorwayPaint()
        const manifest = { textures: ['pup'] }
        mine.show([first], driver, manifest, 1)
        assert.notEqual(single.material, shared)
        assert.equal(faces.material[0], single.material)
        assert.equal(faces.material[1], other)
        assert.equal(partner.material, shared, 'the other pet keeps its own colours')
        assert.notEqual(single.material.uniforms.map.value, base)
        assert.equal(single.material.uniforms.light, shared.uniforms.light)
        assert.equal(shared.uniforms.map.value, base, 'the project texture itself is untouched')
        mine.show([first], driver, manifest, 1)
        assert.deepEqual(painted, [1], 'an unchanged colourway is not rebuilt')
        theirs.show([second], driver, manifest, 0)
        assert.notEqual(partner.material, single.material)
        const made = single.material
        mine.show([first], driver, manifest, -1)
        assert.equal(single.material, shared)
        assert.deepEqual(faces.material, [shared, other])
        assert.ok(made.disposed)
        assert.notEqual(partner.material, shared)
        theirs.clear()
        assert.equal(partner.material, shared)
    })
})

interface SceneFrame {
    clock: number
    events: number
    partner: number
    hurt: number
    colorway: number
    bones: Float32Array
}

interface Scene {
    step: () => SceneFrame[]
    sounds: () => number
    previews: () => number
}

interface SceneOptions {
    animations?: Record<string, unknown>
    controllers?: Record<string, unknown>
    bones?: Array<Record<string, unknown>>
    beforeStart?: () => void
}

function petScene(data: CosmeticData, body: (scene: Scene) => void, options: SceneOptions = {}) {
    const { animations = {}, controllers = {}, bones = [bone('root', null)] } = options
    let previews = 0
    let sounds = 0
    const FakeGroup = class {
        static all: unknown[] = []
        name = 'root'
        parent = null
    }
    FakeGroup.all = [new FakeGroup()]
    withScene({
        Format: { id: COSMETIC_FORMATS.pet },
        Project: { [COSMETIC_PROPERTY]: data },
        Group: FakeGroup,
        Codecs: { bedrock: { compile: () => geometry('pup', bones) } },
        AnimationController: { all: Object.entries(controllers).map(([name, json]) => ({ name, states: [], compileForBedrock: () => json })) },
        Animator: { animations: Object.entries(animations).map(([name, json]) => ({ name, compileBedrockAnimation: () => json })), MolangParser: { global_variables: {} }, showDefaultPose: () => {}, preview: () => previews++ },
    }, (frames) => {
        const seen: SceneFrame[] = []
        const frameAll = CosmeticDriver.prototype.frameAll
        CosmeticDriver.prototype.frameAll = function (clock: number, inputs: readonly DriverInput[]) {
            const out = frameAll.call(this, clock, inputs)
            seen.push({ clock, events: inputs[0].events, partner: inputs[1]?.events ?? 0, hurt: Number(inputs[0].signals.is_hurt ?? 0), colorway: out[0].colorway, bones: out[0].bones })
            return out
        }
        const play = PreviewSounds.prototype.play
        PreviewSounds.prototype.play = function () {
            sounds++
        }
        let now = 1000
        const step = () => {
            seen.length = 0
            now += 50
            frames.shift()!(now)
            return seen.slice()
        }
        try {
            refreshChecks()
            options.beforeStart?.()
            assert.equal(startPetPlay(), true, petUi.note)
            body({ step, sounds: () => sounds, previews: () => previews })
        } finally {
            CosmeticDriver.prototype.frameAll = frameAll
            PreviewSounds.prototype.play = play
            stopPetPlay()
            takeEvents()
            setSignal('is_hurt', 0)
            delete preview.host.pet_mood
        }
    })
}

function untilLoop(step: () => SceneFrame[]): SceneFrame[] {
    for (;;) {
        const before = petUi.time
        const seen = step()
        if (petUi.time < before) return seen
    }
}

const last = (frames: SceneFrame[]) => frames[frames.length - 1]
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9
const EAR_BONES = [bone('root', null), bone('ear', 'root')]


test('the two-pet preview drives the rig itself and passes Wear again to the first pet, once', () => {
    petScene(pet(dryEquip).data, ({ step, previews }) => {
        assert.equal(takeEvents(), 0, 'a Wear again from before the preview is dropped')
        const before = previews()
        setSignal('is_hurt', 1)
        assert.equal(previews(), before, 'Blockbench does not play its own timeline over the engine pose')
        step()
        wearAgain()
        const seen = step()
        assert.deepEqual([last(seen).events, last(seen).partner], [EVENT_EQUIP, 0])
        assert.equal(seen.filter((frame) => frame.events || frame.partner).length, 1, 'the event reaches one frame only')
        assert.equal(takeEvents(), 0)
        stopPetPlay()
        setSignal('is_hurt', 0)
        assert.ok(previews() > before, 'stopping hands the pose back to Blockbench')
    }, { beforeStart: wearAgain })
})

test('Wear again in the two-pet preview survives a checks refresh, a loop and a pause', () => {
    petScene(pet(dryEquip).data, ({ step, sounds }) => {
        const equips = (frames: SceneFrame[]) => frames.filter((frame) => frame.events & EVENT_EQUIP)
        while (petUi.time < 1) step()
        wearAgain()
        assert.equal(equips(step()).length, 1)
        refreshChecks()
        assert.equal(petUi.on, true, petUi.note)
        let seen = step()
        assert.ok(seen.length > 2, 'the refresh replays the session')
        assert.equal(equips(seen).length, 1, 'the refresh replays the earlier Wear again once')
        assert.notEqual(equips(seen)[0], last(seen))
        while (petUi.time < petUi.length - 0.2) step()
        wearAgain()
        step()
        seen = untilLoop(step)
        assert.equal(seen.length, 1, 'the loop keeps the pets running instead of replaying them')
        assert.equal(equips(seen).length, 0, 'and sends no Wear again twice')
        step()
        playPetRoles(false)
        step()
        const quiet = sounds()
        step()
        assert.equal(sounds(), quiet, 'a paused preview makes no sound on its own')
        wearAgain()
        assert.equal(equips(step()).length, 1)
        assert.equal(sounds(), quiet + 1, 'a paused Wear again still plays its sound')
        assert.equal(equips(step()).length, 0, 'and reaches the engine once')
        scrubPetRoles(petUi.time + 0.5)
        seen = step()
        assert.equal(equips(seen).filter((frame) => frame.clock < last(seen).clock).length, 3, 'scrubbing replays the paused Wear again and both from the earlier lap')
    })
})

function replayCalls(clock: number, time: number, history: PetEvent[] = [], changes: PetSignalChange[] = []) {
    const calls: Array<{ clock: number, time: number, events: number, signals: Readonly<Record<string, number>> }> = []
    const driver = {
        reset() {},
        play() {},
        frameAll(clock: number, inputs: readonly DriverInput[]) {
            calls.push({ clock, time: (inputs[0] as any).time, events: inputs[0].events, signals: inputs[0].signals })
            return []
        },
    }
    replayPetSession(driver as any, clock, time, (t, events) => [{ time: t, events, signals: petSignalsAt(changes, t), root: IDENTITY } as any], history, changes)
    return calls
}

test('a pet session replay puts each Wear again back at its session time, including ones from before a loop', () => {
    const history: PetEvent[] = []
    recordPetEvent(history, 0.3, EVENT_EQUIP)
    recordPetEvent(history, -0.12, EVENT_EQUIP)
    recordPetEvent(history, 0.07, 1)
    recordPetEvent(history, 0.07, 2)
    assert.deepEqual(history.map((event) => [event.at, event.bits]), [[-0.12, EVENT_EQUIP], [0.07, 3], [0.3, EVENT_EQUIP]])
    const calls = replayCalls(10, 0.2, history)
    assert.deepEqual(calls.map((call) => call.events), [EVENT_EQUIP, 0, 0, 0, 0, 3, 0, 0])
    assert.ok(near(calls[0].time, -0.12) && near(calls[0].clock, 9.68), 'the earlier press is replayed at its own time before the session starts')
    assert.ok(near(calls[5].time, 0.07) && near(calls[5].clock, 9.87))
    assert.ok(calls.every((call, i) => i === 0 || call.time > calls[i - 1].time))
    assert.equal(duePetEvents(history, 0.2), 0, 'a later press waits for its time')
    assert.equal(duePetEvents(history, 0.3), EVENT_EQUIP)
    assert.equal(duePetEvents(history, 0.3), 0, 'each press is sent once')
    const looped = loopPetEvents([...history, { at: 5, bits: 1, sent: false }, { at: -2, bits: 1, sent: true }], 3.05, 4)
    assert.deepEqual(looped.map((event) => Math.round(event.at * 100) / 100), [-3.17, -2.98, -2.75], 'presses not reached yet and ones too old are dropped')
    const edge = loopPetEvents([{ at: 2.98, bits: EVENT_EQUIP, sent: true }], 3.01)
    assert.deepEqual(replayCalls(10, 0, edge).map((call) => [Math.round(call.time * 100) / 100, call.events]), [[-0.03, EVENT_EQUIP]], 'a press 30 ms before a loop lands before the new session')
    assert.equal(duePetEvents(edge, 0), 0, 'and the audible first frame of the loop does not send it again')
    assert.deepEqual(replayCalls(10, 0.1, edge).map((call) => [Math.round(call.time * 100) / 100, call.events]), [[-0.03, EVENT_EQUIP], [0, 0], [0.05, 0]])
})

test('a pet session replay feeds each signal change at its own time and a loop keeps an old change only as its state', () => {
    const changes: PetSignalChange[] = []
    recordPetSignals(changes, 0, {})
    recordPetSignals(changes, 0.5, {})
    assert.deepEqual(changes, [{ at: 0, values: {} }], 'the signals the session starts with are kept as its first state')
    recordPetSignals(changes, 1.03, { is_hurt: 1 })
    recordPetSignals(changes, 1.2, { is_hurt: 1 })
    recordPetSignals(changes, 2, { is_hurt: 0, is_sneaking: 1 })
    assert.deepEqual(changes.map((change) => change.at), [0, 1.03, 2], 'only real changes are kept')
    assert.deepEqual(petSignalsAt(changes, 1.5), { is_hurt: 1 })
    const calls = replayCalls(10, 2.1, [], changes)
    const hurt = calls.filter((call) => call.signals.is_hurt)
    assert.ok(hurt.length > 0 && near(hurt[0].time, 1.03), 'Hurt reaches the engine at the moment it was turned on')
    assert.ok(calls.filter((call) => call.time < 1.03).every((call) => !call.signals.is_hurt), 'and is off before it')
    assert.ok(calls.filter((call) => call.time >= 2).every((call) => call.signals.is_sneaking === 1 && !call.signals.is_hurt))
    const rewound = changes.slice()
    recordPetSignals(rewound, 1.5, {})
    assert.deepEqual(rewound.map((change) => change.at), [0, 1.03, 1.5], 'a change after scrubbing back replaces the later ones')
    assert.deepEqual(loopPetSignals(changes, 4, 4).map((change) => Math.round(change.at * 100) / 100), [-4, -2.97, -2])
    assert.deepEqual(loopPetSignals(changes, 8, 4), [{ at: -6, values: { is_hurt: 0, is_sneaking: 1 } }], 'old changes leave only the state they ended on, at the time it began')
    const edge = loopPetSignals([{ at: 0, values: {} }, { at: 3.55, values: { is_hurt: 1 } }], 6.05, 4)
    assert.deepEqual(edge.map((change) => [Math.round(change.at * 100) / 100, change.values.is_hurt ?? 0]), [[-6.05, 0], [-2.5, 1]], 'an old state stays before a recent change so the change is still an edge')
    assert.deepEqual(loopPetSignals([{ at: 5, values: { is_hurt: 1 } }], 3, 4), [], 'a change not reached yet is dropped')
    const host: PetSignalChange[] = []
    recordPetSignals(host, 0, {}, { pet_mood: 0 })
    recordPetSignals(host, 1, {}, { pet_mood: 1 })
    assert.deepEqual(host.map((change) => change.at), [0, 1], 'a host variable change alone is a change')
    assert.equal(petHostAt(host, 0.5).pet_mood, 0)
})

test('a loop keeps Wear again presses and signal edges for the catch-up window and remembers where each lap began', () => {
    const round = (value: number) => Math.round(value * 100) / 100
    const pressed: PetEvent[] = [{ at: 2, bits: EVENT_EQUIP, sent: true }]
    assert.equal(loopPetEvents(pressed, 8).length, 1, 'a press from the lap before is kept')
    assert.equal(loopPetEvents(pressed, PET_CATCH_UP_SECONDS + 3).length, 0, 'and dropped once it is older than the catch-up window')
    const blip = loopPetSignals([{ at: 0, values: {} }, { at: 1, values: { is_hurt: 1 } }, { at: 1.05, values: {} }], 6)
    assert.deepEqual(blip.map((change) => [round(change.at), change.values.is_hurt ?? 0]), [[-6, 0], [-5, 1], [-4.95, 0]], 'a brief Hurt keeps both of its edges')
    let laps = nextPetLap(nextPetLap([], 6.05), 6.1)
    assert.deepEqual(laps.map(round), [-12.15, -6.1])
    assert.ok(near(petLapTime(laps, -11), 1.15), 'a time in the first lap counts from its start')
    assert.ok(near(petLapTime(laps, -5.6), 0.5))
    assert.ok(near(petLapTime(laps, 0.3), 0.3))
    for (let lap = 0; lap < 40; lap++) laps = nextPetLap(laps, 6)
    assert.ok(laps[0] <= -PET_CATCH_UP_SECONDS && laps[1] > -PET_CATCH_UP_SECONDS, `old laps are dropped: ${laps.slice(0, 2)}`)
})

test('a loop keeps the last change of every signal at its own time, and a signal held for many loops keeps its real start with a bounded replay', () => {
    const rain: PetSignalChange[] = []
    recordPetSignals(rain, 0, {})
    recordPetSignals(rain, 1, { is_in_rain: 1 })
    recordPetSignals(rain, 2, { is_in_rain: 1 }, { pet_mood: 1 })
    assert.deepEqual(loopPetSignals(rain, 12, 4), [{ at: -11, values: { is_in_rain: 1 } }, { at: -10, values: { is_in_rain: 1 }, host: { pet_mood: 1 } }], 'Rain starts when it was turned on, not at the later Mood change')
    const sneak: PetSignalChange[] = []
    recordPetSignals(sneak, 0, { is_sneaking: 1 })
    recordPetSignals(sneak, 5, { is_sneaking: 1 }, { pet_mood: 1 })
    const looped = loopPetSignals(sneak, 12, 4)
    assert.deepEqual(looped.map((change) => change.at), [-12, -7])
    assert.equal(petSignalsAt(looped, -12).is_sneaking, 1, 'Sneaking has been on for the whole 12 s loop')
    assert.deepEqual([petHostAt(looped, -12).pet_mood ?? 0, petHostAt(looped, -7).pet_mood], [0, 1])
    let held: PetSignalChange[] = [{ at: 0, values: { is_in_rain: 1 } }]
    for (let loop = 0; loop < 25; loop++) held = loopPetSignals(held, 6, 4)
    assert.deepEqual(held.map((change) => change.at), [-150], 'after 150 s of rain the change is 150 s back, past the replay window')
    const calls = replayCalls(100, 1, [], held)
    assert.ok(near(calls[0].time, -150) && calls[0].signals.is_in_rain === 1, 'the engine sees Rain turn on 150 s back, so its _time keeps counting past the window')
    assert.ok(near(calls[1].time, -PET_CATCH_UP_SECONDS), 'then the replay jumps to the window')
    assert.ok(calls.length <= (PET_CATCH_UP_SECONDS + 1) / 0.05 + 2, `${calls.length} replay frames`)
})

test('the two-pet preview breaks the effect rings when the pets jump back at each lap, live and when replayed', () => {
    const { data } = pet((d) => {
        d.pet.interactions = {} as any
    }, EAR_BONES)
    const proto = CosmeticDriver.prototype as any
    const breakRings = proto.breakRings
    petScene(data, ({ step }) => {
        const log: string[] = []
        const frameAll = proto.frameAll
        proto.frameAll = function (clock: number, inputs: readonly DriverInput[]) {
            log.push('frame')
            return frameAll.call(this, clock, inputs)
        }
        proto.breakRings = function () {
            log.push('break')
            return breakRings ? breakRings.call(this) : false
        }
        try {
            choosePetInteraction('greet')
            assert.equal(petUi.on, true, petUi.note)
            let wraps = 0
            while (wraps < 2 || petUi.time < 0.2) {
                const before = petUi.time
                log.length = 0
                step()
                const wrapped = petUi.time < before
                if (wrapped) wraps++
                assert.deepEqual(log, wrapped ? ['break', 'frame'] : ['frame'], wrapped ? 'a lap start breaks the rings before the pets are drawn at their start spots' : 'a frame inside a lap keeps the rings')
            }
            playPetRoles(false)
            step()
            log.length = 0
            refreshChecks()
            assert.equal(petUi.on, true, petUi.note)
            step()
            assert.equal(log.filter((entry) => entry === 'break').length, wraps, 'the replay breaks the rings once at each lap start it crosses')
            assert.equal(log[0], 'frame')
            log.forEach((entry, i) => {
                if (entry === 'break') assert.equal(log[i + 1], 'frame')
            })
        } finally {
            proto.frameAll = frameAll
            proto.breakRings = breakRings
        }
    }, { bones: EAR_BONES })
})
