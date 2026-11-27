import { toBase64 } from '../material/png'
import { sanitizeId, uniqueId } from '../palette/ids'
import { cloneJson, isRecord } from '../util/json'
import { hasProject } from '../util/project'
import { EffectsData, EmitterData, MOMENTS, normalizeCosmetic, ParticleData, PLAYER_LOCATORS, TRAIL_EVENT_GATES } from './data'
import { switchSignals } from './dialogs'
import { applyParticleFields, FACING_MODES, molangList, particleFields, ParticleFields, particleStarter, soundPitch, soundVolume, storedParticle } from './effects'
import { signalLabel } from './preview'
import { keptIds, projectTargets, resolveReferences, setTargetIds, stampReferences, targetIds } from './references'
import { commitCosmetic, isCosmeticActive, readCosmetic } from './state'
import { addTo, PANEL_BUTTONS } from './registry'
import { defineAction } from '../util/actions'

const DIALOG_ID = 'polyplus_cosmetic_effects'
const PARTICLE_DIALOG = 'polyplus_cosmetic_particle'

function locatorNames(): string[] {
    const own = typeof Locator === 'undefined' ? [] : Locator.all.map((locator) => locator.name)
    return Array.from(new Set([...PLAYER_LOCATORS, ...own]))
}

function readFile(extensions: string[], type: string, done: (name: string, bytes: Uint8Array) => void) {
    Blockbench.import({ extensions, type, readtype: 'binary' } as any, (files: any[]) => {
        for (const file of files ?? []) {
            const content = file.content
            const bytes = content instanceof ArrayBuffer ? new Uint8Array(content) : content instanceof Uint8Array ? content : null
            if (bytes) done(String(file.name ?? 'file').replace(/\.[^.]+$/, ''), bytes)
        }
    })
}

function readText(extensions: string[], type: string, done: (name: string, text: string) => void) {
    Blockbench.import({ extensions, type, readtype: 'text' } as any, (files: any[]) => {
        for (const file of files ?? []) if (typeof file.content === 'string') done(String(file.name ?? 'file').replace(/\.[^.]+$/, ''), file.content)
    })
}

type Field = [key: keyof ParticleFields | string, label: string, type: string, extra?: Record<string, unknown>]

const FIELDS: Field[] = [
    ['blend', 'Blend', 'select', { options: { alpha: 'Normal', additive: 'Glow' } }],
    ['rate', 'Spawns', 'select', { options: { instant: 'All at once', steady: 'Steadily', manual: 'Only when fired' } }],
    ['count', 'How many', 'number', { min: 1, condition: (f: any) => f.rate === 'instant' }],
    ['perSecond', 'Per second', 'number', { min: 0, condition: (f: any) => f.rate === 'steady' }],
    ['max', 'At most alive', 'number', { min: 1, condition: (f: any) => f.rate !== 'instant' }],
    ['lifetime', 'Emitter runs', 'select', { options: { once: 'Once', looping: 'In a loop', expression: 'While its formula is true' } }],
    ['active', 'For (s)', 'number', { min: 0, step: 0.1, condition: (f: any) => f.lifetime !== 'expression' }],
    ['sleep', 'Then waits (s)', 'number', { min: 0, step: 0.1, condition: (f: any) => f.lifetime === 'looping' }],
    ['shape', 'Spawns from', 'select', { options: { point: 'A point', sphere: 'A sphere', box: 'A box', disc: 'A disc', entity_aabb: "The wearer's body" } }],
    ['radius', 'Radius', 'number', { min: 0, step: 0.05, condition: (f: any) => f.shape === 'sphere' || f.shape === 'disc' }],
    ['box', 'Half size', 'vector', { dimensions: 3, condition: (f: any) => f.shape === 'box' }],
    ['surface', 'Only the surface', 'checkbox', { condition: (f: any) => f.shape !== 'point' }],
    ['direction', 'Moves', 'select', { options: { outwards: 'Outwards', inwards: 'Inwards' } }],
    ['world', 'Stays behind when the wearer moves', 'checkbox'],
    ['speed', 'Start speed', 'text'],
    ['acceleration', 'Acceleration', 'text'],
    ['drag', 'Drag', 'text'],
    ['life', 'Each lives for (s)', 'text'],
    ['size', 'Size', 'text'],
    ['facing', 'Faces', 'select', { options: Object.fromEntries(FACING_MODES.map((mode) => [mode, mode])) }],
    ['color', 'Tint', 'text', { placeholder: '#FFFFFF' }],
    ['uvSize', 'Picture size', 'vector', { dimensions: 2 }],
    ['uv', 'Frame start', 'vector', { dimensions: 2 }],
    ['uvRegion', 'Frame size', 'vector', { dimensions: 2 }],
]

