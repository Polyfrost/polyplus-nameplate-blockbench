import assert from 'node:assert/strict'
import test from 'node:test'
import { manifestOf } from '../src/cosmetic/bundle'
import { hasErrors } from '../src/cosmetic/build'
import { openColors } from '../src/cosmetic/colors'
import { CosmeticData, COSMETIC_FORMATS, normalizeCosmetic } from '../src/cosmetic/data'
import { controllerEntries, controllerPicks, pickedControllers, savedReaction, shownReaction } from '../src/cosmetic/dialogs'
import { openEffects } from '../src/cosmetic/effectsDialog'
import { fallbackOptions } from '../src/cosmetic/emote'
import { liveness, pickOf, ReferenceTargets, referenceIssues, resolveReferences, savedPick, shownPick, stampReferences } from '../src/cosmetic/references'
import { roleOf, savedRow, shownRow } from '../src/cosmetic/roles'
import { cosmeticIssueText } from '../src/cosmetic/where'
import { COSMETIC_PROPERTY, cosmeticState, readCosmetic, seedReferences } from '../src/cosmetic/state'
import { cosmetic, sources } from './cosmeticKit'

const GLOBALS = ['Format', 'Project', 'Animator', 'AnimationController', 'Undo', 'Dialog', 'Blockbench', 'Texture']

function reaction(play: string, extra: Partial<CosmeticData['reactions'][number]> = {}): CosmeticData['reactions'][number] {
    return { signal: 'is_hurt', on: 'start', play, restart: false, blend: 0, speed: null, palette: '', effect: '', ...extra }
}

function wave() {
    return cosmetic('emote', 'wave', (d) => {
        d.emote.roles = [
            { id: 'a', animation: 'animation.wave.a', offset: [0, 0, 0], yaw: 0 },
            { id: 'b', animation: 'animation.wave.b', offset: [0, 0, 1.5], yaw: 180 },
        ]
        d.emote.fallback = 'animation.wave.solo'
        d.reactions = [reaction('animation.wave.a')]
        d.controllers = ['controller.animation.wave']
    })
}

function targets(animations: Array<[string, string]>, controllers: Array<[string, string]> = []): ReferenceTargets {
    return { animations: animations.map(([uuid, name]) => ({ uuid, name })), controllers: controllers.map(([uuid, name]) => ({ uuid, name })) }
}

function reload(data: CosmeticData, now: ReferenceTargets | null): CosmeticData {
    return resolveReferences(normalizeCosmetic(JSON.parse(JSON.stringify(data)), data.kind), now)
}

function withProject(data: CosmeticData, animations: Array<{ uuid: string, name: string }>, run: () => void, extra: Record<string, unknown> = {}) {
    const scope = globalThis as any
    Object.assign(scope, {
        Format: { id: COSMETIC_FORMATS[data.kind] },
        Project: { [COSMETIC_PROPERTY]: data },
        Animator: { animations },
        AnimationController: { all: [] },
        ...extra,
    })
    try {
        run()
    } finally {
        for (const name of GLOBALS) delete scope[name]
    }
}

test('names picked in the plugin follow their animation or controller through a rename', () => {
    const before = targets([['u-a', 'animation.wave.a'], ['u-b', 'animation.wave.b'], ['u-solo', 'animation.wave.solo']], [['u-c', 'controller.animation.wave']])
    const stored = stampReferences(wave(), before)
    assert.deepEqual(stored.emote.roles.map((role) => role.ref), [{ id: 'u-a', name: 'animation.wave.a' }, { id: 'u-b', name: 'animation.wave.b' }])
    assert.deepEqual(stored.emote.fallbackRef, { id: 'u-solo', name: 'animation.wave.solo' })
    assert.deepEqual(stored.reactions[0].playRef, { id: 'u-a', name: 'animation.wave.a' })
    assert.deepEqual(stored.controllerRefs, [{ id: 'u-c', name: 'controller.animation.wave' }])
    const after = targets([['u-a', 'animation.wave.start'], ['u-b', 'animation.wave.b'], ['u-solo', 'animation.wave.alone']], [['u-c', 'controller.animation.waving']])
    const read = reload(stored, after)
    assert.deepEqual(read.emote.roles.map((role) => role.animation), ['animation.wave.start', 'animation.wave.b'])
    assert.equal(read.emote.fallback, 'animation.wave.alone')
    assert.equal(read.reactions[0].play, 'animation.wave.start')
    assert.deepEqual(read.controllers, ['controller.animation.waving'])
    const manifest = manifestOf(read, sources(() => {}), [])
    assert.equal(JSON.stringify(manifest).includes('u-a'), false)
    assert.deepEqual(manifest.controllers, ['controller.animation.waving'])
})

