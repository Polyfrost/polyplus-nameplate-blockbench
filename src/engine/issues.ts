import type { RawIssue } from '@plusrenderer/renderer/nameplate.js'
import { INTERACTION_LABELS, MAX_ROLES, ROLE_LABELS } from '../cosmetic/data'
import { BundleIssue } from '../model'

export type IssueLevel = 'error' | 'warning' | 'info'

export type IssueValues = Readonly<Record<string, number>>

export type IssueNames = Readonly<Record<string, string>>

export interface EngineIssue extends BundleIssue {
    code?: string
    level?: IssueLevel
    values?: IssueValues
    names?: IssueNames
}

const LEVELS: ReadonlySet<string> = new Set<IssueLevel>(['error', 'warning', 'info'])

const COUNTED = ['count', 'bytes', 'px', 'frames', 'nodes', 'samples', 'inputs', 'quads', 'units', 'ops', 'states', 'tones', 'stops', 'lines', 'length', 'actual']

type Phrase = (values: IssueValues, names: IssueNames, path: string) => string

function number(values: IssueValues, name: string): number | null {
    const value = values[name]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function seconds(value: number | null): string {
    return value === null ? 'too many' : `${Math.round(value * 10) / 10}`
}

function kilohertz(rate: number): string {
    return `${Math.round(rate / 100) / 10} kHz`
}

function rateOf(rate: number | null): string {
    return rate === null ? 'which has too high a sample rate' : `recorded at ${kilohertz(rate)}`
}

function size(bytes: number | null): string {
    if (bytes === null) return 'the limit'
    if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 100) / 100} MB`
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
    return `${bytes} bytes`
}

function over(values: IssueValues, what: string, fix: string): string {
    const actual = number(values, 'actual')
    const limit = number(values, 'limit')
    if (actual === null || limit === null) return `has too many ${what}. ${fix}`
    return `has ${actual} ${what}, and the limit is ${limit}. ${fix}`
}

function fileName(names: IssueNames, path: string): string {
    const file = names.file ?? path.split('#')[0]
    return file ? `'${file}'` : 'a file'
}

function nodeWord(node: string | undefined): string {
    return node ? `the '${node}' node` : 'a node'
}

function drawnArea(values: IssueValues): string {
    const width = number(values, 'name_width')
    const lines = number(values, 'lines') ?? 1
    if (width === null) return ''
    return ` with a ${width} px name${lines > 1 ? ` on ${lines} lines` : ''}`
}

function quoted(names: IssueNames, key: string, fallback: string): string {
    return names[key] ? `'${names[key]}'` : fallback
}

const ITEM_PHRASES: Record<string, Phrase> = {
    quads_over_budget: (values) => over(values, 'cube faces', 'Use fewer or smaller cubes'),
    bones_over_budget: (values) => over(values, 'groups', 'Merge some groups'),
    spring_bones_over_budget: (values) => over(values, 'spring groups', 'Turn the spring off on some groups'),
    spring_chain_too_deep: (values) => over(values, 'spring groups in one chain', 'Make the chain shorter'),
    spring_invalid: () => "has spring settings the game can't read. Set them again in Spring settings",
    spring_setting_range: (values) => `has a spring setting of ${number(values, 'value') ?? 'a value'} that is out of range, so the game uses the nearest allowed value. Set it again in Spring settings`,
    spring_chain_broken: () => "is a spring, but the group above it isn't, so its chain starts over here. Make the group above a spring too, or turn this one off",
    reaction_invalid: (values, names) => {
        if (number(values, 'limit') !== null) return over(values, 'reactions', 'Remove some')
        if (names.signal) return `uses '${names.signal}', which is a number, not something that turns on and off. Pick another signal`
        if (names.on) return `plays on '${names.on}', which the game doesn't know. Pick While, Start, Stop or Appear`
        return "isn't set up right. Pick a signal, when it plays, and what it does"
    },
    reaction_signal_unknown: (_, names) => `uses ${quoted(names, 'signal', 'a signal')}, which the game doesn't have. Pick one from the list`,
    reaction_missing: (_, names) => {
        if (names.play) return `plays '${names.play}', which isn't an animation in this project. Pick another one`
        if (names.palette) return `switches to colorway '${names.palette}', which doesn't exist. Pick another one`
        if (names.effect) return `starts effect '${names.effect}', which doesn't exist. Pick another one`
        return 'uses something that no longer exists. Pick it again'
    },
    attach_invalid: (_, names) => (names.rig ? `can't replace a part of the ${quoted(names, 'rig', '')} rig. Clear Replaces part, or pick a boat, minecart or horse` : "has attach settings the game can't read. Set them again in Settings"),
    replacement_unknown: (_, names) => `replaces ${quoted(names, 'item', 'a part')}, which the ${quoted(names, 'rig', 'chosen')} rig doesn't have. Pick another part`,
    rig_unknown: (_, names) => `uses rig ${quoted(names, 'rig', '')}, which the game doesn't have. Pick another one`,
    attach_bone_unknown: (_, names) => `sticks to ${quoted(names, 'bone', 'a part')}, which the ${quoted(names, 'rig', 'chosen')} rig doesn't have. Pick another one`,
    asset_kind_unsupported: (_, names) => `is a ${names.kind ?? 'kind of'} bundle, which this format can't make. Start a project in the matching format`,
    geometry_missing: () => 'needs a model. Add at least one cube',
    geometry_invalid: (_, names) => (names.locator ? `has locator '${names.locator}' twice, or with settings the game can't read. Rename or remove it` : "has a model the game can't read. Export it again"),
    animations_invalid: (_, names) => (names.error ? "has animations the game can't read. Check them in the Animate tab" : 'needs at least one animation. Add one in the Animate tab'),
    texture_index_invalid: (_, names) => `paints ${quoted(names, 'texture', 'a picture')} with palette colors, but the palette is off. Add a color, or turn off palette painting for it`,
    texture_index_size: () => "has a palette map that isn't the size of its picture. Export it again",
    palette_shade_shared: (_, names) => (names.first && names.first === names.second
        ? `has shade ${quoted(names, 'color', '')} twice in '${names.first}'. Change one of them`
        : `has shade ${quoted(names, 'color', '')} in both ${quoted(names, 'first', 'one color')} and ${quoted(names, 'second', 'another')}. Change one of them`),
    palette_tones_over: (values, names) => `has ${number(values, 'count') ?? 'too many'} shades in ${quoted(names, 'slot', 'one color')}, and that color can have up to ${number(values, 'limit') ?? 'fewer'}. Remove some shades`,
    palette_slot_missing: (_, names) => `uses palette color ${quoted(names, 'slot', '')}, which was removed. Pick another color for it`,
    texture_path_taken: (_, names) => `saves to the same file as texture ${quoted(names, 'texture', '')}. Rename the texture or the effect picture`,
    model_textures_extra: (values) => `has ${number(values, 'count') ?? 'more than one'} textures, but the game only uses one. Delete the extras`,
    model_texture_missing: () => "has no texture, so it won't show in game. Add one in the Textures panel",
    texture_index_off_palette: (values) => `has a pixel at ${number(values, 'x') ?? '?'}, ${number(values, 'y') ?? '?'} that isn't a palette color. Paint it with a palette color, or add it to Fixed colors`,
    palette: (values) => {
        const x = number(values, 'x')
        const y = number(values, 'y')
        if (x !== null && y !== null) return `has a pixel at ${x}, ${y} painted with a shade the palette doesn't have. Paint it again with a palette color`
        const slot = number(values, 'slot')
        if (slot !== null && number(values, 'limit') !== null) return `has ${number(values, 'count') ?? 'too many'} shades in color ${slot + 1}, and that color can have up to ${number(values, 'limit')}. Remove some shades`
        return number(values, 'limit') !== null ? over(values, 'colors', 'Remove some') : ''
    },
    texture: (values) => (number(values, 'index') !== null ? "has a palette map that isn't the size of its picture. Export it again" : ''),
    manifest: (_, names) => (names.capability ? `needs '${names.capability}' in its feature list. Export it again` : ''),
    controller_invalid: (_, names) => (names.key ? `has a setting the game doesn't know, '${names.key}'. Remove it` : "can't be read. Check it in the controller editor"),
    animation: (_, names) => (names.key === 'anim_time_update' ? "sets its own speed with 'anim_time_update', which only works when an animation controller plays it. Play it from a controller or remove it" : ''),
    controller_unsupported: (_, names) => (names.key ? `uses '${names.key}', which cosmetics don't support. Remove it` : "uses something cosmetics don't support. Remove it"),
    controller_too_many_states: (values) => over(values, 'states', 'Merge some states'),
    controller_too_many_controllers: (values) => over(values, 'controllers', 'Merge some controllers'),
    controller_server_side: (_, names) => (names.query ? `reads '${names.query}', which only servers know. Use a signal instead` : 'reads something only servers know. Use a signal instead'),
    controller_unknown_state: (_, names) => `goes to state ${quoted(names, 'state', '')}, which doesn't exist. Pick another one`,
    controller_molang_invalid: () => "has a condition or script that can't be read. Check the formula",
    controller_missing: (_, names) => `runs ${quoted(names, 'controller', 'a controller')}, which isn't in this project. Add it, or remove it from Settings`,
    controller_unknown_animation: (_, names) => `plays ${quoted(names, 'animation', 'an animation')}, which isn't in this project. Pick another one`,
}

