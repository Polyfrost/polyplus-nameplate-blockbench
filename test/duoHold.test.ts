import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCosmetic } from '../src/cosmetic/build'
import { RoleData } from '../src/cosmetic/data'
import { seats } from '../src/cosmetic/duo'
import { EMOTE_CANCEL, EMOTE_CANCEL_CROUCHING, EMOTE_CANCEL_SPRINTING, EMOTE_CANCEL_SWINGING, EMOTE_CANCEL_WALKING, EMOTE_ENDED,EMOTE_HELD, freshHolds, HOLD_STEP_SECONDS, holdsFinished, holdStep, holdTicks, reactHolds, ROLE_FADE_SECONDS } from '../src/cosmetic/duoHold'
import { advanceOpenDuo, HeldDuo, heldFrame } from '../src/cosmetic/duoPreview'
import { EmoteDriver, IDENTITY, PLAYER_BONES } from '../src/engine'
import { animation, cosmetic, sources } from './cosmeticKit'

const BONE = 12

test('the preview decides to keep playing, hold or end a role the way PolyPlus does', () => {
    const yes = () => true
    const no = () => false
    assert.equal(holdStep(-1, false, yes, no), 'end')
    assert.equal(holdStep(EMOTE_CANCEL, true, yes, no), 'end')
    assert.equal(holdStep(1, false, yes, no), 'play')
    assert.equal(holdStep(EMOTE_ENDED, false, no, no), 'end')
    assert.equal(holdStep(EMOTE_ENDED, false, yes, no), 'hold')
    assert.equal(holdStep(EMOTE_HELD, false, yes, no), 'hold')
    assert.equal(holdStep(EMOTE_HELD, true, yes, yes), 'end')
    assert.equal(holdStep(1, true, yes, no), 'hold')
    assert.equal(holdStep(1, true, no, no), 'hold')
})

test('walking or sprinting on the mark keeps a duo role going, like PolyPlus', () => {
    const yes = () => true
    const no = () => false
    const walked = 1 | EMOTE_CANCEL | EMOTE_CANCEL_WALKING
    const sprinted = walked | EMOTE_CANCEL_SPRINTING
    assert.equal(holdStep(walked, false, yes, no, yes), 'play')
    assert.equal(holdStep(sprinted, false, yes, no, yes), 'play')
    assert.equal(holdStep(walked | EMOTE_HELD, true, yes, no, yes), 'hold')
    assert.equal(holdStep(walked, false, yes, no, no), 'end')
    assert.equal(holdStep(walked, false, yes, no), 'end')
    assert.equal(holdStep(walked | EMOTE_CANCEL_SWINGING, false, yes, no, yes), 'end')
    assert.equal(holdStep(1 | EMOTE_CANCEL | EMOTE_CANCEL_CROUCHING, false, yes, no, yes), 'end')
    assert.equal(holdStep(1 | EMOTE_CANCEL, false, yes, no, yes), 'end')
    const duo = freshHolds(2)
    reactHolds(duo, [walked, sprinted], 0.5)
    assert.deepEqual(duo.map((hold) => hold.stopping), [false, false])
    const solo = freshHolds(1)
    reactHolds(solo, [walked], 0.5)
    assert.equal(solo[0].stopping, true)
})

test('a role holds from the tick it ends until its partner is done, and both then stop', () => {
    const holds = freshHolds(2)
    reactHolds(holds, [1, 1], 0.5)
    assert.deepEqual(holds.map((hold) => hold.holding), [false, false])
    reactHolds(holds, [EMOTE_ENDED, 1], 1)
    assert.deepEqual(holds[0], { holding: true, heldAge: 1, heldFrom: 1, stopping: false, stoppedAt: 0 })
    reactHolds(holds, [EMOTE_HELD, 1], 2)
    assert.deepEqual(holds.map((hold) => hold.stopping), [false, false])
    reactHolds(holds, [EMOTE_HELD, EMOTE_ENDED], 3)
    assert.deepEqual(holds.map((hold) => [hold.holding, hold.stopping]), [[true, false], [false, true]], 'a role that ends after its partner already holds stops at once')
    reactHolds(holds, [EMOTE_HELD, EMOTE_HELD], 3.05)
    assert.deepEqual(holds.map((hold) => hold.stopping), [true, true])
    assert.deepEqual(holdTicks(-HOLD_STEP_SECONDS, 0.12).map((tick) => +tick.toFixed(2)), [0, 0.05, 0.1])
    assert.deepEqual(holdTicks(0.1, 0.2).map((tick) => +tick.toFixed(2)), [0.15, 0.2])
    assert.deepEqual(holdTicks(0.2, 0.24), [])
    for (const through of [0.3, 0.35, 0.7, 1.15]) assert.ok(holdTicks(0, through).every((tick) => tick <= through), `ticks stay at or before ${through}`)
})

const SHORT: RoleData = { id: 'a', animation: 'animation.wave.short', offset: [0, 0, 0], yaw: 0 }
const LONG: RoleData = { id: 'b', animation: 'animation.wave.long', offset: [0, 0, 1.5], yaw: 180 }

function bone(bones: Float32Array, name: string): number[] {
    const index = PLAYER_BONES.indexOf(name)
    return Array.from(bones.slice(index * BONE, index * BONE + BONE))
}

function moved(values: number[]): boolean {
    return values.some((value, i) => Math.abs(value - IDENTITY[i]) > 1e-3)
}

