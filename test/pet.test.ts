import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyIssue } from '../src/checks/codes'
import { plainMessage } from '../src/checks/words'
import { buildBundle } from '../src/cosmetic/bundle'
import { buildCosmetic } from '../src/cosmetic/build'
import { HOST_VARIABLES } from '../src/cosmetic/autocomplete'
import { MAX_PET_ROLES, normalizeCosmetic, PetData } from '../src/cosmetic/data'
import { planCosmeticImport } from '../src/cosmetic/import'
import { PET_ACTIONS, PET_VARIABLES, petAnimationHints, petAnimationText, petRoleVariables, petScaleRange, registerPet } from '../src/cosmetic/pet'
import { genericPetMotion, genericPetSpot, INTERACTION_SECONDS, isGenericMove, NO_ROLE, petInteractions, petPairSeats, petPairSignals, petPreviewInteractions, petRoleClips, petSeats, petSessionSeconds, startDelays, supportsGeneric } from '../src/cosmetic/duo'
import { multiply } from '../src/cosmetic/livePose'
import { HOST_CONTROLS, PANEL_BUTTONS, SETTINGS_SECTIONS } from '../src/cosmetic/registry'
import { petRoots } from '../src/cosmetic/petPreview'
import { nextPetRole } from '../src/cosmetic/roles'
import { applySprings, SPRING_PRESETS } from '../src/cosmetic/springs'
import { cosmeticIssueText } from '../src/cosmetic/where'
import { cosmeticLimits, issueMessage, loadCosmetic } from '../src/engine'
import { cosmeticEngineNow } from '../src/engine/cosmetic'
import { animation, bone, cosmetic, FEATHER, geometry, paintedTexture, roundTrip, sources, withActions } from './cosmeticKit'

function pup(change: Parameters<typeof cosmetic>[2] = () => {}) {
    const data = cosmetic('pet', 'pup', (d) => {
        d.pet = { archetype: 'flying', leashRadius: 4, scale: 0.75, anchor: '', interactions: { greet: ['a', 'b'], play: ['b'] } }
        d.palette = { slots: [{ id: 'fur', name: 'Fur', ramp: FEATHER, customizable: false }], colorways: {}, fixed: [] }
        change(d)
    })
    const geo = geometry('pup', [bone('root', null), bone('ear', 'root')])
    applySprings(geo, { ear: SPRING_PRESETS.ear })
    const input = sources((s) => {
        s.geometry = geo
        s.animations = { 'animation.pup.idle': animation(['root']), 'animation.pup.move': animation(['root']) }
        s.textures = [paintedTexture(data, 'pup')]
    })
    return { data, input }
}

function exported(change: Parameters<typeof cosmetic>[2] = () => {}) {
    const { data, input } = pup(change)
    const built = roundTrip(data, input)
    return { built, manifest: JSON.parse(built.files['manifest.json']) }
}

function petSettings(data: ReturnType<typeof pup>['data']) {
    return SETTINGS_SECTIONS.map((make) => make(data)).find((made) => 'archetype' in made.form)!
}

test('pet settings export in the engine shape, leave defaults out and read back the same', () => {
    const flying = exported()
    assert.equal(flying.manifest.kind, 'pet')
    assert.deepEqual([flying.manifest.archetype, flying.manifest.leashRadius, flying.manifest.scale, flying.manifest.attach, flying.manifest.roles], ['flying', 4, 0.75, undefined, undefined])
    assert.deepEqual(flying.manifest.interactions, { greet: ['a', 'b'], play: ['b'] })
    assert.ok(flying.built.requires.includes('pets') && !flying.built.requires.includes('roles'), flying.built.requires.join())
    const meta = flying.built.load!.meta!
    assert.deepEqual([meta.attach.rig, meta.pet?.archetype, meta.controllers], ['actor', 'flying', ['controller.animation.pet.flying']])
    const shoulder = exported((d) => {
        d.pet = { archetype: 'shoulder', leashRadius: 3, scale: 1, anchor: 'leftArm', interactions: {} }
        d.reactions = [{ signal: 'is_sprinting', on: 'while', play: '', restart: false, blend: 0, speed: 1.5, palette: '', effect: '' }]
    })
    assert.deepEqual([shoulder.manifest.anchor, shoulder.manifest.leashRadius, shoulder.manifest.scale, 'interactions' in shoulder.manifest], ['leftArm', undefined, undefined, false])
    assert.equal(shoulder.built.load!.meta!.pet?.anchor, 'leftArm')
    assert.deepEqual(shoulder.manifest.reactions, [{ signal: 'is_sprinting', on: 'while', speed: 1.5 }], 'a pet keeps the speed of a while reaction')
    const off = exported((d) => {
        d.pet.interactions = { greet: [], play: ['b'], chase: ['a', 'b'] }
    })
    assert.deepEqual(off.manifest.interactions, { greet: [], play: ['b'], chase: ['a', 'b'] }, 'Off exports as an empty list and Default is left out')
})

