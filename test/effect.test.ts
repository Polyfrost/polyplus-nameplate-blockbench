import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyIssue } from '../src/checks/codes'
import { plainMessage } from '../src/checks/words'
import { buildCosmetic } from '../src/cosmetic/build'
import { applyParticleFields, particleFields, particleStarter, pictureTextureIds, soundPitch, soundVolume } from '../src/cosmetic/effects'
import { cosmeticIssueText } from '../src/cosmetic/where'
import { uniqueId } from '../src/palette/ids'
import { encodePng } from '../src/cosmetic/png'
import { CosmeticDriver, engineSignals, IDENTITY, issueMessage } from '../src/engine'
import { downmix, onSoundChange, PreviewSounds, setSoundMuted, soundUi } from '../src/cosmetic/sounds'
import { toBase64 } from '../src/material/png'
import { animation, cleanBuild, cosmetic, FEATHER, geometry, PICTURE, roundTrip, sources, using } from './cosmeticKit'

const OGG = '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'

function sparkle(change: Parameters<typeof cosmetic>[2] = () => {}) {
    const data = cosmetic('effect', 'star_burst', (d) => {
        d.palette = { slots: [{ id: 'glow', name: 'Glow', ramp: FEATHER, customizable: true }], colorways: {}, fixed: [] }
        d.effects.pictures = { spark: PICTURE, streak: PICTURE }
        d.effects.audio = { chime: OGG }
        d.effects.particles = [{ ...particleStarter('spark'), picture: 'spark', tint: { slot: 'glow', tone: 1 } }]
        d.effects.sounds = [
            { id: 'chime', file: '', vanilla: '', volume: 0.8, pitch: 1.2 },
            { id: 'pling', file: '', vanilla: 'minecraft:block.note_block.pling', volume: 1, pitch: 1 },
        ]
        d.effects.named = {
            join: [{ particle: '', sound: 'chime', vanilla: '', locator: '', count: 1 }],
            death: [
                { particle: '', sound: '', vanilla: 'minecraft:end_rod', locator: 'ring', count: 4 },
                { particle: 'spark', sound: '', vanilla: '', locator: 'head', count: 1 },
            ],
        }
        d.effects.emitters = [{ particle: '', sound: 'pling', vanilla: '', locator: 'ring', count: 1 }]
        d.effects.trails = [{
            locator: 'back',
            picture: 'streak',
            blend: 'additive',
            width: [0.3, 0.1],
            tile: true,
            tint: { kind: 'slot', slot: 'glow', tone: 1 },
            fade: 0.5,
            minSpeed: 0.2,
            while: ['is_gliding', 'is_falling'],
        }]
        change(d)
    })
    const input = sources((s) => {
        s.geometry = geometry('star_burst', [{ name: 'root', pivot: [0, 0, 0], locators: { ring: [0, 30, 0] } }])
        s.animations = { 'animation.star_burst.pop': animation(['root'], 1, { particle_effects: { '0.0': { effect: 'join', locator: 'ring' } } }) }
    })
    return { data, input }
}

function worded(issues: ReturnType<typeof buildCosmetic>['issues']) {
    for (const issue of issues) {
        const text = plainMessage(issueMessage(issue.code ?? '', issue.values ?? {}, issue.names ?? {}, issue.path))
        assert.notEqual(text, plainMessage(''), `${issue.code} ${issue.path} ${JSON.stringify(issue.names)}`)
    }
}