function openDuo(longLoops = false): { driver: EmoteDriver, actors: ReturnType<typeof seats>[number]['actor'][] } {
    const data = cosmetic('emote', 'wave', (d) => {
        d.emote.roles = [SHORT, LONG]
    })
    const input = sources((s) => {
        s.animations = {
            'animation.wave.short': { ...animation(['rightArm'], 1), loop: false },
            'animation.wave.long': { ...animation(['leftArm'], longLoops ? 2 : 3), loop: longLoops },
        }
    })
    const built = buildCosmetic(data, input)
    const driver = EmoteDriver.open(built.files, built.binary)
    assert.ok(driver)
    return { driver: driver!, actors: seats(data.emote.roles).map((seat) => seat.actor) }
}

function held(driver: EmoteDriver, actors: readonly any[]): HeldDuo {
    return { driver, actors, holds: freshHolds(actors.length), heldTo: -HOLD_STEP_SECONDS }
}

test('in the duo preview the shorter role keeps its last pose until the longer one finishes, when played or seeked', () => {
    const { driver, actors } = openDuo()
    try {
        assert.equal(moved(bone(driver.frame(2, 2, actors)[0], 'rightArm')), false, 'without holding, the short role is back at rest')
        driver.reset()
        const played = held(driver, actors)
        let frames: Float32Array[] = []
        for (let t = 0; t <= 2.0001; t += 1 / 60) frames = heldFrame(played, t, t)
        const end = bone(frames[0], 'rightArm')
        assert.ok(moved(end), 'the short role holds its end pose')
        assert.equal(played.holds[0].holding, true)
        assert.ok(Math.abs(played.holds[0].heldAge - 1) <= HOLD_STEP_SECONDS + 1e-6, `${played.holds[0].heldAge}`)
        assert.ok(moved(bone(frames[1], 'leftArm')), 'the long role still plays')
        driver.reset()
        const seeked = held(driver, actors)
        const jumped = heldFrame(seeked, 2.0001, 2.0001)
        assert.deepEqual(seeked.holds, played.holds, 'a seek ends up holding the same way as playing')
        bone(jumped[0], 'rightArm').forEach((value, i) => assert.ok(Math.abs(value - end[i]) < 1e-4, 'a seek shows the same held pose'))
        for (let t = 2.0001; t <= 3.6; t += 1 / 60) frames = heldFrame(seeked, t, t)
        assert.deepEqual(seeked.holds.map((hold) => hold.stopping), [true, true], 'both stop once the long role is done')
        assert.equal(moved(bone(frames[0], 'rightArm')), false, 'the short role then goes back to rest')
    } finally {
        driver.dispose()
    }
})

test('a duo preview finishes once every role has stopped and faded out', () => {
    const holds = freshHolds(2)
    assert.equal(holdsFinished(holds, 5), false)
    reactHolds(holds, [EMOTE_ENDED, 0], 1)
    assert.equal(holdsFinished(holds, 5), false, 'one role is only held')
    reactHolds(holds, [EMOTE_ENDED, EMOTE_ENDED], 2)
    assert.equal(holdsFinished(holds, 5), false, 'the held role stops a tick after its partner')
    reactHolds(holds, [EMOTE_HELD, EMOTE_ENDED], 2.05)
    assert.deepEqual(holds.map((hold) => [hold.stopping, hold.stoppedAt]), [[true, 2.05], [true, 2]])
    assert.equal(holdsFinished(holds, 2.05 + ROLE_FADE_SECONDS / 2), false)
    assert.equal(holdsFinished(holds, 2.05 + ROLE_FADE_SECONDS), true)
    assert.equal(holdsFinished([], 5), false)
    assert.deepEqual(advanceOpenDuo(3, 1, false, 0.05, true), { clock: 3, time: 1, replay: false })
    assert.deepEqual(advanceOpenDuo(3, 40, true, 0.5, false), { clock: 3.5, time: 40.5, replay: false })
    assert.deepEqual(advanceOpenDuo(3, 40, true, 0.5, true), { clock: 3.5, time: 0, replay: true })
})

function playDuo(longLoops: boolean, seconds: number): { restarts: number[], time: number, holds: ReturnType<typeof freshHolds> } {
    const { driver, actors } = openDuo(longLoops)
    try {
        const duo = held(driver, actors)
        const restarts: number[] = []
        let clock = 0
        let time = 0
        const step = 1 / 60
        for (let t = 0; t < seconds; t += step) {
            const next = advanceOpenDuo(clock, time, true, step, holdsFinished(duo.holds, time))
            if (next.replay) {
                restarts.push(next.clock)
                driver.reset()
                duo.holds = freshHolds(actors.length)
                duo.heldTo = -HOLD_STEP_SECONDS
            }
            clock = next.clock
            time = next.time
            heldFrame(duo, clock, time)
        }
        return { restarts, time, holds: duo.holds }
    } finally {
        driver.dispose()
    }
}

test('the duo preview keeps going while a partner loops and starts over only after both roles finish', () => {
    const looping = playDuo(true, 10)
    assert.deepEqual(looping.restarts, [], 'a looping partner never finishes, so the preview never starts over')
    assert.ok(looping.time > 9.9, `${looping.time}`)
    assert.equal(looping.holds[0].holding, true, 'the finished role keeps holding its last pose')
    assert.equal(looping.holds[1].stopping, false)
    const once = playDuo(false, 5)
    assert.equal(once.restarts.length, 1, `${once.restarts}`)
    assert.ok(once.restarts[0] >= 3 + ROLE_FADE_SECONDS && once.restarts[0] < 3 + ROLE_FADE_SECONDS + 0.2, `restarted at ${once.restarts[0]}`)
})