test('reading a bundle maps an empty list to Off and a missing interaction to Default, and an unknown role is still flagged', () => {
    assert.deepEqual(normalizeCosmetic({ kind: 'pet', pet: { interactions: { greet: [], nap: ['b', 'a', 'b'], play: ['x'], follow: 'a' } } }, 'pet').pet.interactions, { greet: [], nap: ['a', 'b'] })
    assert.deepEqual(Object.keys(normalizeCosmetic({ kind: 'pet', pet: { interactions: { chase: ['a'], greet: ['a'] } } }, 'pet').pet.interactions), ['greet', 'chase'])
    const { data, input } = pup()
    const bundle = buildBundle(data, input, ['pets', 'controllers', 'palettes', 'springs'])
    const load = (interactions: Record<string, string[]>) => {
        const manifest = JSON.parse(bundle.files['manifest.json'])
        manifest.interactions = interactions
        return loadCosmetic({ ...bundle.files, 'manifest.json': JSON.stringify(manifest) }, bundle.binary)!
    }
    const off = load({ greet: [] })
    assert.deepEqual([off.issues, off.status], [[], 'asset'])
    const unknown = load({ greet: [], play: ['x'] })
    const flagged = unknown.issues.filter((issue) => issue.code === 'pet_invalid')
    assert.ok(!flagged.some((issue) => issue.path.endsWith('interactions.greet')), JSON.stringify(flagged))
    assert.ok(flagged.some((issue) => issue.path.startsWith('manifest.json#interactions.play')), JSON.stringify(flagged))
    assert.equal(unknown.status, 'draft')
})

test('pet mistakes read as sentences, and the plain owner signal gets a warning', () => {
    const { data, input } = pup()
    input.animations['animation.pup.idle'] = animation(['root'], 1, { bones: { root: { rotation: ['query.is_hurt * 10', 0, 0] } } })
    const warning = buildCosmetic(data, input).issues.find((issue) => issue.code === 'pet_plain_query')
    assert.equal(warning?.level, 'warning')
    assert.match(plainMessage(issueMessage('pet_plain_query', warning!.values ?? {}, warning!.names ?? {})), /query\.owner\.is_hurt/)
    const bundle = buildBundle(data, input, ['pets', 'controllers', 'palettes', 'springs'])
    const manifest = { ...JSON.parse(bundle.files['manifest.json']), archetype: 'swimming', scale: -1, interactions: { dance: ['a'] } }
    const load = loadCosmetic({ ...bundle.files, 'manifest.json': JSON.stringify(manifest) }, bundle.binary)!
    const codes = load.issues.map((issue) => classifyIssue(issue).code)
    for (const code of ['pet_archetype_unknown', 'pet_field_range', 'pet_interaction_unknown']) assert.ok(codes.includes(code as any), `${code} in ${codes.join()}`)
    for (const issue of load.issues) assert.notEqual(plainMessage(issueMessage(issue.code ?? '', issue.values ?? {}, issue.names ?? {}, issue.path)), plainMessage(''), `${issue.code}`)
})

