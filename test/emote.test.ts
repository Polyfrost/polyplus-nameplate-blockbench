import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyIssue } from '../src/checks/codes'
import { plainMessage } from '../src/checks/words'
import { HOST_VARIABLES } from '../src/cosmetic/autocomplete'
import { buildBundle, readBundle } from '../src/cosmetic/bundle'
import { buildCosmetic } from '../src/cosmetic/build'
import { COSMETIC_FORMATS, normalizeCosmetic } from '../src/cosmetic/data'
import { seats } from '../src/cosmetic/duo'
import { EMOTE_FALLBACK_VARIABLE, EMOTE_ROLE_VARIABLE, registerEmote } from '../src/cosmetic/emote'
import { applyPreview, clearPreview, preview, resetPreview, setHostVariable } from '../src/cosmetic/preview'
import { COSMETIC_PROPERTY } from '../src/cosmetic/state'
import { HOST_CONTROLS, hostOptions, SETTINGS_SECTIONS, shownHostControls } from '../src/cosmetic/registry'
import { cosmeticIssueText } from '../src/cosmetic/where'
import { EmoteDriver, engineSignals, IDENTITY, issueMessage, loadCosmetic, PLAYER_BONES } from '../src/engine'
import { animation, cosmetic, roundTrip, sources, using, withActions, withGlobals } from './cosmeticKit'

const PLAYER = ['rightArm', 'leftArm', 'head']
const ROLES = [
    { id: 'a', animation: 'animation.wave.a', offset: [0, 0, 0] as [number, number, number], yaw: 0 },
    { id: 'b', animation: 'animation.wave.b', offset: [0, 0, 1.5] as [number, number, number], yaw: 180 },
]

function wave(change: Parameters<typeof cosmetic>[2] = () => {}) {
    const data = cosmetic('emote', 'wave', change)
    const input = sources((s) => {
        s.animations = {
            'animation.wave.a': { ...animation(PLAYER, 1.5), loop: false },
            'animation.wave.b': { ...animation(PLAYER, 1.5), loop: false },
        }
    })
    return { data, input }
}

function exported(change: Parameters<typeof cosmetic>[2] = () => {}) {
    const { data, input } = wave(change)
    const built = roundTrip(data, input)
    return { built, manifest: JSON.parse(built.files['manifest.json']), meta: built.load!.meta! }
}

test('a solo emote exports only the rules it changes and its main animation, and reads back the same', () => {
    const solo = exported((d) => {
        d.emote.rules.allow_walking = true
        d.emote.rules.absolute_head = false
    })
    assert.equal(solo.manifest.kind, 'emote')
    assert.deepEqual(solo.manifest.rules, { allow_walking: true, absolute_head: false })
    assert.deepEqual([solo.manifest.roles, solo.manifest.attach, solo.manifest.geometry, solo.manifest.requirement, solo.manifest.fallback], [undefined, undefined, undefined, undefined, undefined])
    assert.deepEqual([solo.meta.rules!.allow_walking, solo.meta.rules!.allow_falling, solo.meta.requirement, solo.meta.fallback], [true, true, 'floor', null])
    assert.deepEqual([solo.manifest.main, solo.meta.main, readBundle(solo.built).data.emote.main], ['animation.wave.a', 'animation.wave.a', ''], 'the first animation is the main one by default')
    const backed = exported((d) => {
        d.emote.fallback = 'animation.wave.a'
    })
    assert.deepEqual([backed.manifest.main, backed.meta.main], ['animation.wave.b', 'animation.wave.b'], 'the backup is never the default main one')
    const picked = exported((d) => {
        d.emote.main = 'animation.wave.b'
    })
    assert.deepEqual([picked.manifest.main, picked.meta.main, readBundle(picked.built).data.emote.main], ['animation.wave.b', 'animation.wave.b', 'animation.wave.b'])
})

test('duo and context emotes export their roles, spot and backup', () => {
    const duo = exported((d) => {
        d.emote.roles = ROLES
    })
    assert.deepEqual(duo.manifest.roles, [
        { id: 'a', animation: 'animation.wave.a' },
        { id: 'b', animation: 'animation.wave.b', offset: [0, 0, 1.5], yaw: 180 },
    ])
    assert.ok(duo.built.requires.includes('roles'), duo.built.requires.join())
    assert.deepEqual(duo.meta.roles.map((role) => [role.id, role.animation, role.yaw]), [['a', 'animation.wave.a', 0], ['b', 'animation.wave.b', 180]])
    for (const requirement of ['ledge', 'wall']) {
        const context = exported((d) => {
            d.emote.requirement = requirement
            d.emote.fallback = 'animation.wave.b'
        })
        assert.deepEqual([context.manifest.requirement, context.manifest.fallback, context.meta.requirement, context.meta.fallback], [requirement, 'animation.wave.b', requirement, 'animation.wave.b'])
    }
})