const PET_PHRASES: Record<string, Phrase> = {
    pet_invalid: (_, names) => {
        if (names.anchor) return `sits on '${names.anchor}', which only works for pets that sit on a shoulder, on a part the player has. Pick another one`
        if (names.interaction) return `lists '${names.interaction}' without saying whether the pet starts it or joins in. Pick one`
        if (names.role) return `gives a role the game doesn't know, '${names.role}'. Pick Starts it or Joins in`
        return "has pet settings the game can't read. Set them again in Settings"
    },
    pet_archetype_unknown: (_, names) => `moves as ${quoted(names, 'archetype', 'something')}, which the game doesn't know. Pick Walks, Flies or Sits on a shoulder`,
    pet_field_range: (values) => `is set to ${number(values, 'value') ?? 'a value'}, and it must be more than 0. Set it again`,
    pet_scale_range: (values) => {
        const min = number(values, 'min')
        const max = number(values, 'max')
        const range = min !== null && max !== null ? `from size ${min} to ${max}` : 'in a set size range'
        return `set the size to ${number(values, 'value') ?? 'a value'}, but the game only shows pets ${range}, so it uses ${number(values, 'kept') ?? 'the nearest one'}. Pick a size in that range`
    },
    pet_interaction_unknown: (_, names) => `does ${quoted(names, 'interaction', 'something')} with other pets, which the game doesn't know. Remove it`,
    pet_legacy_invalid: (_, names) => `has an old ${quoted(names, 'file', 'pet file')} that can't be read. Make the pet again in this format`,
    pet_plain_query: (_, names) => `reads ${quoted(names, 'query', 'a signal')}, which means the owner's signal. Write ${names.owner ? `'query.${names.owner}'` : 'the owner form'} to make that clear`,
}