test('pet preview controls cover every pet mode, idle action and head look', () => {
    const unregister = withActions(registerPet)
    try {
        const controls = Object.fromEntries(HOST_CONTROLS.filter((control) => control.kinds.includes('pet')).map((control) => [control.name, control]))
        assert.deepEqual(controls.pet_mode.options!.slice(6).map((option) => [option.value, option.label]), [[6, 'Wandering'], [7, 'Playing'], [8, 'Doing an idle action']])
        assert.deepEqual(controls.pet_action.options!.map((option) => [option.value, option.label]), PET_ACTIONS.map((label, value) => [value, label]))
        for (const name of ['pet_look_yaw', 'pet_look_pitch']) assert.deepEqual([controls[name].min, controls[name].max], [-90, 90], name)
        for (const name of PET_VARIABLES) assert.ok(HOST_VARIABLES.pet.includes(name) && controls[name], name)
        assert.deepEqual(controls.pet_interaction.options!.map((option) => option.label), ['Nothing', 'Greets', 'Follows', 'Naps', 'Plays', 'Chases'])
        assert.deepEqual(controls.pet_role.options!.map((option) => option.label), ['Starts it', 'Joins in'])
        assert.deepEqual([controls.pet_mood.min, controls.pet_mood.max, controls.pet_interaction_time.min], [-1, 1, -1])
    } finally {
        unregister()
    }
    assert.equal(HOST_CONTROLS.length, 0)
    assert.equal(HOST_VARIABLES.pet, undefined)
})

test('pet settings point out the animations the default controller looks for', () => {
    const names = ['animation.pup.idle', 'animation.pup.move', 'animation.pup.sit', 'sleep', 'animation.pup.idle_look', 'animation.pup.idle_tail', 'animation.pup.sitting']
    assert.deepEqual(petAnimationHints(names), { found: ['sit', 'sleep', 'idle_look', 'idle_tail'], missing: ['lie', 'groom', 'yawn', 'sniff', 'celebrate'] })
    assert.deepEqual(petAnimationHints(['animation.pup.idle_']).missing.at(-1), 'idle_*')
    const text = petAnimationText(names)
    assert.match(text, /sit, lie, groom, yawn, sniff, sleep, celebrate, and any idle_ animation/)
    assert.match(text, /Added: sit, sleep, idle_look, idle_tail\./)
    assert.match(text, /Not added yet: lie, groom, yawn, sniff, celebrate\.$/)
    assert.match(petAnimationText([]), /Not added yet: .*celebrate, an idle_ animation\.$/)
})

const PLAY_ROLES = [
    { interaction: 'play', id: 'a', animation: 'animation.pup.play_a', offset: [0, 0, -0.75] as [number, number, number], yaw: 0 },
    { interaction: 'play', id: 'b', animation: 'animation.pup.play_b', offset: [0, 0, 0.75] as [number, number, number], yaw: 180 },
]

function player(change: Parameters<typeof cosmetic>[2] = () => {}) {
    const made = pup((d) => {
        d.pet.interactions = { play: ['a', 'b'] }
        d.pet.roles = PLAY_ROLES.map((role) => ({ ...role, offset: [...role.offset] as [number, number, number] }))
        change(d)
    })
    made.input.animations['animation.pup.play_a'] = animation(['root'])
    made.input.animations['animation.pup.play_b'] = animation(['ear'])
    return made
}

test('pet roles export in the engine shape, load and read back the same', () => {
    const { data, input } = player()
    const built = roundTrip(data, input)
    const manifest = JSON.parse(built.files['manifest.json'])
    assert.deepEqual(manifest.roles, [
        { interaction: 'play', id: 'a', animation: 'animation.pup.play_a', offset: [0, 0, -0.75] },
        { interaction: 'play', id: 'b', animation: 'animation.pup.play_b', offset: [0, 0, 0.75], yaw: 180 },
    ])
    assert.ok(built.requires.includes('roles'), built.requires.join())
    assert.deepEqual(
        built.load!.meta!.roles.map((role) => [role.interaction, role.id, role.animation, role.offset, role.yaw]),
        [['play', 'a', 'animation.pup.play_a', [0, 0, -0.75], 0], ['play', 'b', 'animation.pup.play_b', [0, 0, 0.75], 180]],
    )
    assert.deepEqual(planCosmeticImport(built).read.data, data)
})