function molang(text: unknown): number | string {
    const value = String(text ?? '').trim()
    const number = Number(value)
    return value !== '' && Number.isFinite(number) ? number : value || 0
}

export function openParticleDialog(particle: ParticleData, done: (next: ParticleData) => void) {
    const fields = particleFields(particle.json)
    const form: Record<string, unknown> = {}
    for (const [key, label, type, extra] of FIELDS) {
        let value: unknown = (fields as any)[key]
        if (type === 'text' && Array.isArray(value)) value = value.join(', ')
        if (type === 'text' && typeof value === 'number') value = String(value)
        form[key] = { label, type, value, ...(extra ?? {}) }
    }
    new Dialog({
        id: PARTICLE_DIALOG,
        title: `Particles: ${particle.id}`,
        width: 520,
        form: form as any,
        onConfirm(result: any) {
            const next: ParticleFields = {
                ...fields,
                ...result,
                count: Number(result.count) || 1,
                perSecond: Number(result.perSecond) || 0,
                max: Number(result.max) || 1,
                active: Number(result.active) || 0,
                sleep: Number(result.sleep) || 0,
                radius: Number(result.radius) || 0,
                speed: molang(result.speed),
                acceleration: molangList(result.acceleration, 3) as ParticleFields['acceleration'],
                drag: molang(result.drag),
                life: molang(result.life),
                size: molangList(result.size, 2) as ParticleFields['size'],
                color: String(result.color ?? '').trim().toUpperCase(),
            }
            done({ ...particle, json: applyParticleFields(particle.json, next) })
        },
    } as any).show()
}

interface Row extends EmitterData {
    key: number
    kind: 'particle' | 'sound' | 'vanilla'
    particleKey: number | null
    soundKey: number | null
}

interface Keyed {
    key: number
    from: string | null
}

function keyOf(list: readonly Keyed[], name: string): number | null {
    return name ? list.find((item) => item.from === name)?.key ?? null : null
}

function rowOf(emitter: EmitterData, key: number, particles: readonly Keyed[], sounds: readonly Keyed[]): Row {
    return {
        ...emitter,
        key,
        kind: emitter.sound ? 'sound' : emitter.vanilla ? 'vanilla' : 'particle',
        particleKey: keyOf(particles, emitter.particle),
        soundKey: keyOf(sounds, emitter.sound),
    }
}

function emitterOf(row: Row, particles: ReadonlyMap<number, string>, sounds: ReadonlyMap<number, string>): EmitterData {
    const picked = (ids: ReadonlyMap<number, string>, key: number | null, name: string) => (key !== null ? ids.get(key) : undefined) ?? name
    return {
        particle: row.kind === 'particle' ? picked(particles, row.particleKey, row.particle) : '',
        sound: row.kind === 'sound' ? picked(sounds, row.soundKey, row.sound) : '',
        vanilla: row.kind === 'vanilla' ? row.vanilla : '',
        locator: row.locator,
        count: Math.max(1, Math.round(Number(row.count) || 1)),
    }
}

function sharedId(names: ReadonlyArray<string>, fallback: string): string | null {
    const seen = new Set<string>()
    for (const name of names) {
        const id = sanitizeId(name) || fallback
        if (seen.has(id)) return id
        seen.add(id)
    }
    return null
}

const SHARED_NAMES: Array<{ tab: string, noun: string, names: (state: { particles: Array<{ id: string }>, sounds: Array<{ id: string }>, named: Array<{ name: string }> }) => string[], fallback: string }> = [
    { tab: 'particles', noun: 'particles', names: (state) => state.particles.map((particle) => particle.id), fallback: 'particles' },
    { tab: 'sounds', noun: 'sounds', names: (state) => state.sounds.map((sound) => sound.id), fallback: 'sound' },
    { tab: 'named', noun: 'effects', names: (state) => state.named.map((item) => item.name), fallback: 'effect' },
]

export interface EffectRenames {
    effects: ReadonlyMap<string, string>
    sounds: ReadonlyMap<string, string>
}

interface EffectReference {
    target: { effect: string }
    to: string
}