const SOUND_CODECS: Record<string, string> = {
    opus: 'Ogg Opus',
    flac: 'Ogg FLAC',
    speex: 'Ogg Speex',
}

const EFFECT_FEATURES: Record<string, string> = {
    particle_script: 'runs a script for each particle',
    emitter_script: 'runs a script when it starts',
    changes_over_age: 'changes a value as particles age',
    expression: 'uses a formula where only a number works',
    spin: 'spins its particles',
    events: 'fires events',
    collision: 'bumps into blocks',
    custom_shape: 'spawns from a custom shape',
    component: "has a part the game doesn't know",
    facing: 'faces the camera in an unusual way',
    expiration: 'ends particles early with a formula',
    curves: 'uses curves',
}

const EFFECT_PARTS: Record<string, string> = {
    emitter_rate: "doesn't say how its particles spawn. Set Spawns in the particle settings",
    particle_lifetime_expression: "doesn't say how long each particle lives. Set it in the particle settings",
    particle_motion: 'moves its particles two ways at once. Keep only one kind of motion',
}

const TRAIL_SETTINGS: Record<string, string> = {
    texture: 'picture',
    blend: 'blend',
    width: 'width',
    fade: 'fade',
    min_speed: 'minimum speed',
    while: 'Only while',
}

const EFFECT_PHRASES: Record<string, Phrase> = {
    effect_invalid: (values, names) => {
        if (names.component) return EFFECT_PARTS[names.component] ?? `is missing part '${names.component}'. Add it in the particle settings`
        if (names.material) return `uses material '${names.material}', which the game can't draw. Pick Normal or Glow`
        if (number(values, 'limit') !== null) return `fires more Minecraft particles at once than the limit of ${number(values, 'limit')}. Use fewer`
        return "has particle or sound settings the game can't read. Check them in Effects"
    },
    effect_unsupported: (_, names) => `${EFFECT_FEATURES[names.feature ?? ''] ?? 'uses something'}, which cosmetics can't do. Remove it from the particle file`,
    effect_missing: () => 'uses an effect that no longer exists. Pick another one',
    effect_too_long: (values, _names, path) => `lasts longer than ${number(values, 'limit') ?? 'the limit of'} seconds, the most it can.${path.includes('#effects.') ? ' Its animation must not loop, and its start delay counts too, so use a number or a formula without variables or queries.' : ''} Make it shorter`,
    effect_clips_too_many: (values) => `can play ${number(values, 'clips') ?? 'too many'} animations with particles or sounds at once, more than the limit of ${number(values, 'limit') ?? 'the game'}. Put the effects on fewer animations`,
    effect_runs_too_many: (values) => `fires its particles so often that ${number(values, 'runs') ?? 'too many'} bursts are alive at once, more than the limit of ${number(values, 'limit') ?? 'the game'}. The oldest ones disappear early. Fire it less often or give the particles a shorter life`,
    effect_event_unknown: (_, names) => `fires ${quoted(names, 'effect', 'something')}, which isn't an effect or a sound in this project. Pick one from Effects`,
    particle_missing: (_, names) => (names.particle ? `uses particles '${names.particle}', which don't exist. Pick others in Effects` : "has a particle file that can't be read. Check it in Effects"),
    particle_texture_missing: (_, names) => `needs ${quoted(names, 'file', 'a picture')}, which is missing. Pick a picture in Effects`,
    sound_missing: (_, names) => (names.sound ? `plays '${names.sound}', which isn't a sound in this project. Pick another one` : 'needs a sound file. Load an .ogg in Effects'),
    sound_not_allowed: (_, names) => `plays Minecraft sound ${quoted(names, 'sound', '')}, which cosmetics can't use. Pick another one`,
    sound_unsupported: (_, names) => {
        const codec = SOUND_CODECS[names.codec ?? '']
        return `uses ${quoted(names, 'file', 'a sound file')}, ${codec ? `saved as ${codec}, which Minecraft can't play` : "which isn't an Ogg Vorbis file Minecraft can play"}. Export it as Ogg Vorbis`
    },
    sound_too_long: (values, names) => `uses ${quoted(names, 'file', 'a sound file')}, which runs ${seconds(number(values, 'seconds'))} seconds. Sounds can be ${number(values, 'limit') ?? 'a few'} seconds at most. Make it shorter`,
    sound_too_big: (_, names) => `uses ${quoted(names, 'file', 'a sound file')}, which is too big to play. Make it shorter, or export it at a lower sample rate or in mono`,
    sound_rate_unsupported: (values, names) => `uses ${quoted(names, 'file', 'a sound file')}, ${rateOf(number(values, 'rate'))}. Sounds can be ${kilohertz(number(values, 'limit') ?? 96000)} at most. Export it at 48 kHz or lower`,
    sound_channels_unsupported: (values, names) => `uses ${quoted(names, 'file', 'a sound file')}, which has ${number(values, 'channels') ?? 'too many'} channels. Sounds can only be mono or stereo. Export it in mono or stereo`,
    vanilla_particle_not_allowed: (_, names) => `uses Minecraft particles ${quoted(names, 'particle', '')}, which cosmetics can't use. Pick others`,
    locator_missing: (_, names) => `uses locator ${quoted(names, 'locator', '')}, which isn't on the model or the player. Add it, or pick another one`,
    trail_invalid: (_, names) => {
        if (names.signal) return `only shows while '${names.signal}', which the game doesn't have. Pick another signal`
        if (names.key) return `has a ${TRAIL_SETTINGS[names.key] ?? 'setting'} the game can't use. Set it again`
        return "has settings the game can't read. Set them again in Effects"
    },
    emitter_particles_over_budget: (values) => over(values, 'particles alive at once from one emitter', 'Spawn fewer, or let them live shorter'),
    cosmetic_particles_over_budget: (values) => over(values, 'particles alive at once', 'Spawn fewer, or let them live shorter'),
    trail_points_over_budget: (values) => over(values, 'trail points', 'Use fewer or shorter trails'),
}

