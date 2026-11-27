import assert from 'node:assert/strict'
import test from 'node:test'
import { refreshChecks } from '../src/cosmetic/checks'
import { RoleData } from '../src/cosmetic/data'
import { DUO_CATCH_UP_SECONDS, duoCatchUpFrom, duoUi, playDuo, scrubDuo, setDuoLength, startDuo, stopDuo } from '../src/cosmetic/duoPreview'
import { clearPreview, EQUIP_EVENT, setEngineDriven, setSignal, takeEvents, wearAgain } from '../src/cosmetic/preview'
import { COSMETIC_PROPERTY } from '../src/cosmetic/state'
import { EmoteDriver } from '../src/engine'
import { animation, cosmetic, Frames, withGlobals, withScene } from './cosmeticKit'

const A: RoleData = { id: 'a', animation: 'animation.wave.a', offset: [0, 0, 0], yaw: 0 }
const B: RoleData = { id: 'b', animation: 'animation.wave.b', offset: [1, 0, 0], yaw: 90 }

function duoScene(run: (frames: Frames, ages: Array<{ age: number, hurt: number }>) => void, resets = () => {}) {
    const clip = (name: string) => ({ name, length: 1.5, loop: 'loop', compileBedrockAnimation: () => ({ ...animation(['rightArm'], 1.5), loop: true }) })
    const ages: Array<{ age: number, hurt: number }> = []
    const frame = EmoteDriver.prototype.frame
    EmoteDriver.prototype.frame = function (this: EmoteDriver, ...args: Parameters<EmoteDriver['frame']>) {
        ages.push({ age: args[1], hurt: Number(args[3]?.is_hurt ?? 0) })
        return frame.apply(this, args)
    }
    try {
        withScene({
            Format: { id: 'polyplus_emote' },
            Project: { [COSMETIC_PROPERTY]: cosmetic('emote', 'wave', (d) => { d.emote.roles = [A, B] }) },
            Animator: { animations: [clip('animation.wave.a'), clip('animation.wave.b')], showDefaultPose: resets },
        }, (frames) => {
            try {
                refreshChecks()
                assert.equal(startDuo(), true, duoUi.note)
                run(frames, ages)
            } finally {
                stopDuo()
            }
        })
    } finally {
        EmoteDriver.prototype.frame = frame
    }
}

test('a duo preview that cannot reopen after an edit puts the dummy back in its default pose', () => {
    let resets = 0
    duoScene(() => {
        const before = resets
        ;(globalThis as any).Project[COSMETIC_PROPERTY] = cosmetic('emote', 'wave', (d) => { d.emote.roles = [A] })
        refreshChecks()
        assert.equal(duoUi.on, false)
        assert.equal(duoUi.note, 'Add two roles to preview a duo.')
        assert.ok(resets > before, 'the default pose comes back')
    }, () => resets++)
})

test('reopening a duo preview after a checks refresh keeps its playback time past the timeline range', () => {
    duoScene((frames) => {
        setDuoLength(2)
        let now = 1000
        while (duoUi.time < 10) {
            now += 50
            frames.shift()!(now)
        }
        const before = duoUi.time
        assert.ok(before > duoUi.length, `a looping duo plays past its range: ${before}`)
        refreshChecks()
        assert.equal(duoUi.on, true, duoUi.note)
        assert.equal(duoUi.time, before, 'reopening keeps the playback time')
        scrubDuo(before)
        assert.equal(duoUi.time, duoUi.length, 'scrubbing stays inside the range')
    })
})

test('reopening a duo preview after two minutes keeps its time and catches up from its latest loop point', () => {
    assert.deepEqual([duoCatchUpFrom(10, 2), duoCatchUpFrom(DUO_CATCH_UP_SECONDS, 2), duoCatchUpFrom(131, 2), duoCatchUpFrom(131.5, 1.5), duoCatchUpFrom(400, 300), duoCatchUpFrom(800, 600), duoCatchUpFrom(130, 0)], [0, 0, 130, 130.5, 300, 680, 10])
    duoScene((frames, ages) => {
        setDuoLength(2)
        playDuo(false)
        frames.shift()!(1000)
        duoUi.time = 131.3
        ages.length = 0
        refreshChecks()
        assert.equal(duoUi.on, true, duoUi.note)
        frames.shift()!(1050)
        assert.equal(duoUi.time, 131.3, 'reopening keeps the playback time')
        assert.ok(ages.length > 1 && ages.length <= 2 / 0.05 + 2, `the catch-up stays short: ${ages.length} frames`)
        assert.ok(ages[0].age >= 130 - 1e-6, `it starts from the latest loop point: ${ages[0].age}`)
        assert.equal(ages[ages.length - 1].age, 131.3)
    })
})