export interface EffectReferences {
    animations: any[]
    controllers: any[]
    apply(): void
}

function renamed(map: ReadonlyMap<string, string>, name: string): string | null {
    const to = map.get(name)
    return to !== undefined && to !== name ? to : null
}

function particleRename(renames: EffectRenames, name: string): string | null {
    return renamed(renames.effects, name)
}

function soundRename(renames: EffectRenames, name: string): string | null {
    return renames.sounds.has(name) ? renamed(renames.sounds, name) : renamed(renames.effects, name)
}

function collect(out: EffectReference[], targets: unknown, rename: (name: string) => string | null): boolean {
    let found = false
    for (const target of Array.isArray(targets) ? targets : []) {
        if (!isRecord(target) || typeof target.effect !== 'string') continue
        const to = rename(target.effect)
        if (to === null) continue
        out.push({ target: target as { effect: string }, to })
        found = true
    }
    return found
}

function keyframePoints(keyframes: unknown): unknown[] {
    return (Array.isArray(keyframes) ? keyframes : []).flatMap((keyframe) => (isRecord(keyframe) && Array.isArray(keyframe.data_points) ? keyframe.data_points : []))
}

export function effectReferences(renames: EffectRenames): EffectReferences {
    const references: EffectReference[] = []
    const animations: any[] = []
    const controllers: any[] = []
    const allAnimations: any[] = typeof Animator !== 'undefined' ? Animator.animations ?? [] : []
    for (const animation of allAnimations) {
        const effects = animation?.animators?.effects
        if (!effects) continue
        const particles = collect(references, keyframePoints(effects.particle), (name) => particleRename(renames, name))
        const sounds = collect(references, keyframePoints(effects.sound), (name) => soundRename(renames, name))
        if (particles || sounds) animations.push(animation)
    }
    const allControllers: any[] = typeof AnimationController !== 'undefined' ? (AnimationController as any).all ?? [] : []
    for (const controller of allControllers) {
        let found = false
        for (const state of Array.isArray(controller?.states) ? controller.states : []) {
            if (collect(references, state?.particles, (name) => particleRename(renames, name))) found = true
            if (collect(references, state?.sounds, (name) => soundRename(renames, name))) found = true
        }
        if (found) controllers.push(controller)
    }
    return {
        animations,
        controllers,
        apply() {
            for (const { target, to } of references) target.effect = to
        },
    }
}

function referenceNames(channel: 'sound' | 'particle'): string[] {
    const out = new Set<string>()
    const add = (targets: unknown) => {
        for (const target of Array.isArray(targets) ? targets : []) if (isRecord(target) && typeof target.effect === 'string' && target.effect) out.add(target.effect)
    }
    const allAnimations: any[] = typeof Animator !== 'undefined' ? Animator.animations ?? [] : []
    for (const animation of allAnimations) add(keyframePoints(animation?.animators?.effects?.[channel]))
    const allControllers: any[] = typeof AnimationController !== 'undefined' ? (AnimationController as any).all ?? [] : []
    for (const controller of allControllers) for (const state of Array.isArray(controller?.states) ? controller.states : []) add(channel === 'sound' ? state?.sounds : state?.particles)
    return [...out]
}

export function soundReferenceNames(): string[] {
    return referenceNames('sound')
}

export function particleReferenceNames(): string[] {
    return referenceNames('particle')
}

export interface NamedRow {
    key: number
    from: string | null
    id: string
}

function retargetedSound(references: Iterable<string>, before: { sounds: readonly string[], named: readonly string[] }, sounds: readonly NamedRow[], named: readonly NamedRow[]): string | null {
    const identity = (kind: string, row: NamedRow) => (row.from === null ? `new:${kind}:${row.key}` : `${kind}:${row.from}`)
    for (const name of new Set(references)) {
        const was = before.sounds.includes(name) ? `sound:${name}` : before.named.includes(name) ? `effect:${name}` : null
        if (was === null) continue
        const own = was === `sound:${name}` ? sounds.find((row) => row.from === name) : named.find((row) => row.from === name)
        const next = own?.id ?? name
        const sound = sounds.find((row) => row.id === next)
        const effect = sound ? undefined : named.find((row) => row.id === next)
        const now = sound ? identity('sound', sound) : effect ? identity('effect', effect) : null
        if (now !== null && now !== was) return next
    }
    return null
}

