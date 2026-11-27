import assert from 'node:assert/strict'
import test from 'node:test'
import { CosmeticData, ReactionData } from '../src/cosmetic/data'
import { CosmeticDriver, engineSignals, IDENTITY } from '../src/engine'
import { cleanBuild, cosmetic, FEATHER, geometry, paintedTexture, sources, using } from './cosmeticKit'

const BONE = 12

function reaction(change: Partial<ReactionData>): ReactionData {
    return { signal: '', on: 'while', play: '', restart: false, blend: 0, speed: null, palette: '', effect: '', ...change }
}

function tail(change: (d: CosmeticData) => void = () => {}, driven = true) {
    const data = cosmetic('item', 'tail', (d) => {
        d.attach = { rig: 'player', bone: 'body', replaces: '' }
        d.palette = { slots: [{ id: 'fur', name: 'Fur', ramp: FEATHER, customizable: false }], colorways: {}, fixed: [] }
        d.controllers = driven ? ['controller.animation.tail.base'] : []
        change(d)
    })
    const built = cleanBuild(data, sources((s) => {
        s.geometry = geometry('tail', [
            { name: 'root', parent: 'body', pivot: [0, 12, 2], cubes: [{ origin: [-1, 10, 2], size: [2, 2, 2], uv: [0, 0] }] },
            { name: 'tip', parent: 'root', pivot: [0, 11, 4], cubes: [{ origin: [-1, 10, 4], size: [2, 2, 6], uv: [0, 0] }] },
        ])
        s.animations = {
            'animation.tail.sway': { loop: true, animation_length: 2, bones: { tip: { rotation: { '0.0': [0, 0, 0], '2.0': [0, 180, 0] } } } },
            'animation.tail.droop': { loop: true, animation_length: 1, bones: { root: { rotation: [40, 0, 0] } } },
        }
        if (driven) s.controllers = { 'controller.animation.tail.base': { initial_state: 'default', states: { default: { animations: ['sway'] } } } }
        s.textures = [paintedTexture(data, 'tail')]
    }))
    return CosmeticDriver.open(built.files, built.binary, engineSignals())!
}

function run(driver: CosmeticDriver, until: number, signals: (t: number) => Record<string, number> = () => ({}), variables?: Record<string, number>) {
    driver.play(0)
    let last = driver.frame(0, { signals: signals(0), variables, events: 0, root: [...IDENTITY] })
    for (let t = 1 / 60; t <= until + 1e-9; t += 1 / 60) last = driver.frame(t, { signals: signals(t), variables, events: 0, root: [...IDENTITY] })
    return last
}

function bone(frame: { bones: Float32Array }, index: number): number[] {
    return Array.from(frame.bones.slice(index * BONE, index * BONE + BONE))
}

function differs(a: number[], b: number[]): boolean {
    return a.some((value, i) => Math.abs(value - b[i]) > 1e-3)
}

test('a while speed reaction on a driven item loads clean and paces its controller clips', () => {
    using([tail(), tail((d) => {
        d.reactions = [reaction({ signal: 'is_sprinting', speed: 2 })]
    })], (base, fast) => {
        const plain = run(base, 0.5)
        const walking = run(fast, 0.5)
        fast.reset()
        const sprinting = run(fast, 0.5, () => ({ is_sprinting: 1 }))
        assert.equal(differs(bone(plain, 1), bone(walking, 1)), false, 'no sprint, same sway')
        assert.equal(differs(bone(plain, 1), bone(sprinting, 1)), true, 'speed paces the controller sway')
        assert.equal(differs(bone(run(base, 1), 1), bone(sprinting, 1)), false, 'twice the speed reaches the one second pose at half a second')
    })
})

test('a closed engine preview refuses new frames', () => {
    const driver = tail()
    driver.dispose()
    driver.dispose()
    assert.throws(() => driver.frame(0, { signals: {}, events: 0, root: IDENTITY }), /closed/)
})

test('the in combat toggle drives combat in the engine preview, and hurt alone does not', () => {
    using([tail((d) => {
        d.reactions = [reaction({ signal: 'is_in_combat', play: 'animation.tail.droop' })]
    }, false)], (driver) => {
        const pose = (signals: (t: number) => Record<string, number>) => {
            driver.reset()
            return bone(run(driver, 0.5, signals), 0)
        }
        const rest = pose(() => ({}))
        assert.ok(differs(pose(() => ({ is_in_combat: 1 })), rest), 'turning on In combat plays the combat reaction')
        assert.ok(!differs(pose(() => ({ is_hurt: 1 })), rest), 'getting hurt does not enter combat while In combat is off')
        assert.ok(!differs(pose((t) => ({ is_in_combat: t < 0.25 ? 1 : 0 })), rest), 'turning In combat off ends it straight away')
    })
})