function labelOf(labels: Readonly<Record<string, string>>, key: string | undefined): string | null {
    return key !== undefined && Object.hasOwn(labels, key) ? labels[key] : null
}

function playsAs(names: IssueNames): string {
    const role = labelOf(ROLE_LABELS, names.id) ?? names.id ?? ''
    const interaction = labelOf(INTERACTION_LABELS, names.interaction) ?? `'${names.interaction ?? ''}'`
    return `'${role}' for ${interaction}`
}

function roleInvalid(names: IssueNames, path: string): string {
    if (names.interaction === '' && path.endsWith('.interaction')) return "doesn't say how the pet plays. Pick one in Roles"
    if (names.interaction !== undefined && path.endsWith('.interaction')) return `plays '${names.interaction}' with other pets, which the game doesn't know. Pick one in Roles`
    if (names.interaction !== undefined && !labelOf(ROLE_LABELS, names.id)) return names.id ? `has role '${names.id}', which pets don't have. Pick Starts it or Joins in` : 'has no role. Pick Starts it or Joins in'
    if (names.interaction !== undefined) return `is ${playsAs(names)}, which the pet doesn't do. Turn it on in Settings, or remove the role`
    if (names.id) return `has role '${names.id}', which isn't set up right. Use Starts it or Joins in, with numbers for where it stands`
    return "can't be read. Set the roles again in Roles"
}