test('an effect bundle exports particles, sounds, named effects and trails and reads back the same', () => {
    const { data, input } = sparkle()
    const built = roundTrip(data, input)
    const manifest = JSON.parse(built.files['manifest.json'])
    assert.equal(manifest.kind, 'effect')
    assert.deepEqual(manifest.particles, { spark: { tint: { slot: 0, tone: 1 } } })
    assert.deepEqual(manifest.sounds, { chime: { volume: 0.8, pitch: 1.2 }, pling: { vanilla: 'minecraft:block.note_block.pling' } })
    assert.deepEqual(Object.keys(manifest.effects), ['join', 'death'])
    assert.deepEqual(manifest.trails[0].while, ['is_gliding', 'is_falling'])
    assert.ok(built.binary['sounds/chime.ogg'])
    assert.ok(built.binary['textures/fx_spark.png'])
    assert.equal(JSON.parse(built.files['particles/spark.json']).particle_effect.description.basic_render_parameters.texture, 'textures/fx_spark')
    for (const name of ['effects', 'particles', 'sounds', 'trails']) assert.ok(built.requires.includes(name), `${name} in ${built.requires.join()}`)
    const meta = built.load!.meta!
    assert.deepEqual(meta.effects.named, ['join', 'death'])
    assert.deepEqual(meta.effects.locators, ['ring'])
    assert.equal(meta.effects.trails.length, 1)
})

test('particle settings map onto the Snowstorm components and keep the rest', () => {
    const json = particleStarter('dust').json
    json.particle_effect.components['minecraft:particle_appearance_billboard'].uv.flipbook = { base_UV: [0, 0], size_UV: [8, 8], step_UV: [8, 0], max_frame: 4 }
    const fields = particleFields(json)
    assert.equal(fields.rate, 'instant')
    assert.equal(fields.shape, 'sphere')
    const changed = applyParticleFields(json, { ...fields, rate: 'steady', perSecond: 12, max: 30, shape: 'box', box: [0.5, 0.1, 0.5], world: false, color: '#FF80C0FF', blend: 'additive' })
    const c = changed.particle_effect.components
    assert.deepEqual(c['minecraft:emitter_rate_steady'], { spawn_rate: 12, max_particles: 30 })
    assert.equal(c['minecraft:emitter_rate_instant'], undefined)
    assert.equal(c['minecraft:emitter_shape_sphere'], undefined)
    assert.deepEqual(c['minecraft:emitter_shape_box'].half_dimensions, [0.5, 0.1, 0.5])
    assert.deepEqual(c['minecraft:emitter_local_space'], { position: true, rotation: true })
    assert.equal(changed.particle_effect.description.basic_render_parameters.material, 'particles_add')
    assert.ok(c['minecraft:particle_appearance_billboard'].uv.flipbook)
    assert.deepEqual(particleFields(changed), { ...fields, rate: 'steady', perSecond: 12, max: 30, shape: 'box', box: [0.5, 0.1, 0.5], world: false, color: '#FF80C0FF', blend: 'additive' })
})

test('broken effects come back as worded checks', () => {
    const { data, input } = sparkle((d) => {
        d.effects.particles[0].json.particle_effect.components['minecraft:particle_motion_collision'] = { collision_radius: 0.1 }
        d.effects.named.join.push({ particle: 'smoke', sound: '', vanilla: '', locator: 'head', count: 1 })
        d.effects.named.death.push({ particle: '', sound: 'chime', vanilla: '', locator: 'fin', count: 1 })
        d.effects.named.death.push({ particle: '', sound: '', vanilla: 'minecraft:tnt', locator: '', count: 1 })
        d.effects.sounds.push({ id: 'boom', file: '', vanilla: 'minecraft:entity.generic.explode', volume: 1, pitch: 1 })
    })
    input.animations['animation.star_burst.pop'] = animation(['root'], 1, { particle_effects: { '0.0': { effect: 'nothing' } } })
    const built = buildCosmetic(data, input)
    const codes = built.issues.map((issue) => classifyIssue(issue).code)
    for (const code of ['effect_unsupported', 'particle_missing', 'locator_missing', 'vanilla_particle_not_allowed', 'sound_not_allowed', 'effect_event_unknown']) {
        assert.ok(codes.includes(code as any), `${code} in ${codes.join()}`)
    }
    worded(built.issues)
})