function retargetedEffect(references: Iterable<string>, before: readonly string[], named: readonly NamedRow[]): string | null {
    for (const name of new Set(references)) {
        if (!before.includes(name)) continue
        const next = named.find((row) => row.from === name)?.id ?? name
        const now = named.find((row) => row.id === next)
        if (now && now.from !== name) return next
    }
    return null
}

function deletedSound(references: Iterable<string>, before: { sounds: readonly string[], named: readonly string[] }, sounds: readonly NamedRow[], named: readonly NamedRow[]): { name: string, kind: 'sound' | 'effect' } | null {
    for (const name of new Set(references)) {
        if (before.sounds.includes(name)) {
            if (!sounds.some((row) => row.from === name)) return { name, kind: 'sound' }
        } else if (before.named.includes(name) && !named.some((row) => row.from === name)) return { name, kind: 'effect' }
    }
    return null
}

function deletedEffect(references: Iterable<string>, before: readonly string[], named: readonly NamedRow[]): string | null {
    for (const name of new Set(references)) if (before.includes(name) && !named.some((row) => row.from === name)) return name
    return null
}

export interface PickRow {
    kind: string
    particleKey: number | null
    soundKey: number | null
}

function lostPick(rows: readonly PickRow[], particles: ReadonlySet<number>, sounds: ReadonlySet<number>): 'particle' | 'sound' | null {
    for (const row of rows) {
        if (row.kind === 'particle' && row.particleKey !== null && !particles.has(row.particleKey)) return 'particle'
        if (row.kind === 'sound' && row.soundKey !== null && !sounds.has(row.soundKey)) return 'sound'
    }
    return null
}

function lostPickMessage(owner: string, kind: 'particle' | 'sound'): string {
    const what = kind === 'particle' ? 'particles that were deleted' : 'a sound that was deleted'
    return `${owner} uses ${what}. Pick another one, or remove that row.`
}

