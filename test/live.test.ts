import assert from 'node:assert/strict'
import test from 'node:test'
import { EVENT_JUMP, IDENTITY } from '../src/engine'
import { boneTargets, invert, mirrored, multiply } from '../src/cosmetic/livePose'
import { Mover, withMoves } from '../src/cosmetic/moves'
import { detachRig } from '../src/cosmetic/project'

function steps(mover: Mover, seconds: number) {
    let frame = mover.step(0)
    for (let t = 0; t < seconds; t += 1 / 60) frame = mover.step(1 / 60)
    return frame
}

function near(a: ArrayLike<number>, b: ArrayLike<number>) {
    for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-6, `${i}: ${a[i]} vs ${b[i]}`)
}

function apply(m: ArrayLike<number>, p: number[]): number[] {
    return [0, 1, 2].map((row) => m[row * 4] * p[0] + m[row * 4 + 1] * p[1] + m[row * 4 + 2] * p[2] + m[row * 4 + 3])
}

test('a jump leaves the ground, sends the jump event once and lands, and moves add to the chosen signals without undoing a chosen toggle', () => {
    const mover = new Mover()
    mover.start('jump')
    const first = mover.step(1 / 60)
    assert.equal(first.events, EVENT_JUMP)
    assert.equal(mover.step(1 / 60).events, 0)
    const air = steps(mover, 0.2)
    assert.equal(air.signals.is_on_ground, 0)
    assert.ok(air.root[7] > 0.5)
    const landed = steps(mover, 1)
    assert.equal(landed.signals.is_on_ground, 1)
    assert.equal(landed.root[7], 0)
    assert.equal(mover.busy(), false)
    assert.deepEqual(withMoves({ is_in_rain: 1, ground_speed: 2 }, { is_sprinting: 0, ground_speed: 0, is_on_ground: 1 }, false), { is_in_rain: 1, ground_speed: 2, is_sprinting: 0, is_on_ground: 1 })
    assert.deepEqual(withMoves({ is_on_ground: 1, is_sprinting: 1 }, { is_on_ground: 0, is_sprinting: 0, ground_speed: 5.6 }, true), { is_on_ground: 0, is_sprinting: 1, ground_speed: 5.6 })
})

test('engine poses mirror into Blockbench space and back', () => {
    const angle = 0.7
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const d = [c, 0, s, 3, 0, 1, 0, 2, -s, 0, c, -1]
    near(mirrored(mirrored(d)), d)
    const p = [1.5, -2, 4]
    const flip = (q: number[]) => [-q[0], q[1], q[2]]
    near(apply(mirrored(d), flip(p)), flip(apply(d, p)))
    near(multiply(invert(d), d), IDENTITY)
    near(multiply(d, invert(d)), IDENTITY)
})

test("detached rig parts pose the rig group they came from, and an author's own bone named like one keeps its own pose", () => {
    const cube = [{ origin: [0, 0, 0], size: [1, 1, 1] }]
    const wing = { bones: [{ name: 'body', pivot: [0, 24, 0], cubes: cube }, { name: 'wing', parent: 'body', pivot: [0, 24, 2], cubes: cube }] }
    detachRig(wing, new Set(['body']))
    assert.deepEqual(boneTargets({ 'minecraft:geometry': [wing] }, new Set(['body'])), ['body', 'wing'])
    assert.deepEqual(boneTargets(null, new Set()), [])
    const hair = { bones: [{ name: 'head', pivot: [0, 24, 0], cubes: cube }, { name: 'head_parts_hair', parent: 'head', pivot: [0, 24, 0], cubes: cube }, { name: 'head_parts', parent: 'head', pivot: [0, 24, 0], cubes: cube }] }
    detachRig(hair, new Set(['head']))
    assert.deepEqual(hair.bones.map((bone) => bone.name), ['head_parts_2', 'head_parts_hair', 'head_parts'])
    assert.deepEqual(boneTargets({ 'minecraft:geometry': [hair] }, new Set(['head'])), ['head', 'head_parts_hair', 'head_parts'])
})