test('a silent sound keeps volume 0, and only empty or bad values fall back to 1', () => {
    assert.deepEqual([soundVolume(0), soundVolume('0'), soundVolume(0.4), soundPitch(1.5)], [0, 0, 0.4, 1.5])
    for (const bad of ['', undefined, null, NaN, -1, 'loud']) assert.equal(soundVolume(bad), 1, String(bad))
    for (const bad of ['', undefined, 0, -2]) assert.equal(soundPitch(bad), 1, String(bad))
    const { data, input } = sparkle((d) => {
        d.effects.sounds[0].volume = soundVolume(0)
    })
    const built = buildCosmetic(data, input)
    assert.deepEqual(JSON.parse(built.files['manifest.json']).sounds.chime, { volume: 0, pitch: 1.2 })
    const flagged = built.issues.find((issue) => issue.path === 'manifest.json#sounds.chime')
    assert.ok(flagged, JSON.stringify(built.issues))
    worded([flagged])
})

test('a model texture never shares a file with an effect picture', () => {
    const { data, input } = sparkle()
    assert.deepEqual([...pictureTextureIds(data)].sort(), ['fx_spark', 'fx_streak'])
    const own = uniqueId('fx_spark', (candidate) => pictureTextureIds(data).has(candidate))
    assert.equal(own, 'fx_spark_2')
    input.textures = [{ id: 'fx_spark', png: encodePng(2, 2, new Uint8Array(16).fill(200), 4), index: null }]
    const built = buildCosmetic(data, input)
    const taken = built.issues.find((issue) => issue.code === 'texture_path_taken')
    assert.ok(taken, JSON.stringify(built.issues.map((issue) => issue.code)))
    assert.equal(cosmeticIssueText(taken!), "Effect picture 'spark' saves to the same file as texture 'fx_spark'. Rename the texture or the effect picture.")
    input.textures[0].id = own
    const fixed = buildCosmetic(data, input)
    assert.equal(fixed.issues.some((issue) => issue.code === 'texture_path_taken'), false)
    assert.ok(fixed.binary['textures/fx_spark_2.png'])
    assert.ok(fixed.binary['textures/fx_spark.png'])
})

test('a moment whose start delay reads a variable or whose animation loops is too long and says why', () => {
    const { data, input } = sparkle()
    input.animations['animation.star_burst.pop'] = animation(['root'], 1, { loop: false, start_delay: 'v.wait', particle_effects: { '0.0': { effect: 'join', locator: 'ring' } } })
    const long = buildCosmetic(data, input).issues.filter((issue) => issue.code === 'effect_too_long')
    assert.deepEqual(long.map((issue) => issue.path), ['manifest.json#effects.join', 'manifest.json#effects.death'])
    assert.equal(cosmeticIssueText(long[0]), "Effect 'join' lasts longer than 3 seconds, the most it can. Its animation must not loop, and its start delay counts too, so use a number or a formula without variables or queries. Make it shorter.")
    input.animations = { 'animation.star_burst.join': animation(['root'], 1) }
    assert.deepEqual(buildCosmetic(data, input).issues.filter((issue) => issue.code === 'effect_too_long').map((issue) => issue.path), ['manifest.json#effects.join'])
})

test('a sound in another codec, or one that cannot be measured, asks for Ogg Vorbis', () => {
    const page = (head: number[]) => [0x4f, 0x67, 0x67, 0x53, 0, 2, ...new Array(20).fill(0), 1, head.length, ...head]
    const opus = page([...'OpusHead'].map((c) => c.charCodeAt(0)).concat([1, 2, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0]))
    const flac = page([0x7f, ...[...'FLAC'].map((c) => c.charCodeAt(0)), 1, 0, 0, 0])
    const cases: [Uint8Array, string, string][] = [
        [new Uint8Array(opus), 'opus', "Sound 'chime' uses 'sounds/chime.ogg', saved as Ogg Opus, which Minecraft can't play. Export it as Ogg Vorbis."],
        [new Uint8Array(flac), 'flac', "Sound 'chime' uses 'sounds/chime.ogg', saved as Ogg FLAC, which Minecraft can't play. Export it as Ogg Vorbis."],
        [new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0]), 'unknown', "Sound 'chime' uses 'sounds/chime.ogg', which isn't an Ogg Vorbis file Minecraft can play. Export it as Ogg Vorbis."],
    ]
    for (const [bytes, codec, text] of cases) {
        const { data, input } = sparkle((d) => {
            d.effects.audio.chime = toBase64(bytes)
        })
        const unsupported = buildCosmetic(data, input).issues.find((issue) => classifyIssue(issue).code === 'sound_unsupported')
        assert.ok(unsupported, codec)
        assert.deepEqual(unsupported.names, { file: 'sounds/chime.ogg', codec })
        assert.equal(cosmeticIssueText(unsupported), text)
    }
})