const EMOTE_PHRASES: Record<string, Phrase> = {
    role_invalid: (_, names, path) => roleInvalid(names, path),
    role_unknown: (_, names) => `uses role ${quoted(names, 'id', '')}, which the emote doesn't have. Pick Starts it or Joins in`,
    role_duplicate: (_, names) => (names.interaction !== undefined ? `is ${playsAs(names)} more than once. Keep one` : `has role ${quoted(names, 'id', '')} twice. Give each player a different role`),
    roles_too_many: (values) => ((number(values, 'limit') ?? 0) > MAX_ROLES ? over(values, 'roles', 'A pet takes each role once per way it plays. Remove the extra roles') : over(values, 'roles', 'A duo emote has two players. Remove the extra roles')),
    role_animation_missing: (_, names) => (names.animation ? `plays '${names.animation}', which isn't an animation in this project. Pick another one` : 'needs an animation. Pick one in Roles'),
    emote_rules_invalid: (_, names, path) => {
        if (path.endsWith('#requirement')) return "needs a spot the game doesn't know. Pick Open ground, A ledge or A wall in Settings"
        if (path.endsWith('#main')) return names.animation ? `has '${names.animation}' as its main animation, but that isn't an animation in this project or it's also the backup. Pick another one in Settings` : "has a main animation the game can't read. Pick it again in Settings"
        if (path.endsWith('#fallback')) return names.animation ? `plays '${names.animation}' when there's no spot, but that isn't an animation in this project. Pick another one in Settings` : "has a backup animation the game can't read. Pick it again in Settings"
        return "has rules the game can't read. Set them again in Settings"
    },
    emote_main_unnamed: (values, names) => {
        const guess = names.animation ? `, so the game would guess '${names.animation}'` : ''
        return `has ${number(values, 'clips') ?? 'several'} animations but doesn't say which one is the main one${guess}. Pick a Main animation in Settings`
    },
}

