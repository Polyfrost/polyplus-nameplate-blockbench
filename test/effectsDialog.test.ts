import assert from 'node:assert/strict'
import test from 'node:test'
import { COSMETIC_FORMATS } from '../src/cosmetic/data'
import { openEffects } from '../src/cosmetic/effectsDialog'
import { COSMETIC_PROPERTY } from '../src/cosmetic/state'
import { toBase64 } from '../src/material/png'
import { particleStarter } from '../src/cosmetic/effects'
import { cosmetic } from './cosmeticKit'

const POP = toBase64(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1]))
const ZERO = toBase64(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 2]))
const NEW = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 3])

const GLOBALS = ['Format', 'Project', 'Undo', 'Dialog', 'Blockbench', 'Animator', 'AnimationController']

interface DialogOptions {
    scene?: Record<string, unknown>
    named?: Record<string, unknown[]>
    setup?: (d: any) => void
}

function withEffectsDialog(run: (dialog: { state: any, methods: any, confirm: () => unknown, messages: string[], edits: any[] }) => void, { scene = {}, named, setup = () => {} }: DialogOptions = {}) {
    const scope = globalThis as any
    let options: any = null
    const messages: string[] = []
    const edits: any[] = []
    Object.assign(scope, {
        Format: { id: COSMETIC_FORMATS.effect },
        Project: {
            [COSMETIC_PROPERTY]: cosmetic('effect', 'burst', (d) => {
                d.effects.audio = { pop: POP, 0: ZERO }
                d.effects.sounds = [
                    { id: 'pop', file: '', vanilla: '', volume: 1, pitch: 1 },
                    { id: '0', file: '', vanilla: '', volume: 1, pitch: 1 },
                ]
                if (named) d.effects.named = named
                setup(d)
            }),
        },
        Undo: { initEdit: (aspects: unknown) => (edits.push(aspects), {}), finishEdit: () => {}, cancelEdit: () => {} },
        Dialog: class {
            constructor(given: any) {
                options = given
            }
            show() {}
        },
        Blockbench: {
            import: (_: unknown, done: (files: unknown[]) => void) => done([{ name: 'new.ogg', content: NEW.slice().buffer }]),
            showQuickMessage: (text: string) => messages.push(text),
        },
        ...scene,
    })
    try {
        assert.ok(openEffects())
        run({ state: options.component.data(), methods: options.component.methods, confirm: () => options.onConfirm(), messages, edits })
    } finally {
        for (const name of GLOBALS) delete scope[name]
    }
}

function savedAudio(): Record<string, string> {
    return { ...(globalThis as any).Project[COSMETIC_PROPERTY].effects.audio }
}

test('renamed, removed and newly loaded sounds keep exactly their own files', () => {
    withEffectsDialog(({ state, methods, confirm }) => {
        state.sounds[1].id = 'zero'
        methods.loadSound(state.sounds[0])
        state.sounds.splice(0, 1)
        methods.addSound()
        const added = state.sounds[state.sounds.length - 1]
        added.id = 'pop'
        methods.loadSound(added)
        methods.addSound()
        confirm()
        assert.deepEqual(savedAudio(), { zero: ZERO, pop: toBase64(NEW) })
    })
})

test('two sounds that clean up to the same name block confirm, so neither file is lost', () => {
    withEffectsDialog(({ state, methods, confirm, messages }) => {
        methods.addSound()
        const added = state.sounds[state.sounds.length - 1]
        added.id = 'POP'
        methods.loadSound(added)
        state.tab = 'particles'
        assert.equal(confirm(), false)
        assert.equal(state.tab, 'sounds')
        assert.deepEqual(messages, ["Two sounds are both named 'pop'. Rename one of them."])
        assert.deepEqual(savedAudio(), { pop: POP, 0: ZERO })
        added.id = 'pop_loud'
        confirm()
        assert.deepEqual(savedAudio(), { pop: POP, 0: ZERO, pop_loud: toBase64(NEW) })
    })
})