test('rebuilding a duo preview replays each signal change at the time it was made', () => {
    setSignal('is_hurt', 0)
    try {
        duoScene((frames, seen) => {
            setDuoLength(10)
            let now = 1000
            const step = () => {
                now += 50
                frames.shift()!(now)
            }
            while (duoUi.time < 1) step()
            setSignal('is_hurt', 1)
            const on = duoUi.time + 0.05
            step()
            step()
            setSignal('is_hurt', 0)
            const off = duoUi.time + 0.05
            step()
            while (duoUi.time < 2) step()
            seen.length = 0
            refreshChecks()
            assert.equal(duoUi.on, true, duoUi.note)
            step()
            assert.ok(seen.length > 20, `the rebuild replays the duo: ${seen.length} frames`)
            const hurt = seen.filter((entry) => entry.hurt)
            assert.ok(hurt.length > 0, 'the brief Hurt reaches the rebuilt engine')
            assert.ok(hurt.every((entry) => entry.age >= on - 0.06 && entry.age < off + 0.01), `only while it was on: ${hurt.map((entry) => entry.age)}`)
            assert.equal(seen[seen.length - 1].hurt, 0)
        })
    } finally {
        setSignal('is_hurt', 0)
    }
})

function tailProject(reactions: object[], animations: object[], preview: () => void, extra: Record<string, unknown> = {}) {
    return {
        Format: { id: 'polyplus_item' },
        Project: { [COSMETIC_PROPERTY]: cosmetic('item', 'tail', (d) => { d.reactions = reactions as any }) },
        Animator: { animations, MolangParser: { global_variables: {} }, preview },
        ...extra,
    }
}

function reaction(signal: string, on: string, play: string) {
    return { signal, on, play, restart: false, blend: 0, speed: null, palette: '', effect: '' }
}

test('with the engine driving the preview, Wear again and signal one-shots only reach the engine', () => {
    let starts = 0
    let previews = 0
    const flick = { name: 'animation.tail.flick', playing: false }
    const flinch = { name: 'animation.tail.flinch', playing: false }
    withGlobals(tailProject([reaction('', 'equip', flick.name), reaction('is_hurt', 'start', flinch.name)], [flick, flinch], () => previews++, { Timeline: { setTime: () => {}, start: () => starts++ } }), () => {
        try {
            takeEvents()
            setEngineDriven(true)
            wearAgain()
            setSignal('is_hurt', 1)
            assert.equal(takeEvents(), EQUIP_EVENT)
            assert.deepEqual([starts, previews, flick.playing, flinch.playing], [0, 0, false, false])
            setSignal('is_hurt', 0)
            setEngineDriven(false)
            wearAgain()
            setSignal('is_hurt', 1)
            assert.equal(takeEvents(), EQUIP_EVENT)
            assert.deepEqual([starts, previews > 0, flick.playing, flinch.playing], [2, true, true, true])
        } finally {
            setEngineDriven(false)
        }
    })
})

test('with the engine driving the preview, a while reaction leaves the Blockbench animation as it was', () => {
    const wag = { name: 'animation.tail.wag', playing: false }
    withGlobals(tailProject([reaction('is_sneaking', 'while', wag.name)], [wag], () => {}), () => {
        try {
            setEngineDriven(true)
            setSignal('is_sneaking', 1)
            assert.equal(wag.playing, false, 'turning the signal on leaves the animation alone')
            setEngineDriven(false)
            assert.equal(wag.playing, false, 'stopping the engine preview finds it as it was')
            setSignal('is_sneaking', 0)
            wag.playing = true
            setEngineDriven(true)
            setSignal('is_sneaking', 1)
            setSignal('is_sneaking', 0)
            setEngineDriven(false)
            assert.equal(wag.playing, true, 'turning the signal off leaves a playing animation playing')
            setSignal('is_sneaking', 1)
            setSignal('is_sneaking', 0)
            assert.equal(wag.playing, false, 'without the engine the signal drives it again')
        } finally {
            setEngineDriven(false)
            setSignal('is_sneaking', 0)
            clearPreview()
        }
    })
})