const PHRASES: Record<string, Phrase> = {
    missing_file: (_, names) => (names.file ? `needs '${names.file}', which is missing` : 'missing'),
    json_invalid: () => 'not valid JSON',
    json_too_large: (values) => `larger than ${number(values, 'limit') ?? 'the limit of'} bytes`,
    json_too_deep: (values) => `nested deeper than ${number(values, 'limit') ?? 'the limit'}`,
    png_invalid: () => "can't be read as a PNG picture",
    texture_too_large: (values) => `is ${number(values, 'width')}x${number(values, 'height')} px, the limit is ${number(values, 'limit')} px each way`,
    texture_not_power_of_two: (values) => `is ${number(values, 'width')}x${number(values, 'height')} px, each side must be 1, 2, 4, 8, 16, 32 and so on`,
    kind_unknown: (_, names) => `'${names.kind ?? ''}' is not a cosmetic type this plugin makes`,
    id_invalid: () => 'must be 1 to 64 of a-z, 0-9 and _',
    mask: (_, names) => (names.layer ? `'${names.layer}' can't clip this layer` : ''),
    molang_unknown_param: (_, names) => (names.param ? `no param '${names.param}'` : ''),
    node_param: (_, names) => (names.param ? `no param '${names.param}'` : ''),
    node_sprite: (_, names) => (names.sprite ? `no sprite '${names.sprite}'` : ''),
    group: (_, names) => (names.group ? `no group '${names.group}'` : ''),
    letter_readable: (values) => {
        const frames = number(values, 'frames')
        const of = number(values, 'of')
        const rest = 'Let the letters rest for at least half of the loop'
        return frames === null || of === null ? `the name is hard to read for most of the loop. ${rest}` : `the name is easy to read in only ${frames} of ${of} frames. ${rest}`
    },
    zip_invalid: () => "isn't a zip the game can read. Export it again",
    download_too_large: (values) => `is ${size(number(values, 'bytes'))} as a zip, and the game downloads at most ${size(number(values, 'limit'))}. Use fewer or smaller pictures`,
    too_many_entries: (values) => `has ${number(values, 'entries') ?? 'too many'} files and folders, and the game reads at most ${number(values, 'limit') ?? 'a set number'}. Use fewer layers or pictures`,
    unpacked_too_large: (values) => `unpacks to more than ${size(number(values, 'limit'))}, the most the game reads. Use fewer or smaller pictures`,
    file_too_large: (values, names, path) => `has ${fileName(names, path)} over ${size(number(values, 'limit'))}, so the game skips it. Use a smaller picture or fewer frames`,
    unsafe_entry_name: (_, names, path) => `has a file named ${fileName(names, path)}, which the game won't open. Export it again`,
    entry_unreadable: (_, names, path) => `has ${fileName(names, path)}, which can't be read. Export it again`,
    manifest_not_object: () => "has a settings file the game can't read. Export it again",
    format_missing: () => "doesn't say which format it uses. Export it again",
    format_invalid: (values) => {
        const format = number(values, 'format')
        return format === null ? "has a format the game can't read. Export it again" : `uses format ${format}, which this version of the game can't read. Update PolyPlus, or export it again`
    },
    requires_invalid: () => "lists the features it needs in a way the game can't read. Export it again",
    kind_missing: () => "doesn't say what kind of cosmetic it is. Export it again",
    id_missing: () => 'is missing. Type an ID in Nameplate settings',
    unknown_key: (_, names) => (names.key ? `has a setting the game doesn't know, '${names.key}'. Remove it, or update the plugin` : "has a setting the game doesn't know. Remove it, or update the plugin"),
    bad_path: (_, names, path) => `points to ${fileName(names, path)}, which isn't a file the game can open. Pick the file again`,
    unreferenced_file: (_, names, path) => `has ${fileName(names, path)}, which nothing uses. Remove it to make the download smaller`,
    wearer_record_over_budget: (values) => over(values, 'bytes of memory per player', 'Use fewer reactions, one-shots or formula variables'),
    wearer_variables_over_budget: (values) => over(values, 'formula variables per player', 'Use fewer v. variables'),
    wearer_one_shots_over_budget: (values) => over(values, 'one-shots', 'Remove some, or merge them'),
    molang_nodes_over_budget: (values) => over(values, 'parts', 'Make the formula shorter'),
    over_fallback: (values) => `keeps ${size(number(values, 'bytes'))} of pictures for basic effects, and the limit is ${size(number(values, 'limit'))}. Use fewer frames or smaller effect layers`,
    colorway_tones: (values, names) => {
        const slot = names.slot ? `color '${names.slot}'` : 'a color'
        const has = number(values, 'colorway_tones') ?? number(values, 'tones')
        const needs = names.use ? number(values, 'tones') : number(values, 'base')
        const who = names.use ? `'${names.use}' uses ${needs ?? 'a different number'}` : `the main colors have ${needs ?? 'a different number'}`
        return `gives ${slot} ${has ?? 'a different number of'} shades, but ${who}. Give it the same number of shades`
    },
    variant_flag_missing: () => 'uses a flag that no longer exists. Pick another one',
    background_without_body: () => 'takes over the background, but the nameplate has no body. Add a body layer, or turn this off',
    flag_unfit: (values, names) => {
        const width = number(values, 'width')
        const height = number(values, 'height')
        const room = width !== null && height !== null ? `, which has ${width}x${height} px for it` : ''
        const where = names.layer ? ` on layer '${names.layer}'` : ''
        const variant = names.variant ? ` in variant '${names.variant}'` : ''
        return `doesn't fit${where}${variant}${room}. Use fewer bands, or make the layer bigger`
    },
    art_outside_window: (values, names) => `reaches past the area the game draws${drawnArea(values)}${names.variant ? ` in variant '${names.variant}'` : ''}, so part of it is cut off. Move it closer to the body`,
    flash_unchecked: (values) => `has too much changing at once for the flash check to finish. It checked ${number(values, 'checked') ?? 'some'} of ${number(values, 'scenarios') ?? 'its'} cases, so it can't be exported. Use fewer or smaller layers that change, or a shorter loop`,
    dialect_unsupported: (_, names) => `uses ${nodeWord(names.node)}, which some graphics cards can't run. Use a different node`,
    corners_both: () => 'sets both Corner roundness and Corner shape. Keep only one',
    molang: () => "can't be read. Check the formula",
    molang_empty: () => 'is empty. Type a number or a formula',
    molang_unexpected: () => 'has something out of place. Check the brackets and signs',
    molang_too_long: (values) => `is too long${number(values, 'limit') === null ? '' : `: the limit is ${number(values, 'limit')} characters`}. Make it shorter`,
    molang_too_deep: () => 'has too many brackets inside brackets. Make it simpler',
    molang_too_big: () => 'has too many parts. Make it shorter',
    molang_unterminated: () => 'has a quote that is never closed. Add the closing quote',
    molang_character: () => "has a character formulas can't use. Remove it",
    molang_string: () => "uses text in quotes, which only works inside q.variant_param('name')",
    molang_value: () => 'needs a number or a name where it has something else',
    molang_uncalled: () => 'names a function without brackets. Add ( ) after it',
    molang_unknown_name: () => "uses a name the nameplate doesn't know. Queries start with q., functions with math., your own variables with v. or t.",
    molang_not_query: () => "uses q. with something that isn't a query",
    molang_unknown_query: () => "uses a query the nameplate doesn't have. Type q. to see the list",
    molang_query_place: () => "uses a query that doesn't work here. Type q. to see the ones that do",
    molang_assign: () => "gives a value to something that isn't a v. or t. variable",
    molang_variable_name: () => 'needs a variable name after v. or t.',
    molang_variables: () => 'uses too many variables. Use fewer',
    molang_unknown_function: () => "calls a function that doesn't exist. Functions start with math.",
    molang_unknown_math: () => "uses a math. function the nameplate doesn't have. Type math. to see the list",
    molang_param_call: () => "needs one name in quotes inside q.variant_param, like q.variant_param('speed')",
    molang_arguments: () => 'gives a function the wrong number of values',
    molang_cost: (values) => {
        const cost = number(values, 'cost')
        const limit = number(values, 'limit')
        const amount = cost !== null && limit !== null ? `: ${cost} work a frame, and the limit is ${limit}` : ''
        return `does too much work${amount}. Make it shorter, or use fewer math.noise and math.fbm calls`
    },
    molang_constant: () => 'always gives the same value. Type the number instead',
    molang_unknown_root: () => "starts with a name formulas can't use. Use q., math., v. or t.",
    molang_unsupported: () => "uses something nameplate formulas don't support. Remove it",
    ...ITEM_PHRASES,
    ...PET_PHRASES,
    ...EFFECT_PHRASES,
    ...EMOTE_PHRASES,
}