export function openEffects(): Dialog | null {
    if (!hasProject()) return null
    const data = readCosmetic()
    const fx = cloneJson(data.effects)
    let next = 0
    const loadedAudio = new Map<number, string>()
    const particleRows = fx.particles.map((particle) => ({ ...particle, key: next++, from: particle.id as string | null }))
    const soundRows = fx.sounds.map((sound) => ({ ...sound, key: next++, from: sound.id as string | null, loaded: !!fx.audio[sound.id] }))
    const row = (emitter: EmitterData) => rowOf(emitter, next++, particleRows, soundRows)
    const state = {
        tab: 'particles',
        particles: particleRows,
        sounds: soundRows,
        named: Object.entries(fx.named).map(([name, emitters]) => ({ key: next++, from: name as string | null, name, rows: emitters.map(row) })),
        always: fx.emitters.map(row),
        trails: fx.trails.map((trail) => ({ ...trail, key: next++, widthStart: trail.width[0], widthEnd: trail.width[1] })),
        pictures: Object.keys(fx.pictures),
        locators: locatorNames(),
        slots: data.palette.slots.map((slot) => ({ id: slot.id, name: slot.name })),
        signals: [...switchSignals(), ...TRAIL_EVENT_GATES].map((name) => ({ name, label: signalLabel(name) })),
        moments: data.kind === 'effect' ? MOMENTS.filter((moment) => !(moment in fx.named)) : [],
        tabs: [['particles', 'Particles'], ['sounds', 'Sounds'], ['named', 'Effects'], ['always', 'Always on'], ['trails', 'Trails'], ['pictures', 'Pictures']],
    }
    const taken = (list: Array<{ id: string }>) => (id: string) => list.some((item) => item.id === id)
    const dialog: any = new Dialog({
        id: DIALOG_ID,
        title: 'Effects',
        width: 760,
        component: {
            data: () => state,
            methods: {
                addParticle() {
                    const id = uniqueId('sparkle', taken(state.particles))
                    state.particles.push({ ...particleStarter(id), key: next++, from: null })
                },
                importParticle() {
                    readText(['json'], 'Snowstorm particles', (name, text) => {
                        let json: unknown
                        try {
                            json = JSON.parse(text)
                        } catch {
                            Blockbench.showQuickMessage(`${name} isn't a particle file`, 2000)
                            return
                        }
                        if (!isRecord(json)) return
                        const id = uniqueId(sanitizeId(name) || 'particles', taken(state.particles))
                        state.particles.push({ ...storedParticle({ id, picture: '', json, tint: null }), key: next++, from: null })
                    })
                },
                editParticle(index: number) {
                    const particle = state.particles[index]
                    openParticleDialog(particle, (changed) => state.particles.splice(index, 1, { ...changed, key: particle.key, from: particle.from }))
                },
                addSound() {
                    state.sounds.push({ id: uniqueId('sound', taken(state.sounds)), file: '', vanilla: '', volume: 1, pitch: 1, key: next++, from: null, loaded: false })
                },
                loadSound(sound: any) {
                    readFile(['ogg'], 'Ogg sound', (_, bytes) => {
                        loadedAudio.set(sound.key, toBase64(bytes))
                        sound.loaded = true
                    })
                },
                addNamed(name?: string) {
                    const id = name ?? uniqueId('effect', (candidate) => state.named.some((item) => item.name === candidate))
                    state.named.push({ key: next++, from: null, name: id, rows: [] })
                    state.moments = state.moments.filter((moment) => moment !== id)
                },
                addRow(rows: Row[]) {
                    const first = state.particles[0]
                    rows.push({ ...rowOf({ particle: first?.id ?? '', sound: '', vanilla: '', locator: '', count: 1 }, next++, [], []), particleKey: first?.key ?? null })
                },
                addTrail() {
                    state.trails.push({ locator: 'back', picture: state.pictures[0] ?? '', blend: 'alpha', width: [0.25, 0.25], widthStart: 0.25, widthEnd: 0.25, tile: false, tint: { kind: 'color', color: '#FFFFFF' }, fade: 1, minSpeed: 0, while: ['is_gliding'], key: next++ } as any)
                },
                setTint(trail: any, kind: string) {
                    trail.tint = kind === 'slot' ? { kind, slot: state.slots[0]?.id ?? '', tone: 0 } : kind === 'gradient' ? { kind, stops: ['#FFFFFF', '#00FFFFFF'] } : { kind: 'color', color: '#FFFFFF' }
                },
                toggleGate(trail: any, name: string) {
                    const at = trail.while.indexOf(name)
                    if (at >= 0) trail.while.splice(at, 1)
                    else trail.while.push(name)
                },
                addPicture() {
                    readFile(['png'], 'PNG picture', (name, bytes) => {
                        const id = uniqueId(sanitizeId(name) || 'picture', (candidate) => candidate in fx.pictures)
                        fx.pictures[id] = toBase64(bytes)
                        state.pictures = Object.keys(fx.pictures)
                    })
                },
                removePicture(name: string) {
                    delete fx.pictures[name]
                    state.pictures = Object.keys(fx.pictures)
                },
                thumb(name: string): string {
                    return fx.pictures[name] ? `data:image/png;base64,${fx.pictures[name]}` : ''
                },
            },
            template: EFFECTS_TEMPLATE,
        },
        onConfirm() {
            for (const check of SHARED_NAMES) {
                const shared = sharedId(check.names(state), check.fallback)
                if (!shared) continue
                state.tab = check.tab
                Blockbench.showQuickMessage(`Two ${check.noun} are both named '${shared}'. Rename one of them.`, 3000)
                return false
            }
            const particleKeySet = new Set(state.particles.map((particle) => particle.key))
            const soundKeySet = new Set(state.sounds.map((sound) => sound.key))
            const lostAlways = lostPick(state.always, particleKeySet, soundKeySet)
            if (lostAlways) {
                state.tab = 'always'
                Blockbench.showQuickMessage(lostPickMessage('An always-on row', lostAlways), 4000)
                return false
            }
            for (const item of state.named) {
                const lost = lostPick(item.rows, particleKeySet, soundKeySet)
                if (!lost) continue
                state.tab = 'named'
                Blockbench.showQuickMessage(lostPickMessage(`Effect '${item.name}'`, lost), 4000)
                return false
            }
            const soundRefs = soundReferenceNames()
            const clash = retargetedSound(
                soundRefs,
                { sounds: fx.sounds.map((sound) => sound.id), named: Object.keys(fx.named) },
                state.sounds.map((sound) => ({ key: sound.key, from: sound.from, id: sanitizeId(sound.id) || 'sound' })),
                state.named.map((item) => ({ key: item.key, from: item.from, id: sanitizeId(item.name) || 'effect' })),
            )
            if (clash) {
                const both = state.sounds.some((sound) => (sanitizeId(sound.id) || 'sound') === clash) && state.named.some((item) => (sanitizeId(item.name) || 'effect') === clash)
                state.tab = 'sounds'
                Blockbench.showQuickMessage(both
                    ? `A sound and an effect are both named '${clash}', so sound keyframes would play the wrong one. Rename one of them.`
                    : `Sound keyframes that play '${clash}' would switch to a different sound or effect. Rename it, or keep the one they play now.`, 4000)
                return false
            }
            const particleRefs = particleReferenceNames()
            const namedRows = state.named.map((item) => ({ key: item.key, from: item.from, id: sanitizeId(item.name) || 'effect' }))
            const particleClash = retargetedEffect(particleRefs, Object.keys(fx.named), namedRows)
            if (particleClash) {
                state.tab = 'named'
                Blockbench.showQuickMessage(`Particle keyframes that play '${particleClash}' would switch to a different effect. Rename it, or keep the one they play now.`, 4000)
                return false
            }
            const goneSound = deletedSound(
                soundRefs,
                { sounds: fx.sounds.map((sound) => sound.id), named: Object.keys(fx.named) },
                state.sounds.map((sound) => ({ key: sound.key, from: sound.from, id: sanitizeId(sound.id) || 'sound' })),
                namedRows,
            )
            if (goneSound) {
                state.tab = goneSound.kind === 'sound' ? 'sounds' : 'named'
                Blockbench.showQuickMessage(`Sound keyframes still play '${goneSound.name}'. Point them at another ${goneSound.kind} or remove them before you delete it.`, 4000)
                return false
            }
            const goneEffect = deletedEffect(particleRefs, Object.keys(fx.named), namedRows)
            if (goneEffect) {
                state.tab = 'named'
                Blockbench.showQuickMessage(`Particle keyframes still play '${goneEffect}'. Point them at another effect or remove them before you delete it.`, 4000)
                return false
            }
            const particleKeys = new Map<number, string>()
            const soundKeys = new Map<number, string>()
            const soundIds = new Map<string, string>()
            const effectIds = new Map<string, string>()
            const particles = state.particles.map(({ key, from, ...particle }) => {
                const id = sanitizeId(particle.id) || 'particles'
                particleKeys.set(key, id)
                return { ...particle, id }
            })
            const audio: Record<string, string> = {}
            const sounds = state.sounds.map((sound) => {
                const id = sanitizeId(sound.id) || 'sound'
                soundKeys.set(sound.key, id)
                if (sound.from) soundIds.set(sound.from, id)
                const bytes = loadedAudio.get(sound.key) ?? (sound.from ? fx.audio[sound.from] : undefined)
                if (bytes && !sound.vanilla) audio[id] = bytes
                return { id, file: '', vanilla: sound.vanilla.trim(), volume: soundVolume(sound.volume), pitch: soundPitch(sound.pitch) }
            })
            const emitter = (row: Row): EmitterData => emitterOf(row, particleKeys, soundKeys)
            const named = Object.fromEntries(state.named.map((item) => {
                const id = sanitizeId(item.name) || 'effect'
                if (item.from) effectIds.set(item.from, id)
                return [id, item.rows.map(emitter)]
            }))
            const effects: EffectsData = {
                particles,
                sounds,
                emitters: state.always.map(emitter),
                named,
                trails: state.trails.map(({ key, widthStart, widthEnd, ...trail }) => ({ ...trail, width: [Number(widthStart) || 0, Number(widthEnd) || 0] as [number, number] })),
                pictures: fx.pictures,
                audio,
            }
            const references = effectReferences({ effects: effectIds, sounds: new Map([...fx.sounds.map((sound): [string, string] => [sound.id, sound.id]), ...soundIds]) })
            const aspects: Record<string, unknown> = {}
            if (references.animations.length) aspects.animations = references.animations
            if (references.controllers.length) aspects.animation_controllers = references.controllers
            commitCosmetic('Edit effects', (target) => {
                const targets = projectTargets()
                stampReferences(target, targets)
                const ids = keptIds(targetIds(target).effects, effectIds)
                target.effects = normalizeCosmetic({ effects }, target.kind).effects
                setTargetIds(target, 'effects', ids)
                resolveReferences(target, targets)
                references.apply()
            }, aspects)
        },
    } as any)
    dialog.show()
    return dialog
}