test('two particles or two effects that clean up to the same name block confirm', () => {
    withEffectsDialog(({ state, methods, confirm, messages }) => {
        methods.addParticle()
        methods.addParticle()
        state.particles[0].id = 'Spark'
        state.particles[1].id = 'spark'
        assert.equal(confirm(), false)
        assert.equal(state.tab, 'particles')
        assert.deepEqual(messages, ["Two particles are both named 'spark'. Rename one of them."])
        assert.deepEqual((globalThis as any).Project[COSMETIC_PROPERTY].effects.particles, [])
        state.particles[1].id = 'spark_2'
        methods.addNamed()
        methods.addNamed()
        state.named[0].name = 'Burst'
        state.named[1].name = 'burst'
        assert.equal(confirm(), false)
        assert.equal(state.tab, 'named')
        assert.equal(messages[1], "Two effects are both named 'burst'. Rename one of them.")
        assert.deepEqual((globalThis as any).Project[COSMETIC_PROPERTY].effects.named, {})
        state.named[1].name = 'burst_big'
        confirm()
        const saved = (globalThis as any).Project[COSMETIC_PROPERTY].effects
        assert.deepEqual(saved.particles.map((particle: { id: string }) => particle.id), ['spark', 'spark_2'])
        assert.deepEqual(Object.keys(saved.named), ['burst', 'burst_big'])
    })
})

function keyframe(effect: string) {
    return { data_points: [{ effect, locator: '' }] }
}

test('renaming an effect or a sound moves the keyframes and controller states that use it, in the same undo step', () => {
    const pop = { name: 'animation.burst.pop', animators: { effects: { particle: [keyframe('burst'), keyframe('other')], sound: [keyframe('pop'), keyframe('burst'), keyframe('0')] } } }
    const still = { name: 'animation.burst.still', animators: { effects: { particle: [keyframe('other')], sound: [] } } }
    const controller = { name: 'controller.animation.burst', states: [{ particles: [{ effect: 'burst', locator: '' }], sounds: [{ effect: 'pop' }] }] }
    const idle = { name: 'controller.animation.idle', states: [{ particles: [], sounds: [{ effect: '0' }] }] }
    withEffectsDialog(({ state, confirm, edits }) => {
        state.named[0].name = 'Big Burst'
        state.sounds[0].id = 'boom'
        confirm()
        assert.deepEqual(pop.animators.effects.particle.map((k) => k.data_points[0].effect), ['big_burst', 'other'])
        assert.deepEqual(pop.animators.effects.sound.map((k) => k.data_points[0].effect), ['boom', 'big_burst', '0'])
        assert.deepEqual(controller.states[0].particles.map((p) => p.effect), ['big_burst'])
        assert.deepEqual(controller.states[0].sounds.map((s) => s.effect), ['boom'])
        assert.equal(idle.states[0].sounds[0].effect, '0')
        assert.equal(still.animators.effects.particle[0].data_points[0].effect, 'other')
        assert.equal(edits.length, 1)
        assert.deepEqual(edits[0].animations, [pop])
        assert.deepEqual(edits[0].animation_controllers, [controller])
        assert.ok(edits[0].polyplus_cosmetic)
    }, { scene: { Animator: { animations: [pop, still] }, AnimationController: { all: [controller, idle] } }, named: { burst: [] } })
})

test('a sound and an effect sharing a name block confirm when a sound keyframe would switch to the other one', () => {
    const pop = { name: 'animation.burst.pop', animators: { effects: { particle: [], sound: [keyframe('burst')] } } }
    const scene = { Animator: { animations: [pop] }, AnimationController: { all: [] } }
    withEffectsDialog(({ state, methods, confirm, messages, edits }) => {
        methods.addSound.call(state)
        state.sounds[2].id = 'burst'
        assert.equal(confirm(), false)
        assert.equal(state.tab, 'sounds')
        assert.match(messages[0], /A sound and an effect are both named 'burst'/)
        assert.equal(edits.length, 0)
    }, { scene, named: { burst: [] } })
    withEffectsDialog(({ state, confirm, messages }) => {
        state.named[0].name = 'pop'
        assert.equal(confirm(), false)
        assert.match(messages[0], /both named 'pop'/)
    }, { scene, named: { burst: [] } })
    withEffectsDialog(({ state, confirm, messages, edits }) => {
        state.sounds[0].volume = 0.5
        assert.notEqual(confirm(), false)
        assert.deepEqual(messages, [])
        assert.equal(edits.length, 1)
    }, { scene, named: { pop: [] } })
})