function limitPhrase(values: IssueValues): string {
    const limit = number(values, 'limit')
    if (limit === null) return ''
    for (const name of COUNTED) {
        const value = number(values, name)
        if (value !== null) return `has ${value}, the limit is ${limit}`
    }
    return ''
}

function rangePhrase(values: IssueValues): string {
    const min = number(values, 'min')
    const max = number(values, 'max')
    return min !== null && max !== null ? `must be ${min} to ${max}` : ''
}

export function issueMessage(code: string, values: IssueValues, names: IssueNames, path = ''): string {
    const phrase = PHRASES[code]
    const text = phrase ? phrase(values, names, path) : ''
    return text || limitPhrase(values) || rangePhrase(values)
}

function frozenEntries<T>(raw: unknown, accept: (value: unknown) => value is T): Readonly<Record<string, T>> {
    const entries: Record<string, T> = {}
    if (raw && typeof raw === 'object') {
        for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
            if (accept(value)) entries[name] = value
        }
    }
    return Object.freeze(entries)
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isString = (value: unknown): value is string => typeof value === 'string'

export function wrapIssue(raw: RawIssue): EngineIssue {
    const level = String(raw.level ?? '')
    const code = raw.code ? String(raw.code) : undefined
    const values = frozenEntries(raw.values, isFiniteNumber)
    const names = frozenEntries(raw.names, isString)
    const path = String(raw.path ?? '')
    return {
        path,
        message: code ? issueMessage(code, values, names, path) : '',
        code,
        level: LEVELS.has(level) ? (level as IssueLevel) : undefined,
        values,
        names,
    }
}

export function issuesOf(raw: ArrayLike<RawIssue> | null | undefined): EngineIssue[] {
    return Array.from(raw ?? []).map(wrapIssue)
}

export function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