test('a sound with too high a sample rate or too many channels says how to export it', () => {
    const text = (code: string, values: Record<string, number>) => cosmeticIssueText({ path: 'manifest.json#sounds.chime', code, level: 'error' as const, values, names: { file: 'sounds/chime.ogg' }, message: issueMessage(code, values, { file: 'sounds/chime.ogg' }) })
    assert.equal(text('sound_rate_unsupported', { rate: 176400, limit: 96000 }), "Sound 'chime' uses 'sounds/chime.ogg', recorded at 176.4 kHz. Sounds can be 96 kHz at most. Export it at 48 kHz or lower.")
    assert.equal(text('sound_rate_unsupported', {}), "Sound 'chime' uses 'sounds/chime.ogg', which has too high a sample rate. Sounds can be 96 kHz at most. Export it at 48 kHz or lower.")
    assert.equal(text('sound_channels_unsupported', { channels: 6, limit: 2 }), "Sound 'chime' uses 'sounds/chime.ogg', which has 6 channels. Sounds can only be mono or stereo. Export it in mono or stereo.")
})

function momentDriver() {
    const { data, input } = sparkle()
    input.animations['animation.star_burst.join'] = animation(['root'], 1, { loop: false, sound_effects: { '0.5': { effect: 'chime' } } })
    const built = cleanBuild(data, input)
    return CosmeticDriver.open(built.files, built.binary, engineSignals())!
}

function rootTurned(frame: { bones: Float32Array }): boolean {
    return Array.from(frame.bones.slice(0, 12)).some((value, i) => Math.abs(value - IDENTITY[i]) > 1e-3)
}

test('the live preview plays a moment the way the game does: its effect fires and its clip plays for its length', () => {
    using([momentDriver()], (driver) => {
        assert.deepEqual([0, 1].map((index) => [driver.soundFile(index), driver.soundVanilla(index)]), [['sounds/chime.ogg', null], [null, 'minecraft:block.note_block.pling']], 'the preview names a Minecraft sound from the built bundle')
        assert.ok(driver.playsMoments)
        assert.deepEqual(driver.namedEffects(), ['join', 'death'])
        const join = driver.moments().find((moment) => moment.name === 'join')
        assert.ok(join && join.clip !== null && join.seconds > 0)
        const chimes = () => driver.soundEvents().filter((sound) => driver.soundFile(sound.sound) === 'sounds/chime.ogg')
        driver.play(0)
        const still = driver.frame(0, { signals: {}, events: 0, root: IDENTITY })
        assert.equal(rootTurned(still), false, 'with no moment chosen the model holds still')
        assert.deepEqual(chimes(), [])
        assert.equal(driver.fireEffect('join'), true)
        assert.equal(driver.fireEffect('nope'), false)
        const fired = driver.frame(0.1, { signals: {}, events: 0, root: IDENTITY, play: { clip: join!.clip!, age: 0 } })
        const heard = chimes()
        assert.equal(heard.length, 1, 'the join effect plays its sound once')
        assert.ok(Math.abs(heard[0].volume - 0.8) < 1e-6 && Math.abs(heard[0].pitch - 1.2) < 1e-6)
        assert.equal(rootTurned(fired), false, 'the clip starts at its first key')
        const playing = driver.frame(0.65, { signals: {}, events: 0, root: IDENTITY, play: { clip: join!.clip!, age: 0.55 } })
        assert.equal(rootTurned(playing), true, 'the moment clip moves the model')
        assert.equal(chimes().length, 1, 'the sound keyframe in the clip plays')
        driver.frame(0.75, { signals: {}, events: 0, root: IDENTITY, play: { clip: join!.clip!, age: 0.65 } })
        assert.deepEqual(chimes(), [], 'each sound plays once')
    })
})