test('deleting a sound that shares its name with an effect blocks confirm instead of retargeting its keyframes', () => {
    const pop = { name: 'animation.burst.pop', animators: { effects: { particle: [], sound: [keyframe('pop')] } } }
    withEffectsDialog(({ state, confirm, messages, edits }) => {
        state.sounds.splice(0, 1)
        assert.equal(confirm(), false)
        assert.equal(state.tab, 'sounds')
        assert.deepEqual(messages, ["Sound keyframes that play 'pop' would switch to a different sound or effect. Rename it, or keep the one they play now."])
        assert.equal(edits.length, 0)
        state.named[0].name = 'pop_burst'
        assert.equal(confirm(), false)
        assert.equal(messages[1], "Sound keyframes still play 'pop'. Point them at another sound or remove them before you delete it.")
        assert.equal(edits.length, 0)
        pop.animators.effects.sound[0].data_points[0].effect = '0'
        assert.notEqual(confirm(), false)
        assert.equal(pop.animators.effects.sound[0].data_points[0].effect, '0')
        assert.deepEqual(Object.keys((globalThis as any).Project[COSMETIC_PROPERTY].effects.named), ['pop_burst'])
    }, { scene: { Animator: { animations: [pop] }, AnimationController: { all: [] } }, named: { pop: [] } })
})

test('a row that picks a new sound or particle with the old name of a renamed one keeps the new pick', () => {
    withEffectsDialog(({ state, methods, confirm }) => {
        state.sounds[0].id = 'boom'
        methods.addSound()
        const pop = state.sounds[state.sounds.length - 1]
        pop.id = 'pop'
        state.particles[0].id = 'flash'
        methods.addParticle()
        const spark = state.particles[state.particles.length - 1]
        spark.id = 'spark'
        methods.addRow(state.always)
        const soundRow = state.always[state.always.length - 1]
        soundRow.kind = 'sound'
        soundRow.soundKey = pop.key
        methods.addRow(state.always)
        const particleRow = state.always[state.always.length - 1]
        particleRow.particleKey = spark.key
        confirm()
        const saved = (globalThis as any).Project[COSMETIC_PROPERTY].effects
        assert.deepEqual(saved.emitters.map((emitter: { particle: string, sound: string }) => [emitter.particle, emitter.sound]), [
            ['', 'boom'],
            ['flash', ''],
            ['', 'pop'],
            ['spark', ''],
        ])
    }, { setup: (d) => {
        d.effects.particles = [particleStarter('spark')]
        d.effects.emitters = [
            { particle: '', sound: 'pop', vanilla: '', locator: '', count: 1 },
            { particle: 'spark', sound: '', vanilla: '', locator: '', count: 1 },
        ]
    } })
})

test('a row whose particles or sound were deleted blocks confirm, even if a new one takes the old name', () => {
    withEffectsDialog(({ state, methods, confirm, messages, edits }) => {
        state.particles.splice(0, 1)
        methods.addParticle()
        state.particles[state.particles.length - 1].id = 'spark'
        assert.equal(confirm(), false)
        assert.equal(state.tab, 'always')
        assert.deepEqual(messages, ['An always-on row uses particles that were deleted. Pick another one, or remove that row.'])
        assert.equal(edits.length, 0)
        state.always[0].particleKey = state.particles[state.particles.length - 1].key
        assert.notEqual(confirm(), false)
        assert.equal((globalThis as any).Project[COSMETIC_PROPERTY].effects.emitters[0].particle, 'spark')
    }, { setup: (d) => {
        d.effects.particles = [particleStarter('spark')]
        d.effects.emitters = [{ particle: 'spark', sound: '', vanilla: '', locator: '', count: 1 }]
    } })
    withEffectsDialog(({ state, methods, confirm, messages }) => {
        state.sounds.splice(0, 1)
        methods.addSound()
        state.sounds[state.sounds.length - 1].id = 'pop'
        assert.equal(confirm(), false)
        assert.equal(state.tab, 'named')
        assert.deepEqual(messages, ["Effect 'burst' uses a sound that was deleted. Pick another one, or remove that row."])
    }, { named: { burst: [{ particle: '', sound: 'pop', vanilla: '', locator: '', count: 1 }] } })
})