test('a pet role follows a renamed animation, and a deleted one keeps its last name', () => {
    const data = cosmetic('pet', 'pup', (d) => {
        d.pet.roles = [{ interaction: 'play', id: 'a', animation: 'animation.pup.play', offset: [0, 0, 0], yaw: 0 }, { interaction: 'play', id: 'b', animation: 'animation.pup.gone', offset: [0, 0, 0], yaw: 0 }]
    })
    stampReferences(data, targets([['u-play', 'animation.pup.play'], ['u-gone', 'animation.pup.gone']]))
    resolveReferences(data, targets([['u-play', 'animation.pup.romp']]))
    assert.deepEqual(data.pet.roles.map((role) => role.animation), ['animation.pup.romp', 'animation.pup.gone'])
    stampReferences(data, targets([]))
    assert.deepEqual(data.pet.roles.map((role) => role.ref?.id), ['u-play', 'u-gone'])
    data.pet.roles[1].animation = 'animation.pup.other'
    stampReferences(data, targets([['u-gone', 'animation.pup.gone']]))
    assert.equal(data.pet.roles[1].ref, undefined)
    data.pet.roles[0].animation = ''
    stampReferences(data, targets([]))
    assert.equal(data.pet.roles[0].ref, undefined)
})

test('a deleted animation stays tracked through edits and undo, so restoring and renaming it is followed', () => {
    const animations = [{ uuid: 'u-a', name: 'animation.wave.a' }, { uuid: 'u-b', name: 'animation.wave.b' }, { uuid: 'u-solo', name: 'animation.wave.solo' }]
    withProject(wave(), animations, () => {
        cosmeticState.write(readCosmetic())
        const [deleted] = animations.splice(0, 1)
        const state = readCosmetic()
        cosmeticState.write(state)
        const snapshot = JSON.parse(JSON.stringify(readCosmetic()))
        state.emote.roles[1].yaw = 90
        cosmeticState.write(state)
        ;(globalThis as any).Project[COSMETIC_PROPERTY] = snapshot
        cosmeticState.write(readCosmetic())
        animations.unshift(deleted)
        deleted.name = 'animation.wave.start'
        const read = readCosmetic()
        assert.equal(read.emote.roles[0].animation, 'animation.wave.start')
        assert.equal(read.reactions[0].play, 'animation.wave.start')
    })
})

test('resolving an already resolved snapshot keeps every role on its own animation', () => {
    const data = wave()
    stampReferences(data, targets([['u-a', 'animation.wave.a'], ['u-b', 'animation.wave.b']]))
    const renamed = targets([['u-a', 'animation.wave.c'], ['u-b', 'animation.wave.a']])
    const once = resolveReferences(data, renamed)
    assert.deepEqual(once.emote.roles.map((role) => role.animation), ['animation.wave.c', 'animation.wave.a'])
    const twice = reload(once, renamed)
    assert.deepEqual(twice.emote.roles.map((role) => role.animation), ['animation.wave.c', 'animation.wave.a'])
    assert.equal(twice.reactions[0].play, 'animation.wave.c')
})

test('a project saved without references gets them on load, so a first rename is followed', () => {
    const animations = [{ uuid: 'u-a', name: 'animation.wave.a' }, { uuid: 'u-b', name: 'animation.wave.b' }, { uuid: 'u-solo', name: 'animation.wave.solo' }]
    const controllers = [{ uuid: 'u-c', name: 'controller.animation.wave' }]
    withProject(JSON.parse(JSON.stringify(wave())), animations, () => {
        assert.equal(seedReferences(), true)
        assert.equal(seedReferences(), false)
        animations[0].name = 'animation.wave.start'
        controllers[0].name = 'controller.animation.waving'
        const read = readCosmetic()
        assert.equal(read.emote.roles[0].animation, 'animation.wave.start')
        assert.equal(read.reactions[0].play, 'animation.wave.start')
        assert.deepEqual(read.controllers, ['controller.animation.waving'])
    }, { AnimationController: { all: controllers } })
})

test('name keyed references from older projects move onto each use when the project loads', () => {
    const saved: any = JSON.parse(JSON.stringify(wave()))
    saved.reactions.push(reaction('animation.wave.a'))
    saved.refs = { animations: { 'animation.wave.a': 'u-a', 'animation.wave.b': 'u-b' }, controllers: { 'controller.animation.wave': 'u-c' } }
    const animations = [{ uuid: 'u-new', name: 'animation.wave.a' }, { uuid: 'u-b', name: 'animation.wave.b' }]
    withProject(saved, animations, () => {
        assert.equal(seedReferences(), true)
        const stored = (globalThis as any).Project[COSMETIC_PROPERTY]
        assert.equal('refs' in stored, false)
        assert.deepEqual(stored.reactions.map((item: any) => item.playRef), [{ id: 'u-a', name: 'animation.wave.a' }, { id: 'u-a', name: 'animation.wave.a' }])
        assert.deepEqual(stored.controllerRefs, [{ id: 'u-c', name: 'controller.animation.wave' }])
        assert.equal(seedReferences(), false)
    }, { AnimationController: { all: [] } })
})