test('emote mistakes read as sentences and survive a reload', () => {
    const { data, input } = wave()
    const bundle = buildBundle(data, input, ['roles'])
    const load = (change: (manifest: Record<string, any>) => void) => {
        const manifest = JSON.parse(bundle.files['manifest.json'])
        change(manifest)
        return loadCosmetic({ ...bundle.files, 'manifest.json': JSON.stringify(manifest) }, bundle.binary)!.issues
    }
    const issues = [
        [{ id: 'a', animation: 'animation.wave.a' }, { id: 'a', animation: 'animation.wave.b' }, { id: 'b', animation: 'animation.wave.twirl' }],
        [{ id: 'a', animation: 'animation.wave.a' }, { id: 'b', animation: 'animation.wave.twirl' }],
    ].flatMap((roles) => load((manifest) => {
        manifest.roles = roles
        manifest.rules = { allow_walking: 'yes' }
    }))
    const codes = issues.map((issue) => classifyIssue(issue).code)
    for (const code of ['roles_too_many', 'role_duplicate', 'role_animation_missing', 'emote_rules_invalid']) assert.ok(codes.includes(code as any), `${code} in ${codes.join()}`)
    for (const issue of issues) assert.notEqual(plainMessage(issueMessage(issue.code ?? '', issue.values ?? {}, issue.names ?? {}, issue.path)), plainMessage(''), `${issue.code} ${JSON.stringify(issue.names)}`)
    const empty = buildBundle(data, { ...input, animations: {} }, [])
    assert.ok(loadCosmetic(empty.files, empty.binary)!.issues.some((issue) => issue.code === 'animations_invalid'))
    const unnamed = load((manifest) => {
        delete manifest.main
    }).find((issue) => issue.code === 'emote_main_unnamed')
    assert.equal(unnamed?.path, 'manifest.json#main')
    assert.equal(cosmeticIssueText(unnamed!), "The emote has 2 animations but doesn't say which one is the main one, so the game would guess 'animation.wave.a'. Pick a Main animation in Settings.")
    const bad = load((manifest) => {
        manifest.main = 'animation.wave.twirl'
    }).find((issue) => issue.code === 'emote_rules_invalid' && issue.path === 'manifest.json#main')
    assert.equal(cosmeticIssueText(bad!), "The emote has 'animation.wave.twirl' as its main animation, but that isn't an animation in this project or it's also the backup. Pick another one in Settings.")
    const spot = wave((d) => {
        d.emote.requirement = 'ceiling'
        d.emote.fallback = 'animation.wave.twirl'
    })
    const odd = buildBundle(spot.data, spot.input, [])
    assert.deepEqual([readBundle(odd).data.emote.requirement, readBundle(odd).data.emote.fallback], ['ceiling', 'animation.wave.twirl'])
    const texts = Object.fromEntries(loadCosmetic(odd.files, odd.binary)!.issues.filter((issue) => issue.code === 'emote_rules_invalid').map((issue) => [issue.path, cosmeticIssueText(issue)]))
    assert.match(texts['manifest.json#requirement'], /^The emote needs a spot the game doesn't know\. Pick Open ground/)
    assert.match(texts['manifest.json#fallback'], /^The emote plays 'animation\.wave\.twirl' when there's no spot/)
})

test('emote settings offer the project animations as the main one and keep the default unless another is picked', () => {
    withGlobals({ Animator: { animations: [{ name: 'animation.wave.a' }, { name: 'animation.wave.b' }] } }, () => {
        const unregister = withActions(registerEmote)
        try {
            const { data } = wave((d) => {
                d.emote.fallback = 'animation.wave.a'
            })
            const section = SETTINGS_SECTIONS.map((make) => make(data)).find((made) => 'requirement' in made.form)!
            const field = section.form.main as { label: string, options: Record<string, string>, value: string }
            assert.deepEqual([field.label, Object.keys(field.options), field.value], ['Main animation', ['animation.wave.a', 'animation.wave.b'], 'animation.wave.b'])
            const values = Object.fromEntries(Object.entries(section.form).map(([key, value]) => [key, (value as { value: unknown }).value]))
            const next = normalizeCosmetic(data, 'emote')
            section.save(values, next)
            assert.equal(next.emote.main, '')
            section.save({ ...values, main: 'animation.wave.a' }, next)
            assert.equal(next.emote.main, 'animation.wave.a')
        } finally {
            unregister()
        }
    })
})

test('emote previews let a controller see which part it plays and whether the backup plays, shown only where they apply', () => {
    const global_variables: Record<string, unknown> = {}
    withGlobals({ Animator: { MolangParser: { global_variables }, animations: [], preview() {} }, Format: { id: COSMETIC_FORMATS.emote } }, () => {
        const unregister = withActions(registerEmote)
        const shown = (data: ReturnType<typeof wave>['data'], host = preview.host) => shownHostControls('emote', data, host).map((control) => control.name)
        try {
            assert.deepEqual(HOST_VARIABLES.emote, [EMOTE_ROLE_VARIABLE, EMOTE_FALLBACK_VARIABLE])
            const solo = wave().data
            ;(globalThis as any).Project = { [COSMETIC_PROPERTY]: solo }
            assert.deepEqual(shown(solo, {}), [])
            setHostVariable('emote_role', 1)
            setHostVariable('emote_fallback', 1)
            assert.deepEqual([global_variables['v.emote_role'], global_variables['v.emote_fallback']], [-1, 0], 'a solo emote without a backup always plays alone and never the backup')
            resetPreview()
            const controls = Object.fromEntries(HOST_CONTROLS.filter((control) => control.kinds.includes('emote')).map((control) => [control.name, control]))
            const { data } = wave((d) => {
                d.emote.roles = ROLES
                d.emote.requirement = 'ledge'
                d.emote.fallback = 'animation.wave.b'
            })
            ;(globalThis as any).Project = { [COSMETIC_PROPERTY]: data }
            assert.deepEqual([hostOptions(controls.emote_role, data)!.map((option) => [option.value, option.label]), controls.emote_fallback.toggle], [[[-1, 'Alone'], [0, 'Starts it'], [1, 'Joins in']], true])
            assert.deepEqual(shown(data), ['emote_role', 'emote_fallback'])
            applyPreview()
            assert.deepEqual([global_variables['variable.emote_role'], global_variables['v.emote_role']], [-1, -1])
            setHostVariable('emote_fallback', 1)
            assert.equal(global_variables['v.emote_fallback'], 1, 'a player alone can play the backup')
            setHostVariable('emote_role', 1)
            assert.deepEqual([global_variables['v.emote_role'], global_variables['v.emote_fallback']], [1, 0], 'a player in a part never plays the backup, like in the game')
            assert.deepEqual(shown(data), ['emote_role'])
            setHostVariable('emote_role', -1)
            assert.equal(global_variables['v.emote_fallback'], 1)
            resetPreview()
            assert.deepEqual([global_variables['v.emote_role'], global_variables['v.emote_fallback']], [-1, 0])
        } finally {
            unregister()
            resetPreview()
            clearPreview()
            delete (globalThis as any).Project
        }
    })
    assert.equal(HOST_VARIABLES.emote, undefined)
    assert.equal(HOST_CONTROLS.length, 0)
})

test('in the duo preview clips follow the preview signals', () => {
    const { data, input } = wave((d) => {
        d.emote.roles = ROLES
    })
    input.animations['animation.wave.a'] = { loop: true, animation_length: 1, bones: { head: { rotation: ['q.is_on_fire * 30', 0, 0] } } }
    const built = buildCosmetic(data, input)
    const head = (signals: Record<string, number>) => using([EmoteDriver.open(built.files, built.binary, engineSignals())!], (driver) => {
        let frames: Float32Array[] = []
        for (let t = 0; t <= 1; t += 1 / 20) frames = driver.frame(t, t, seats(data.emote.roles).map((seat) => seat.actor), signals)
        const at = PLAYER_BONES.indexOf('head') * 12
        return Array.from(frames[0].slice(at, at + 12)).some((value, i) => Math.abs(value - IDENTITY[i]) > 1e-3)
    })
    assert.deepEqual([head({}), head({ is_on_fire: 1 })], [false, true])
})