test('pet role mistakes show up in Checks as sentences', () => {
    const cases: Array<[string, (d: ReturnType<typeof player>['data']) => void, RegExp]> = [
        ['role_invalid', (d) => { d.pet.interactions = { play: ['a'] } }, /^Role 2 is 'Joins in' for Plays, which the pet doesn't do\. Turn it on in Settings/],
        ['role_invalid', (d) => { d.pet.roles[1].interaction = 'dance' }, /^Role 2 plays 'dance' with other pets, which the game doesn't know/],
        ['role_duplicate', (d) => { d.pet.roles[1].id = 'a' }, /^Role 2 is 'Starts it' for Plays more than once\. Keep one\.$/],
        ['role_animation_missing', (d) => { d.pet.roles[0].animation = 'animation.pup.wiggle' }, /^Role 1 plays 'animation\.pup\.wiggle', which isn't an animation in this project/],
        ['roles_too_many', (d) => { d.pet.roles = Array.from({ length: MAX_PET_ROLES + 1 }, () => ({ ...PLAY_ROLES[0] })) }, /^Roles has too many roles\. A pet takes each role once per way it plays/],
    ]
    for (const [code, change, words] of cases) {
        const { data, input } = player(change)
        const issue = buildCosmetic(data, input).issues.find((found) => found.code === code)
        assert.equal(issue?.level, 'error', code)
        assert.match(cosmeticIssueText(issue!), words)
    }
})

test('a new pet role takes the next turned-on part and its matching animation', () => {
    const { data } = player((d) => {
        d.pet.interactions = { greet: ['b'], play: ['a', 'b'] }
    })
    const names = ['animation.pup.idle', 'animation.pup.greet', 'animation.pup.play_a', 'animation.pup.play_b']
    const greetB = { interaction: 'greet', id: 'b', animation: 'animation.pup.greet', offset: [0, 0, 0.75], yaw: 180 }
    assert.deepEqual(nextPetRole([], data.pet, names), greetB)
    const taken = data.pet.roles.map((role) => ({ ...role }))
    assert.deepEqual(nextPetRole(taken, data.pet, names), greetB)
    const all = taken.concat([{ interaction: 'greet', id: 'b', animation: '', offset: [0, 0, 0], yaw: 0 }])
    assert.deepEqual(nextPetRole(all, data.pet, names), { interaction: 'greet', id: 'a', animation: 'animation.pup.greet', offset: [0, 0, -0.75], yaw: 0 })
    assert.deepEqual(nextPetRole([], { ...data.pet, interactions: { play: ['b'] } }, names), { interaction: 'play', id: 'b', animation: 'animation.pup.play_b', offset: [0, 0, 0.75], yaw: 180 })
    const full = ['greet', 'follow', 'nap', 'play', 'chase'].flatMap((interaction) => ['a', 'b'].map((id) => ({ interaction, id, animation: '', offset: [0, 0, 0] as [number, number, number], yaw: 0 })))
    assert.equal(nextPetRole(full, data.pet, names), null)
})

test('pet settings offer Default, Off and the roles for each interaction, keep the roles on save and show Roles for pets only', () => {
    const unregister = withActions(registerPet)
    try {
        assert.deepEqual(PANEL_BUTTONS.find((entry) => entry.label === 'Roles' && entry.kinds?.includes('pet'))?.kinds, ['pet'])
        const { data } = player((d) => {
            d.pet.interactions = { greet: ['a', 'b'], nap: [], play: ['b'] }
        })
        const section = petSettings(data)
        const field = (id: string) => section.form[`interaction_${id}`] as { options: Record<string, string>, value: string }
        assert.deepEqual(field('greet').options, { '': 'Default', off: 'Off', a: 'Starts it', b: 'Joins in', ab: 'Both' })
        assert.deepEqual(['greet', 'follow', 'nap', 'play', 'chase'].map((id) => field(id).value), ['ab', '', 'off', 'b', ''])
        const next = normalizeCosmetic(data, 'pet')
        section.save({ archetype: 'walking', leashRadius: 2, scale: 1, anchor: '', interaction_greet: 'off', interaction_follow: 'a', interaction_nap: '', interaction_play: 'ab', interaction_chase: 'off' }, next)
        assert.equal(next.pet.archetype, 'walking')
        assert.deepEqual(next.pet.interactions, { greet: [], follow: ['a'], play: ['a', 'b'], chase: [] })
        assert.deepEqual(next.pet.roles, data.pet.roles)
    } finally {
        unregister()
    }
    assert.ok(!PANEL_BUTTONS.some((entry) => entry.kinds?.includes('pet')))
})

test('pets in an interaction take their own seats, roles and host variables', () => {
    const roles = [
        { interaction: 'play', id: 'b', animation: 'animation.pup.play_b', offset: [0, 0, 0.75] as [number, number, number], yaw: 180 },
        { interaction: 'greet', id: 'a', animation: 'animation.pup.idle', offset: [0, 0, 0] as [number, number, number], yaw: 0 },
        { interaction: 'play', id: 'a', animation: 'animation.pup.play_a', offset: [0, 0, -0.75] as [number, number, number], yaw: 0 },
    ]
    assert.deepEqual(petInteractions(roles), ['greet', 'play'])
    assert.deepEqual(petSeats(roles, 'play').map((seat) => [seat.seat, seat.role, seat.spot.z, seat.spot.yaw]), [[0, 2, -0.75, 0], [1, 0, 0.75, -180]])
    assert.deepEqual(petSeats(roles, 'greet').map((seat) => seat.role), [1])
    assert.deepEqual(petSeats(roles, 'nap'), [])
    assert.deepEqual(petRoleVariables({ pet_mood: 0.5, pet_role: 9 }, 'play', 1, 2.5), { pet_mood: 0.5, pet_mode: 7, pet_interaction: 4, pet_role: 1, pet_interaction_time: 2.5 })
    assert.deepEqual([petRoleVariables({}, 'nap', 0, 0), petRoleVariables({}, 'nap', 1, 3), petRoleVariables({}, 'nap', 1, -1), petRoleVariables({}, 'greet', 0, 3)].map((variables) => variables.pet_mode), [5, 5, 7, 7])
})

test('with only one part made, the preview stands a generic partner where PolyPlus would', () => {
    const roles = [{ interaction: 'play', id: 'a', animation: 'animation.pup.play_a', offset: [0, 0, -0.75] as [number, number, number], yaw: 0 }]
    const seated = petPairSeats(roles, 'play', 2)
    assert.deepEqual(seated.map((seat) => [seat.seat, seat.role, seat.spot.z, seat.spot.yaw]), [[0, 0, -0.75, 0], [1, NO_ROLE, 0.6, -180]])
    assert.deepEqual([genericPetSpot('nap', 0, 1), genericPetSpot('follow', 0, 1), genericPetSpot('follow', 1, 1)], [{ x: 0, y: 0, z: -0.35, yaw: 90 }, { x: 0, y: 0, z: -1.1, yaw: 0 }, { x: 0, y: 0, z: 0, yaw: -180 }])
    assert.deepEqual(petPairSeats([...roles, { ...roles[0], id: 'b' }], 'play', 1).map((seat) => seat.role !== NO_ROLE), [true, true])
    for (const interaction of ['follow', 'chase']) {
        const lone = [{ ...roles[0], interaction }]
        const generic = petPairSeats(lone, interaction, 1)
        assert.deepEqual(generic.map((seat) => [seat.seat, seat.role]), [[0, NO_ROLE], [1, NO_ROLE]], interaction)
        assert.deepEqual(generic.map((seat) => seat.spot), [genericPetSpot(interaction, 0, 1), genericPetSpot(interaction, 1, 1)], interaction)
        assert.ok(petPairSeats([...lone, { ...lone[0], id: 'b' }], interaction, 1).every((seat) => seat.role !== NO_ROLE), interaction)
    }
    assert.deepEqual([petPairSignals({ is_hurt: 1 }, 'play', seated[1]), petPairSignals({}, 'play', seated[0]), petPairSignals({}, 'greet', seated[0])], [{ is_hurt: 1, is_emoting: 1 }, {}, { is_emoting: 1 }])
    const order = (made: typeof roles, interaction: string, sides?: string[]) => petPairSeats(made, interaction, 1, sides as any).map((seat) => [seat.seat, seat.role])
    const flipped = [[1, NO_ROLE], [0, NO_ROLE]]
    assert.deepEqual([order([], 'greet', ['b']), order([{ ...roles[0], interaction: 'greet' }], 'greet', ['b']), order([{ ...roles[0], id: 'b', interaction: 'follow' }], 'follow', ['b']), order([], 'play', ['b'])], [flipped, flipped, flipped, flipped])
    assert.deepEqual([order([], 'greet', ['a', 'b']), order([{ ...roles[0], id: 'b' }], 'play')], [[[0, NO_ROLE], [1, NO_ROLE]], [[1, 0], [0, NO_ROLE]]])
    const both = (['a', 'b'] as const).map((id, i) => ({ interaction: 'play', id, animation: `animation.pup.play_${id}`, offset: [0, 0, i ? 0.75 : -0.75] as [number, number, number], yaw: i ? 180 : 0 }))
    assert.deepEqual([order(both, 'play', ['a']), order(both, 'play', ['b']), order(both, 'play', ['a', 'b']), order(both, 'play')], [[[0, 0], [1, NO_ROLE]], [[1, 1], [0, NO_ROLE]], [[0, 0], [1, 1]], [[0, 0], [1, 1]]])
    assert.ok(isGenericMove('chase', petPairSeats(both.map((role) => ({ ...role, interaction: 'chase' })), 'chase', 1, ['a'])))
})

test('a pet size outside what the game shows gets a plain warning, worded even without the range', () => {
    const sized = (scale: number) => {
        const { data, input } = pup((d) => {
            d.pet.scale = scale
        })
        return buildCosmetic(data, input).issues.filter((issue) => issue.code === 'pet_scale_range')
    }
    assert.deepEqual([sized(0.75), sized(0.01), sized(8)], [[], [], []])
    const found = sized(12)
    assert.equal(found.length, 1, 'shown once')
    assert.deepEqual([found[0].path, found[0].level, classifyIssue(found[0]).code], ['manifest.json#scale', 'warning', 'pet_scale_range'])
    assert.equal(cosmeticIssueText(found[0]), 'Pet settings set the size to 12, but the game only shows pets from size 0.01 to 8, so it uses 8. Pick a size in that range.')
    assert.equal(sized(0.001)[0].values?.kept, 0.01)
    const text = plainMessage(issueMessage('pet_scale_range', { value: 12 }, {}, 'manifest.json#scale'))
    assert.ok(!/\b(undefined|null|NaN)\b|0\.01|\b8\b/.test(text), text)
    assert.match(text, /^set the size to 12, but the game only shows pets in a set size range\b/)
})

test('the pet size range comes from the engine limits', () => {
    const limits = cosmeticLimits()!
    assert.deepEqual(petScaleRange(), { min: limits.pet_scale_min, max: limits.pet_scale_max })
    const engine = cosmeticEngineNow()! as any
    const constants = engine.constants
    engine.constants = () => {
        const real = constants.call(engine)
        return { ...real, limits: { ...real.limits, pet_scale_min: 0.5, pet_scale_max: 4 } }
    }
    const unregister = withActions(registerPet)
    try {
        assert.deepEqual(petScaleRange(), { min: 0.5, max: 4 })
        const { data } = pup()
        const section = petSettings(data)
        const field = section.form.scale as Record<string, unknown>
        assert.deepEqual([field.min, field.max, field.description], [0.5, 4, 'From 0.5 to 4. 1 is normal size'])
        const next = normalizeCosmetic(data, 'pet')
        section.save({ archetype: 'walking', leashRadius: 2, scale: 20, anchor: '' }, next)
        assert.equal(next.pet.scale, 4)
        section.save({ archetype: 'walking', leashRadius: 2, scale: 0.1, anchor: '' }, next)
        assert.equal(next.pet.scale, 0.5)
    } finally {
        unregister()
        engine.constants = constants
    }
})

test('generic follow and chase move like PolyPlus over the session length it uses', () => {
    const lone = [{ interaction: 'follow', id: 'a', animation: 'animation.pup.follow', offset: [0, 0, 0] as [number, number, number], yaw: 0 }]
    assert.ok(isGenericMove('follow', petPairSeats(lone, 'follow', 1)))
    assert.ok(!isGenericMove('play', petPairSeats([{ ...lone[0], interaction: 'play' }], 'play', 1)))
    assert.ok(!isGenericMove('follow', petPairSeats([...lone, { ...lone[0], id: 'b' }], 'follow', 1)))
    assert.deepEqual([INTERACTION_SECONDS.follow, INTERACTION_SECONDS.chase], [6, 12])
    const distance = (a: { x: number, z: number }, b: { x: number, z: number }) => Math.hypot(a.x - b.x, a.z - b.z)
    const follow = (time: number) => genericPetMotion('follow', 1, time)
    assert.deepEqual(follow(0).spots, [genericPetSpot('follow', 0, 1), genericPetSpot('follow', 1, 1)])
    for (const time of [1, 2.5, 4, 5.5]) {
        const { spots, speeds } = follow(time)
        assert.ok(Math.abs(Math.hypot(spots[0].x, spots[0].z) - 1.1) < 0.1, `circles the partner at ${time}`)
        assert.deepEqual(spots[1], genericPetSpot('follow', 1, 1))
        assert.ok(speeds[0] > 1 && speeds[1] === 0)
    }
    assert.ok(distance(follow(1).spots[0], follow(0).spots[0]) > 1)
    const chase = (time: number) => genericPetMotion('chase', 1, time)
    assert.deepEqual(chase(0).spots, [genericPetSpot('chase', 0, 1), genericPetSpot('chase', 1, 1)])
    for (const time of [1.5, 3, 5.5, 7]) {
        const { spots, speeds } = chase(time)
        const runner = Math.floor(time / 4) & 1
        assert.ok(Math.abs(Math.hypot(spots[runner].x, spots[runner].z) - 2.5) < 0.15, `the runner keeps to the circle at ${time}`)
        assert.ok(distance(spots[0], spots[1]) < 2, `the chaser stays close at ${time}`)
        assert.ok(speeds.every((speed) => speed > 3), `both run at ${time}`)
    }
    const step = distance(chase(1).spots[0], chase(1.05).spots[0])
    assert.ok(step > 0.2 && step < 0.4)
})

test('a pet previews the generic interactions PolyPlus gives it, with a generic partner for a side it does not take', () => {
    const plain = { archetype: 'walking' as const, interactions: {}, roles: [] }
    const sides = (interactions: Record<string, Array<'a' | 'b'>>) => interactions as PetData['interactions']
    assert.deepEqual([plain, { ...plain, interactions: sides({ play: ['a', 'b'], nap: [] }) }, { ...plain, archetype: 'shoulder' as const }, { ...plain, archetype: 'shoulder' as const, interactions: sides({ greet: [] }) }].map(petPreviewInteractions), [['greet', 'follow', 'nap', 'chase'], ['greet', 'follow', 'play', 'chase'], ['greet'], []])
    assert.equal(supportsGeneric(plain, 'dance'), false)
    for (const side of ['a', 'b'] as const) {
        assert.ok(petPreviewInteractions({ ...plain, interactions: sides({ play: [side] }) }).includes('play'), side)
        assert.equal(petPreviewInteractions({ ...plain, archetype: 'shoulder', interactions: sides({ play: [side] }) }).includes('play'), false, side)
    }
    const roles = [{ interaction: 'greet', id: 'a', animation: 'animation.pup.hi', offset: [0, 0, 0] as [number, number, number], yaw: 0 }]
    assert.deepEqual(petPreviewInteractions({ ...plain, interactions: sides({ greet: [] }), roles }), ['follow', 'nap', 'chase'])
    const paired = (interaction: string) => (['a', 'b'] as const).map((id) => ({ ...roles[0], interaction, id }))
    assert.deepEqual(petPreviewInteractions({ ...plain, roles: paired('play') }), ['greet', 'follow', 'nap', 'chase'])
    assert.deepEqual(petPreviewInteractions({ ...plain, interactions: sides({ play: ['a'] }), roles: paired('play') }), ['greet', 'follow', 'nap', 'play', 'chase'])
    assert.deepEqual(petPreviewInteractions({ ...plain, archetype: 'shoulder', interactions: sides({ play: ['a', 'b'] }), roles: [...paired('play'), ...paired('nap')] }), ['greet'])
    for (const interaction of ['greet', 'follow', 'nap', 'chase']) {
        const seated = petPairSeats([], interaction, 1)
        assert.deepEqual(seated.map((seat) => [seat.seat, seat.role]), [[0, NO_ROLE], [1, NO_ROLE]], interaction)
        assert.deepEqual(seated.map((seat) => seat.spot), [genericPetSpot(interaction, 0, 1), genericPetSpot(interaction, 1, 1)], interaction)
        assert.equal(isGenericMove(interaction, seated), interaction === 'follow' || interaction === 'chase', interaction)
    }
    assert.deepEqual(petPairSeats([], '', 1), [])
})

test('the two-pet preview lasts as long as the PolyPlus session, start delays included', () => {
    const clip = (seconds: number, looping = false, startDelay = 0) => ({ seconds, looping, startDelay })
    assert.deepEqual([
        petSessionSeconds('greet', [null, null]),
        petSessionSeconds('chase', []),
        petSessionSeconds('play', [clip(2, false, 1.5), null]),
        petSessionSeconds('play', [clip(2), clip(1, false, 4)]),
        petSessionSeconds('play', [clip(2, true, 1)]),
        petSessionSeconds('play', [clip(9, true)]),
        petSessionSeconds('play', [clip(0, false, 5)]),
        petSessionSeconds('play', [clip(2, false, -1)]),
    ], [3, 12, 3.5, 5, 8, 9, 8, 2])
    const files = {
        'manifest.json': '{}',
        'animations/pup.animation.json': JSON.stringify({ animations: {
            'animation.pup.a': { start_delay: 1.5 },
            'animation.pup.b': { start_delay: ' 2 ' },
            'animation.pup.c': { start_delay: 'v.wait' },
            'animation.pup.d': { start_delay: 'math.random(1, 2)' },
            'animation.pup.e': { start_delay: -3 },
            'animation.pup.f': { start_delay: true },
            'animation.pup.g': {},
        } }),
        'notes.txt': JSON.stringify({ animations: { 'animation.pup.g': { start_delay: 9 } } }),
    }
    assert.deepEqual([...startDelays(files)], [['animation.pup.a', 1.5], ['animation.pup.b', 2]])
    const roles = [
        { interaction: 'play', id: 'a', animation: 'animation.pup.a', offset: [0, 0, -0.75] as [number, number, number], yaw: 0 },
        { interaction: 'play', id: 'b', animation: 'animation.pup.c', offset: [0, 0, 0.75] as [number, number, number], yaw: 180 },
    ]
    const meta = { clips: [{ name: 'animation.pup.a', length: 2, loop: 'once' }, { name: 'animation.pup.c', length: 3, loop: 'repeat' }] }
    const both = petRoleClips(roles, petPairSeats(roles, 'play', 1), meta, files)
    assert.deepEqual(both, [clip(2, false, 1.5), clip(3, true, 0)])
    assert.equal(petSessionSeconds('play', both), 8)
    assert.deepEqual(petRoleClips(roles.slice(0, 1), petPairSeats(roles.slice(0, 1), 'play', 1), meta, files), [clip(2, false, 1.5), null])
    assert.deepEqual(petRoleClips(roles, petPairSeats(roles, 'play', 1), null, files), [clip(0, false, 1.5), clip(0, false, 0)])
})

test('the pet role preview sizes the pet by its authored scale like the game root', () => {
    for (const scale of [0.5, 1, 2.5]) {
        const { root, unroot, size } = petRoots(scale)
        assert.deepEqual(root, [scale / 16, 0, 0, 0, 0, scale / 16, 0, 0, 0, 0, scale / 16, 0])
        const shown = multiply(unroot, root)
        for (let i = 0; i < 12; i++) assert.ok(Math.abs(shown[i] - size[i]) < 1e-9, `scale ${scale} entry ${i}`)
        assert.deepEqual([size[0], size[5], size[10]], [scale, scale, scale])
    }
})