test('particle keyframes that play a deleted effect block confirm when a new effect takes its name', () => {
    const burst = { name: 'animation.burst.go', animators: { effects: { particle: [keyframe('burst')], sound: [] } } }
    const scene = { Animator: { animations: [burst] }, AnimationController: { all: [] } }
    withEffectsDialog(({ state, methods, confirm, messages, edits }) => {
        state.named.splice(0, 1)
        methods.addNamed('burst')
        assert.equal(confirm(), false)
        assert.equal(state.tab, 'named')
        assert.deepEqual(messages, ["Particle keyframes that play 'burst' would switch to a different effect. Rename it, or keep the one they play now."])
        assert.equal(edits.length, 0)
    }, { scene, named: { burst: [] } })
    withEffectsDialog(({ state, confirm }) => {
        state.named[0].name = 'boom'
        assert.notEqual(confirm(), false)
        assert.equal(burst.animators.effects.particle[0].data_points[0].effect, 'boom')
    }, { scene, named: { burst: [] } })
})

test('an effect or sound that keyframes still play cannot be deleted, so a later one with its name never takes them over', () => {
    const go = { name: 'animation.burst.go', animators: { effects: { particle: [keyframe('burst')], sound: [keyframe('pop'), keyframe('ring')] } } }
    const controller = { name: 'controller.animation.burst', states: [{ particles: [], sounds: [{ effect: 'ring' }] }] }
    const scene = { Animator: { animations: [go] }, AnimationController: { all: [controller] } }
    withEffectsDialog(({ state, confirm, messages, edits }) => {
        state.named.splice(0, 1)
        state.tab = 'particles'
        assert.equal(confirm(), false)
        assert.equal(state.tab, 'named')
        assert.deepEqual(messages, ["Particle keyframes still play 'burst'. Point them at another effect or remove them before you delete it."])
        assert.equal(edits.length, 0)
        go.animators.effects.particle = []
        assert.notEqual(confirm(), false)
        assert.deepEqual(Object.keys((globalThis as any).Project[COSMETIC_PROPERTY].effects.named), ['ring'])
    }, { scene, named: { burst: [], ring: [] } })
    withEffectsDialog(({ state, confirm, messages, edits }) => {
        state.sounds.splice(0, 1)
        assert.equal(confirm(), false)
        assert.equal(state.tab, 'sounds')
        assert.deepEqual(messages, ["Sound keyframes still play 'pop'. Point them at another sound or remove them before you delete it."])
        state.sounds.splice(0, 0, { id: 'pop', file: '', vanilla: '', volume: 1, pitch: 1, key: 99, from: null, loaded: false })
        assert.equal(confirm(), false)
        assert.match(messages[1], /Sound keyframes that play 'pop' would switch/)
        assert.equal(edits.length, 0)
    }, { scene, named: { ring: [] } })
    withEffectsDialog(({ state, confirm, messages }) => {
        state.named.splice(0, 1)
        assert.equal(confirm(), false)
        assert.equal(state.tab, 'named')
        assert.deepEqual(messages, ["Sound keyframes still play 'ring'. Point them at another effect or remove them before you delete it."])
    }, { scene: { Animator: { animations: [] }, AnimationController: { all: [controller] } }, named: { ring: [] } })
})