const EMITTER_ROWS = `
<div v-for="(row, r) in ROWS" :key="row.key" class="dialog_bar form_bar" style="display:flex;align-items:center;gap:6px">
<select class="dark_bordered" v-model="row.kind"><option value="particle">Particles</option><option value="sound">Sound</option><option value="vanilla">Minecraft particles</option></select>
<select v-if="row.kind==='particle'" class="dark_bordered" style="flex:1" v-model="row.particleKey"><option v-for="p in particles" :value="p.key">{{ p.id }}</option></select>
<select v-if="row.kind==='sound'" class="dark_bordered" style="flex:1" v-model="row.soundKey"><option v-for="s in sounds" :value="s.key">{{ s.id }}</option></select>
<input v-if="row.kind==='vanilla'" class="dark_bordered" style="flex:1" v-model="row.vanilla" placeholder="minecraft:end_rod">
<input v-if="row.kind==='vanilla'" type="number" class="dark_bordered" style="width:56px" v-model.number="row.count" min="1" max="16">
<select class="dark_bordered" v-model="row.locator"><option value="">Feet</option><option v-for="l in locators" :value="l">{{ l }}</option></select>
<i class="material-icons notranslate icon" @click="ROWS.splice(r,1)">delete</i>
</div>`

const EFFECTS_TEMPLATE = `
<div class="pp-effects">
<div style="display:flex;gap:4px;margin-bottom:8px"><button v-for="t in tabs" type="button" :class="{selected: tab===t[0]}" @click="tab=t[0]">{{ t[1] }}</button></div>
<div v-if="tab==='particles'">
<div v-for="(p, i) in particles" :key="p.key" class="dialog_bar form_bar" style="display:flex;align-items:center;gap:6px">
<input class="dark_bordered" style="flex:1" v-model="p.id">
<select class="dark_bordered" style="flex:1" v-model="p.picture"><option value="">No picture</option><option v-for="name in pictures" :value="name">{{ name }}</option></select>
<select class="dark_bordered" :value="p.tint ? p.tint.slot : ''" @change="p.tint = $event.target.value ? { slot: $event.target.value, tone: 0 } : null"><option value="">Own colors</option><option v-for="s in slots" :value="s.id">{{ s.name }}</option></select>
<input v-if="p.tint" type="number" class="dark_bordered" style="width:48px" v-model.number="p.tint.tone" min="0" placeholder="Base" title="Shade. Leave it empty for the base shade">
<button type="button" @click="editParticle(i)">Edit</button>
<i class="material-icons notranslate icon" @click="particles.splice(i,1)">delete</i>
</div>
<button type="button" @click="addParticle()"><i class="material-icons notranslate icon">add</i> Add particles</button>
<button type="button" @click="importParticle()"><i class="material-icons notranslate icon">file_upload</i> Import a Snowstorm file</button>
</div>
<div v-if="tab==='sounds'">
<div v-for="(s, i) in sounds" :key="s.key" class="dialog_bar form_bar" style="display:flex;align-items:center;gap:6px">
<input class="dark_bordered" style="flex:1" v-model="s.id">
<input class="dark_bordered" style="flex:1" v-model="s.vanilla" placeholder="Minecraft sound, or load a file">
<button v-if="!s.vanilla" type="button" @click="loadSound(s)">{{ s.loaded ? 'Replace file' : 'Load .ogg' }}</button>
<label>Volume</label><input type="number" class="dark_bordered" style="width:56px" v-model.number="s.volume" min="0" max="1" step="0.1">
<label>Pitch</label><input type="number" class="dark_bordered" style="width:56px" v-model.number="s.pitch" min="0.5" max="2" step="0.1">
<i class="material-icons notranslate icon" @click="sounds.splice(i,1)">delete</i>
</div>
<button type="button" @click="addSound()"><i class="material-icons notranslate icon">add</i> Add a sound</button>
</div>
<div v-if="tab==='named'">
<div v-for="(n, i) in named" :key="n.key" style="padding:4px 0;border-bottom:1px solid var(--color-border)">
<div class="dialog_bar form_bar" style="display:flex;align-items:center;gap:6px"><input class="dark_bordered" style="flex:1" v-model="n.name"><i class="material-icons notranslate icon" @click="named.splice(i,1)">delete</i></div>
${EMITTER_ROWS.replace(/ROWS/g, 'n.rows')}
<button type="button" @click="addRow(n.rows)"><i class="material-icons notranslate icon">add</i> Add to this effect</button>
</div>
<button type="button" @click="addNamed()"><i class="material-icons notranslate icon">add</i> Add an effect</button>
<button v-for="m in moments" type="button" @click="addNamed(m)">Add {{ m }}</button>
</div>
<div v-if="tab==='always'">
${EMITTER_ROWS.replace(/ROWS/g, 'always')}
<button type="button" @click="addRow(always)"><i class="material-icons notranslate icon">add</i> Add particles or a sound</button>
</div>
<div v-if="tab==='trails'">
<div v-for="(t, i) in trails" :key="t.key" style="padding:4px 0;border-bottom:1px solid var(--color-border)">
<div class="dialog_bar form_bar" style="display:flex;align-items:center;gap:6px">
<select class="dark_bordered" v-model="t.locator"><option v-for="l in locators" :value="l">{{ l }}</option></select>
<select class="dark_bordered" style="flex:1" v-model="t.picture"><option v-for="name in pictures" :value="name">{{ name }}</option></select>
<select class="dark_bordered" v-model="t.blend"><option value="alpha">Normal</option><option value="additive">Glow</option></select>
<i class="material-icons notranslate icon" @click="trails.splice(i,1)">delete</i>
</div>
<div class="dialog_bar form_bar" style="display:flex;align-items:center;gap:6px">
<label>Width</label><input type="number" class="dark_bordered" style="width:56px" v-model.number="t.widthStart" min="0" step="0.05"><label>to</label><input type="number" class="dark_bordered" style="width:56px" v-model.number="t.widthEnd" min="0" step="0.05">
<label>Fades in (s)</label><input type="number" class="dark_bordered" style="width:56px" v-model.number="t.fade" min="0" step="0.1">
<label>Min speed</label><input type="number" class="dark_bordered" style="width:56px" v-model.number="t.minSpeed" min="0" step="0.1">
<label><input type="checkbox" v-model="t.tile"> Repeat the picture</label>
</div>
<div class="dialog_bar form_bar" style="display:flex;align-items:center;gap:6px">
<select class="dark_bordered" :value="t.tint.kind" @change="setTint(t, $event.target.value)"><option value="color">One color</option><option value="slot">Palette color</option><option value="gradient">Gradient</option><option v-if="t.tint.kind==='raw'" value="raw">As in the zip</option></select>
<input v-if="t.tint.kind==='color'" class="dark_bordered" v-model="t.tint.color">
<select v-if="t.tint.kind==='slot'" class="dark_bordered" v-model="t.tint.slot"><option v-for="s in slots" :value="s.id">{{ s.name }}</option></select>
<input v-if="t.tint.kind==='slot'" type="number" class="dark_bordered" style="width:48px" v-model.number="t.tint.tone" min="0" placeholder="Base" title="Shade. Leave it empty for the base shade">
<input v-for="(stop, s) in (t.tint.kind==='gradient' ? t.tint.stops : [])" :key="s" class="dark_bordered" style="width:90px" v-model="t.tint.stops[s]">
</div>
<div style="display:flex;flex-wrap:wrap;gap:6px"><span>Only while</span><label v-for="g in signals" :key="g.name"><input type="checkbox" :checked="t.while.includes(g.name)" @change="toggleGate(t, g.name)"> {{ g.label }}</label></div>
</div>
<button type="button" @click="addTrail()"><i class="material-icons notranslate icon">add</i> Add a trail</button>
</div>
<div v-if="tab==='pictures'">
<div v-for="name in pictures" :key="name" style="display:flex;align-items:center;gap:6px"><img :src="thumb(name)" style="width:32px;height:32px;image-rendering:pixelated"><span style="flex:1">{{ name }}</span><i class="material-icons notranslate icon" @click="removePicture(name)">delete</i></div>
<button type="button" @click="addPicture()"><i class="material-icons notranslate icon">add</i> Add a picture</button>
</div>
</div>`

export function registerEffects(): () => void {
    const action = defineAction('polyplus_cosmetic_effects', {
        name: 'Effects',
        description: 'Particles, sounds and trails',
        icon: 'auto_awesome',
        category: 'edit',
        condition: () => isCosmeticActive(),
        click: () => {
            openEffects()
        },
    })
    const removeButton = addTo(PANEL_BUTTONS, { action: 'polyplus_cosmetic_effects', label: 'Effects', icon: 'auto_awesome' })
    return () => {
        removeButton()
        action.delete()
    }
}