test('repicking one use of a deleted animation leaves the other uses on the deleted one', () => {
    const data = wave()
    data.reactions.push(reaction('animation.wave.a'))
    stampReferences(data, targets([['u-a', 'animation.wave.a'], ['u-b', 'animation.wave.b']]))
    const taken = targets([['u-new', 'animation.wave.a'], ['u-b', 'animation.wave.b']])
    resolveReferences(data, taken)
    const live = liveness(data, taken)
    const row = shownReaction(data.reactions[0], live, 0)
    assert.equal(row.stale.play?.label, 'animation.wave.a (deleted)')
    row.play = 'animation.wave.a'
    data.reactions[0] = savedReaction(row)
    data.reactions[1] = savedReaction(shownReaction(data.reactions[1], live, 1))
    stampReferences(data, taken)
    assert.deepEqual(data.reactions.map((item) => item.playRef?.id), ['u-new', 'u-a'])
    assert.deepEqual(referenceIssues(data, taken).map((issue) => issue.path), ['manifest.json#roles.0', 'manifest.json#reactions.1'])
    const restored = targets([['u-a', 'animation.wave.start'], ...taken.animations.map((item): [string, string] => [item.uuid, item.name])])
    const back = reload(data, restored)
    assert.deepEqual(back.reactions.map((item) => item.play), ['animation.wave.a', 'animation.wave.start'])
    assert.equal(back.emote.roles[0].animation, 'animation.wave.start')
})

test('renaming another animation onto a deleted one keeps both uses on their own animation', () => {
    const data = wave()
    stampReferences(data, targets([['u-a', 'animation.wave.a'], ['u-b', 'animation.wave.b']]))
    const moved = targets([['u-b', 'animation.wave.a']])
    const read = reload(data, moved)
    assert.deepEqual(read.emote.roles.map((role) => [role.animation, role.ref?.id]), [['animation.wave.a', 'u-a'], ['animation.wave.a', 'u-b']])
    stampReferences(read, moved)
    assert.deepEqual(read.emote.roles.map((role) => role.ref?.id), ['u-a', 'u-b'])
    const back = reload(read, targets([['u-a', 'animation.wave.x'], ['u-b', 'animation.wave.a']]))
    assert.deepEqual(back.emote.roles.map((role) => role.animation), ['animation.wave.x', 'animation.wave.a'])
})

test('a pick of a deleted animation blocks export until it is picked again or removed', () => {
    const data = wave()
    stampReferences(data, targets([['u-a', 'animation.wave.a'], ['u-b', 'animation.wave.b'], ['u-solo', 'animation.wave.solo']]))
    const taken = targets([['u-new', 'animation.wave.a'], ['u-b', 'animation.wave.b']])
    resolveReferences(data, taken)
    const issues = referenceIssues(data, taken)
    assert.deepEqual(issues.map((issue) => [issue.path, issue.level]), [['manifest.json#roles.0', 'error'], ['manifest.json#fallback', 'error'], ['manifest.json#reactions.0', 'error']])
    assert.ok(hasErrors(issues))
    assert.equal(cosmeticIssueText(issues[0]), "Role 1 plays 'animation.wave.a', which was deleted. Another animation has that name now, so pick it again to use that one.")
    assert.equal(cosmeticIssueText(issues[1]), "The emote plays 'animation.wave.solo', which was deleted. To export, pick another animation or remove it.")
    const live = liveness(data, taken)
    const role = shownRow({ interaction: '', ...data.emote.roles[0] }, live)
    assert.equal(role.stale?.label, 'animation.wave.a (deleted)')
    assert.deepEqual(roleOf(savedRow(role)).ref, { id: 'u-a', name: 'animation.wave.a' })
    data.emote.roles[0] = roleOf(savedRow({ ...role, animation: 'animation.wave.a' }))
    const fallback = pickOf(live, 'animations', data.emote.fallback, data.emote.fallbackRef)
    assert.deepEqual(Object.values(fallbackOptions(fallback, ['animation.wave.a'])), ['Nothing, just a message', 'animation.wave.solo (deleted)', 'animation.wave.a'])
    assert.deepEqual(savedPick(shownPick(fallback), fallback), { name: 'animation.wave.solo', ref: { id: 'u-solo', name: 'animation.wave.solo' } })
    data.emote.fallback = savedPick('', fallback).name
    delete data.emote.fallbackRef
    data.reactions = []
    stampReferences(data, taken)
    assert.equal(data.emote.roles[0].ref?.id, 'u-new')
    assert.deepEqual(referenceIssues(data, taken), [])
})