function fakeOutput() {
    const decoded: Uint8Array[] = []
    const playing: Array<[unknown, number, number]> = []
    return {
        decoded,
        playing,
        decode: async (bytes: Uint8Array) => (decoded.push(bytes), 'buffer'),
        play: (buffer: unknown, volume: number, pitch: number) => playing.push([buffer, volume, pitch]),
        stop: () => {
            playing.length = 0
        },
    }
}

test('preview sounds play bundled audio at the emitted volume and pitch, stay quiet when muted and stop on mute or close', async () => {
    const output = fakeOutput()
    const chime = new Uint8Array([1, 2, 3])
    const sounds = new PreviewSounds({ 'sounds/chime.ogg': chime, 'textures/a.png': new Uint8Array(1) }, output)
    assert.deepEqual(output.decoded, [chime], 'bundled sounds are decoded up front')
    const source = { soundFile: (index: number) => (index === 0 ? 'sounds/chime.ogg' : null) }
    const event = { wearer: 0, sound: 0, at: [0, 0, 0] as [number, number, number], volume: 0.8, pitch: 1.2 }
    const play = async () => {
        sounds.play(source, [event, { ...event, sound: 1 }])
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await play()
    assert.deepEqual(output.playing, [['buffer', 0.8, 1.2]])
    try {
        setSoundMuted(true)
        assert.equal(output.playing.length, 0, 'muting cuts the sound off')
        await play()
        assert.equal(output.playing.length, 0, 'a muted preview stays quiet')
    } finally {
        setSoundMuted(false)
    }
    await play()
    assert.equal(output.playing.length, 1)
    sounds.dispose()
    assert.equal(output.playing.length, 0, 'closing the preview cuts the sound off')
    await play()
    assert.equal(output.playing.length, 0, 'a closed preview stays quiet')
    assert.equal(output.decoded.length, 1)
})

test('a Minecraft sound the preview has no file for is named in a note instead of dropped silently', () => {
    const output = fakeOutput()
    const sounds = new PreviewSounds({}, output)
    let changes = 0
    const off = onSoundChange(() => changes++)
    try {
        const names = ['minecraft:block.note_block.pling', 'minecraft:entity.generic.explode']
        const source = { soundFile: () => null, soundVanilla: (index: number) => names[index] ?? null }
        const event = { wearer: 0, sound: 0, at: [0, 0, 0] as [number, number, number], volume: 1, pitch: 1 }
        sounds.play(source, [event])
        assert.equal(soundUi.note, "The preview can't play Minecraft sounds, so minecraft:block.note_block.pling is silent here. It plays in the game.")
        sounds.play(source, [event])
        assert.equal(changes, 1)
        sounds.play(source, [{ ...event, sound: 1 }, { ...event, sound: 2 }])
        assert.equal(soundUi.note, "The preview can't play Minecraft sounds, so minecraft:block.note_block.pling, minecraft:entity.generic.explode are silent here. They play in the game.")
        sounds.dispose()
        assert.equal(soundUi.note, '', 'the note goes away with the preview')
    } finally {
        off()
        sounds.dispose()
    }
})

test('a stereo sound is mixed down to mono the way PolyPlus plays it', () => {
    const make = (channels: number, length: number, sampleRate: number) => {
        const data = Array.from({ length: channels }, () => new Float32Array(length))
        return { numberOfChannels: channels, length, sampleRate, getChannelData: (channel: number) => data[channel] }
    }
    const stereo = make(2, 3, 44100)
    stereo.getChannelData(0).set([1, 0.5, -1])
    stereo.getChannelData(1).set([0, 0.5, 1])
    const mono = downmix(stereo, make)
    assert.equal(mono.numberOfChannels, 1)
    assert.equal(mono.sampleRate, 44100)
    assert.deepEqual(Array.from(mono.getChannelData(0)), [0.5, 0.5, 0])
    const already = make(1, 2, 22050)
    assert.equal(downmix(already, make), already)
})