test('a deleted controller shows apart from a new one with its name, and ticking the new one replaces it', () => {
    const data = wave()
    stampReferences(data, targets([], [['u-c', 'controller.animation.wave']]))
    const taken = targets([], [['u-new', 'controller.animation.wave'], ['u-y', 'controller.y']])
    resolveReferences(data, taken)
    const entries = controllerEntries(['controller.animation.wave', 'controller.y'], controllerPicks(data, liveness(data, taken)))
    assert.deepEqual(entries.map((entry) => [entry.name, entry.stale, entry.on]), [['controller.animation.wave', true, true], ['controller.animation.wave', false, false], ['controller.y', false, false]])
    assert.deepEqual(pickedControllers(entries, (i) => entries[i].on), { controllers: ['controller.animation.wave'], refs: [{ id: 'u-c', name: 'controller.animation.wave' }] })
    assert.deepEqual(pickedControllers(entries, (i) => i < 2), { controllers: ['controller.animation.wave'], refs: [null] })
    assert.deepEqual(referenceIssues(data, taken).map((issue) => cosmeticIssueText(issue)), ["Controllers run 'controller.animation.wave', which was deleted. Another controller has that name now, so tick it again to use that one."])
})

function withDialog(data: CosmeticData, open: () => boolean, run: (dialog: { state: any, methods: any, confirm: () => void }) => void) {
    let options: any = null
    withProject(data, [], () => {
        assert.ok(open())
        run({ state: options.component.data(), methods: options.component.methods, confirm: () => options.onConfirm() })
    }, {
        Undo: { initEdit: () => ({}), finishEdit: () => {}, cancelEdit: () => {} },
        Dialog: class {
            constructor(given: any) {
                options = given
            }
            show() {}
        },
        Texture: { all: [] },
        Blockbench: { showQuickMessage: () => {} },
    })
}

test('renaming a colorway carries its reactions along, and deleting one and renaming another onto its name keeps the reaction on the deleted one', () => {
    const renamed = cosmetic('item', 'hat', (d) => {
        d.palette.colorways = { red: {} }
        d.reactions = [reaction('', { palette: 'red' })]
    })
    withDialog(renamed, openColors, ({ state, confirm }) => {
        state.colorways[0].name = 'crimson'
        confirm()
        const read = readCosmetic()
        assert.equal(read.reactions[0].palette, 'crimson')
        assert.deepEqual(referenceIssues(read, null), [])
    })
    const data = cosmetic('item', 'hat', (d) => {
        d.palette.colorways = { red: {}, blue: {} }
        d.reactions = [reaction('', { palette: 'red' }), reaction('', { palette: 'blue' })]
    })
    withDialog(data, openColors, ({ state, confirm }) => {
        state.colorways.splice(0, 1)
        state.colorways[0].name = 'red'
        confirm()
        const read = readCosmetic()
        assert.deepEqual(Object.keys(read.palette.colorways), ['red'])
        assert.deepEqual(read.reactions.map((item) => item.palette), ['red', 'red'])
        const issues = referenceIssues(read, null)
        assert.deepEqual(issues.map((issue) => issue.path), ['manifest.json#reactions.0'])
        assert.equal(cosmeticIssueText(issues[0]), "Reaction 1 uses the colorway 'red', which was deleted. Another colorway has that name now, so pick it again to use that one.")
        const row = shownReaction(read.reactions[0], liveness(read, null), 0)
        assert.equal(row.stale.palette?.label, 'red (deleted)')
        assert.equal(savedReaction(row).paletteRef?.id, read.reactions[0].paletteRef?.id)
        row.palette = 'red'
        assert.deepEqual(referenceIssues(stampReferences({ ...read, reactions: [savedReaction(row), read.reactions[1]] }, null), null), [])
    })
})

test('deleting an effect and adding another with its name does not move the reaction onto the new one', () => {
    const data = cosmetic('item', 'hat', (d) => {
        d.effects.named = { burst: [], glow: [] }
        d.reactions = [reaction('', { effect: 'burst' }), reaction('', { effect: 'glow' })]
    })
    withDialog(data, openEffects, ({ state, methods, confirm }) => {
        state.named.splice(0, 1)
        methods.addNamed('burst')
        state.named[0].name = 'shine'
        confirm()
        const read = readCosmetic()
        assert.deepEqual(read.reactions.map((item) => item.effect), ['burst', 'shine'])
        assert.deepEqual(referenceIssues(read, null).map((issue) => cosmeticIssueText(issue)), ["Reaction 1 plays the effect 'burst', which was deleted. Another effect has that name now, so pick it again to use that one."])
    })
})
