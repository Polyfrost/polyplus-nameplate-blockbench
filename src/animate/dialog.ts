import { limited, limitedValue } from '../elements/limits'
import { currentFps, currentLoopFrames, secondsText, snappingFor } from '../format'
import { REACTIONS } from '../model'
import { animationFrames, findLoopAnimation } from '../util/animation'
import { syncScheduleMarkers } from './markers'
import { readNameplate } from '../palette/state'
import { ensurePlateNode, plateNode, selectPlateRow } from '../plate'
import { letterSaveNote, openLetterProgram } from '../text/program'
import { undoEdit } from '../util/undo'
import { LetterTrack, readLetterTrack, writeLetterTrack } from '../text/reaction'
import { LETTER_MODE_NAMES, plateText, variantText } from '../text/types'
import {
    AnimationSettings,
    DEFAULT_APPEAR_SECONDS,
    MAX_APPEAR_SECONDS,
    MAX_LENGTH_FRAMES,
    MAX_SCHEDULE_WEIGHT,
    MODE_NAMES,
    Plays,
    REACTION_MODES,
    REACTION_NAMES,
    REDUCED_MODES,
    REDUCED_NAMES,
    isReducedMode,
    readSettings,
    suggestedId,
    suggestedName,
    writeSettings,
} from './props'

const DIALOG_ID = 'polyplus_nameplate_animation'
const OWN_SCHEDULE = 'own'
const DEFAULT_WINDOW_SECONDS = 6
const MAX_SCHEDULE_FRAMES = 100000
const SHAKE_X = [0, 3, -3, 2, -2, 1, -1, 0]

const PLAYS_NAMES: Record<Plays, string> = {
    reaction: 'When the player does something (a reaction)',
    appear: 'When the nameplate comes back into view',
    equip: 'When the nameplate is put on',
    schedule: 'Now and then, at random times',
}

type LettersChoice = 'keep' | 'still' | 'program'

const LETTERS_NAMES: Record<LettersChoice, string> = {
    keep: "Keep the nameplate's letters",
    still: 'Hold the letters still',
    program: 'Run a letter formula',
}

interface FormResult {
    name: string
    plays: Plays
    reaction: AnimationSettings['reaction']
    on: AnimationSettings['on']
    appear: number
    length: number
    restart: boolean
    window: number
    jitter: number
    chance: number
    share: string
    weight: number
    reduced: string
    letters: LettersChoice
    letters_program: string
}

export { currentFps }

export function loopFrames(fps: number): number {
    const loop = findLoopAnimation()
    return loop ? animationFrames(loop, fps) : currentLoopFrames()
}

function optionsOf<K extends string>(keys: readonly K[], names: Record<K, string>): Record<string, string> {
    return Object.fromEntries(keys.map((key) => [key, names[key]]))
}

function isOneShotForm(form: Partial<FormResult>): boolean {
    return form.plays === 'appear' || form.plays === 'equip' || (form.plays === 'reaction' && form.on !== 'while')
}

function withinLimits(form: FormResult): FormResult {
    const next = { ...form }
    if (form.plays === 'appear') next.appear = limited(form.appear, 1, MAX_APPEAR_SECONDS, DEFAULT_APPEAR_SECONDS, 'Unseen for')
    if (isOneShotForm(form) || form.plays === 'schedule') next.length = limited(form.length, 1, MAX_LENGTH_FRAMES, 1, 'Length')
    if (form.plays === 'schedule') {
        next.window = limited(form.window, 1, MAX_SCHEDULE_FRAMES, 1, 'Window')
        next.jitter = limited(form.jitter, 0, MAX_SCHEDULE_FRAMES, 0, 'Random delay')
        next.chance = limitedValue(form.chance, 0, 1, 1, 'Chance per window')
        next.weight = limited(form.weight, 1, MAX_SCHEDULE_WEIGHT, 1, 'Weight')
    }
    return next
}

function lettersChoiceOf(track: LetterTrack | undefined): LettersChoice {
    if (!track) return 'keep'
    return track.motion ? 'program' : 'still'
}

function letterTrackOf(form: FormResult): LetterTrack | undefined {
    if (form.plays === 'schedule' || form.letters === 'keep') return undefined
    if (form.letters === 'still') return { motion: null }
    return { motion: String(form.letters_program ?? '').trim() || null }
}

function letterMode(): ReturnType<typeof plateText>['mode'] {
    try {
        const plate = readNameplate() as any
        const modes = Object.values<any>(plate.variants).map((variant) => variantText(plate, variant).mode)
        return modes.includes('owned') ? 'owned' : modes.includes('motion') ? 'motion' : plateText(plate).mode
    } catch {
        return 'vanilla'
    }
}

function scheduleIdOf(animation: any): string {
    const settings = readSettings(animation)
    return settings.schedule || suggestedId(animation.name)
}

function partners(animation: any): Record<string, string> {
    const options: Record<string, string> = { [OWN_SCHEDULE]: 'No, it has its own' }
    const all: any[] = Animator.animations ?? []
    const groups = new Map<string, string[]>()
    for (const other of all) {
        if (other === animation || readSettings(other).plays !== 'schedule') continue
        const id = scheduleIdOf(other)
        const names = groups.get(id) ?? []
        names.push(other.name)
        groups.set(id, names)
    }
    for (const [id, names] of groups) options[id] = `Yes, take turns with ${names.map((name) => `'${name}'`).join(', ')}`
    return options
}

function uniqueName(base: string, animation: any): string {
    const taken = new Set((Animator.animations ?? []).filter((other: any) => other !== animation).map((other: any) => other.name))
    if (!taken.has(base)) return base
    for (let counter = 2; ; counter++) {
        const candidate = `${base}_${counter}`
        if (!taken.has(candidate)) return candidate
    }
}

function settingsOf(form: FormResult, previous: AnimationSettings): AnimationSettings {
    return {
        plays: form.plays,
        reaction: form.reaction,
        on: form.on,
        appear: Math.round(form.appear),
        restart: !!form.restart,
        window: form.plays === 'schedule' ? Math.round(form.window) : previous.window,
        jitter: form.plays === 'schedule' ? Math.round(form.jitter) : previous.jitter,
        chance: form.plays === 'schedule' ? form.chance : previous.chance,
        weight: form.plays === 'schedule' ? Math.round(form.weight) : previous.weight,
        schedule: form.plays === 'schedule' && form.share !== OWN_SCHEDULE ? form.share : '',
        reduced: reducedChoice(form, previous),
    }
}

function reducedChoice(form: FormResult, previous: AnimationSettings): AnimationSettings['reduced'] {
    if (form.plays !== 'reaction' || form.on !== 'while' || !isReducedMode(form.reduced)) return previous.reduced
    return form.reduced === 'auto' && previous.reduced === '' ? '' : form.reduced
}

function plateAnimator(animation: any): any | null {
    const node = plateNode()
    return node ? animation.getBoneAnimator(node) : null
}

function isPlateKeyed(animation: any): boolean {
    const node = plateNode()
    const keys: any[] = (node ? animation.animators?.[node.uuid]?.keyframes : null) ?? []
    return keys.some((key) => key.channel === 'position')
}

function addShake(animation: any, frames: number, fps: number) {
    const animator = plateAnimator(animation)
    if (!animator) return
    const shown = SHAKE_X.slice(0, frames)
    shown[shown.length - 1] = 0
    shown.forEach((x, frame) => {
        animator.addKeyframe({ channel: 'position', time: frame / fps, interpolation: 'linear', data_points: [{ x: String(x), y: '0', z: '0' }] })
    })
}

function scheduleMembers(id: string, animation: any): any[] {
    return (Animator.animations ?? []).filter(
        (other: any) => other !== animation && readSettings(other).plays === 'schedule' && scheduleIdOf(other) === id,
    )
}

export function openAnimationDialog(animation: any) {
    const pending = !(Animator.animations ?? []).includes(animation)
    const fps = currentFps()
    const loop = loopFrames(fps)
    const previous = readSettings(animation)
    const fresh = previous.plays === ''
    const lengthFrames = Number(animation.length) > 0 ? animationFrames(animation, fps) : fps
    const window = previous.window > 0 ? previous.window : DEFAULT_WINDOW_SECONDS * fps
    const jitter = previous.window > 0 ? previous.jitter : fps
    const share = previous.schedule ? previous.schedule : OWN_SCHEDULE
    const shareOptions = partners(animation)
    if (!(share in shareOptions)) shareOptions[share] = `Yes, schedule '${share}'`
    const reactionOptions = optionsOf(REACTIONS, REACTION_NAMES)
    const modeOptions = optionsOf(REACTION_MODES, MODE_NAMES)
    const reducedOptions = optionsOf(REDUCED_MODES, REDUCED_NAMES)

    const plateFree = !isPlateKeyed(animation)
    let shaking = false
    let autoName = uniqueName(suggestedName(fresh ? { ...previous, plays: 'reaction' } : previous), animation)
    const startName = fresh ? autoName : animation.name
    const isSchedule = (form: Partial<FormResult>) => form.plays === 'schedule'
    const lettersShown = (form: Partial<FormResult>) => !!form.plays && form.plays !== 'schedule'
    const programShown = (form: Partial<FormResult>) => lettersShown(form) && form.letters === 'program'
    const previousLetters = readLetterTrack(animation)
    const textMode = letterMode()
    const letterContext = (form: Partial<FormResult>) => {
        const whileForm = form.plays === 'reaction' && form.on === 'while'
        return { mode: textMode, fps, length: whileForm ? loop : Math.max(1, Math.round(Number(form.length) || lengthFrames)), reaction: true }
    }

    const dialog: any = new Dialog({
        id: DIALOG_ID,
        title: fresh ? 'New Animation' : `Animation: ${animation.name}`,
        width: 600,
        cancel_on_click_outside: false,
        form: {
            name: {
                label: 'Name',
                type: 'text',
                value: startName,
                description: 'Use lowercase letters, digits and _',
            },
            plays: {
                label: 'Plays',
                type: 'select',
                value: fresh ? 'reaction' : previous.plays,
                options: PLAYS_NAMES,
            },
            reaction: {
                label: 'Player is',
                type: 'select',
                value: previous.reaction,
                options: reactionOptions,
                condition: (form: Partial<FormResult>) => form.plays === 'reaction',
            },
            on: {
                label: 'Play it',
                type: 'select',
                value: previous.on,
                options: modeOptions,
                condition: (form: Partial<FormResult>) => form.plays === 'reaction',
            },
            while_info: {
                type: 'info',
                text: `It replaces the loop's keyframes while the player stays this way. It plays in the loop's ${loop} frames.`,
                condition: (form: Partial<FormResult>) => form.plays === 'reaction' && form.on === 'while',
            },
            reduced: {
                label: 'When players turn motion down',
                type: 'select',
                value: previous.reduced || 'auto',
                options: reducedOptions,
                description: "Keep: it holds its first frame. Skip: it doesn't play for them",
                condition: (form: Partial<FormResult>) => form.plays === 'reaction' && form.on === 'while',
            },
            appear: {
                label: 'Unseen for (seconds)',
                type: 'number',
                value: previous.appear || DEFAULT_APPEAR_SECONDS,
                step: 1,
                force_step: true,
                description: `1 to ${MAX_APPEAR_SECONDS}, default ${DEFAULT_APPEAR_SECONDS}`,
                condition: (form: Partial<FormResult>) => form.plays === 'appear',
            },
            length: {
                label: 'Length (frames)',
                type: 'number',
                value: lengthFrames,
                step: 1,
                force_step: true,
                description: `At ${fps} fps, ${fps} frames is 1 second`,
                condition: (form: Partial<FormResult>) => isOneShotForm(form) || isSchedule(form),
            },
            restart: {
                label: 'Restart if triggered again',
                type: 'checkbox',
                value: previous.restart,
                description: 'Off: a new trigger while it plays is ignored. On: it starts over from frame 0.',
                condition: (form: Partial<FormResult>) => isOneShotForm(form),
            },
            shake: {
                type: 'buttons',
                buttons: ['Shake the whole nameplate'],
                condition: (form: Partial<FormResult>) => plateFree && isOneShotForm(form),
                click: () => {
                    ensurePlateNode()
                    shaking = true
                    dialog.confirm()
                },
            },
            oneshot_info: {
                type: 'info',
                text: 'While it plays, its keyframes replace the loop\'s on the layers it animates.',
                condition: (form: Partial<FormResult>) => isOneShotForm(form),
            },
            window: {
                label: 'Window (frames)',
                type: 'number',
                value: window,
                step: 1,
                force_step: true,
                description: `It plays at most once per window. ${window} frames is ${secondsText(window, fps)}`,
                condition: isSchedule,
            },
            jitter: {
                label: 'Random delay (frames)',
                type: 'number',
                value: jitter,
                step: 1,
                force_step: true,
                description: 'Length plus delay must fit in the window',
                condition: isSchedule,
            },
            chance: {
                label: 'Chance per window',
                type: 'number',
                value: previous.plays === 'schedule' ? previous.chance : 1,
                step: 0.05,
                description: '1 plays in every window, 0.5 in about half of them, 0 never',
                condition: isSchedule,
            },
            share: {
                label: 'Share a schedule',
                type: 'select',
                value: share,
                options: shareOptions,
                description: 'Animations that share a schedule take turns',
                condition: isSchedule,
            },
            weight: {
                label: 'Weight',
                type: 'number',
                value: previous.plays === 'schedule' ? previous.weight : 1,
                step: 1,
                force_step: true,
                description: 'Weight 2 is picked twice as often as weight 1',
                condition: (form: Partial<FormResult>) => isSchedule(form) && form.share !== OWN_SCHEDULE,
            },
            letters: {
                label: 'Letters',
                type: 'select',
                value: lettersChoiceOf(previousLetters),
                options: LETTERS_NAMES,
                description: "Keep: the nameplate's letter formula runs. Hold still: they stop moving. Run a letter formula: the one below runs instead",
                condition: lettersShown,
            },
            letters_vanilla: {
                type: 'info',
                text: `Letters is set to "${LETTER_MODE_NAMES.vanilla}" in the Inspector (click Name text under Layers), so the game can't move the letters. Pick "${LETTER_MODE_NAMES.motion}" or "${LETTER_MODE_NAMES.owned}" there first.`,
                condition: (form: Partial<FormResult>) => lettersShown(form) && form.letters !== 'keep' && textMode === 'vanilla',
            },
            letters_program: {
                label: 'Letter formula',
                type: 'textarea',
                style: 'code',
                height: 60,
                value: previousLetters?.motion ?? '',
                description: 'Runs for every letter, every frame. The result moves the letter down in px. Click Edit letter formula for examples',
                condition: programShown,
            },
            letters_edit: {
                type: 'buttons',
                buttons: ['Edit letter formula...'],
                condition: programShown,
                click: () => {
                    const form = dialog.getFormResult() as FormResult
                    openLetterProgram({
                        ...letterContext(form),
                        source: String(form.letters_program ?? ''),
                        title: `Letter Formula: ${form.name || animation.name}`,
                        save: (source) => dialog.setFormValues({ letters_program: source ?? '' }, false),
                    })
                },
            },
            schedule_info: {
                type: 'info',
                text: 'A layer can follow only one schedule.',
                condition: isSchedule,
            },
        } as any,
        onFormChange(this: any, form: FormResult) {
            const settings = settingsOf(form, previous)
            const suggestion = uniqueName(suggestedName(settings), animation)
            if (form.name === autoName) {
                if (form.name !== suggestion) this.setFormValues({ name: suggestion }, false)
                autoName = suggestion
            }
            if (form.plays === 'schedule' && form.share !== OWN_SCHEDULE) {
                const mate = scheduleMembers(form.share, animation)[0]
                const shared = mate ? readSettings(mate) : null
                if (shared && (shared.window !== form.window || shared.jitter !== form.jitter || shared.chance !== form.chance)) {
                    this.setFormValues({ window: shared.window, jitter: shared.jitter, chance: shared.chance }, false)
                }
            }
        },
        onConfirm(typed: FormResult) {
            const form = withinLimits(typed)
            const settings = settingsOf(form, previous)
            const name = suggestedId(String(form.name).trim() || suggestedName(settings))
            const shared = settings.plays === 'schedule' && settings.schedule ? scheduleMembers(settings.schedule, animation) : []
            undoEdit(
                { animations: pending ? shared : [animation, ...shared] },
                pending ? 'Add nameplate animation' : 'Edit nameplate animation',
                () => {
                    if (pending) animation.add(false)
                    writeSettings(animation, settings)
                    animation.name = name
                    if (typeof animation.createUniqueName === 'function') animation.createUniqueName()
                    for (const other of shared) {
                        const theirs = readSettings(other)
                        theirs.schedule = settings.schedule
                        theirs.window = settings.window
                        theirs.jitter = settings.jitter
                        theirs.chance = settings.chance
                        writeSettings(other, theirs)
                        syncScheduleMarkers(other, fps)
                    }
                    const letters = letterTrackOf(form)
                    writeLetterTrack(animation, letters)
                    const saveNote = letters?.motion ? letterSaveNote(letters.motion, letterContext(form)) : null
                    if (saveNote) Blockbench.showQuickMessage(saveNote, 2500)
                    const whileReaction = settings.plays === 'reaction' && settings.on === 'while'
                    const frames = whileReaction ? loop : Math.max(1, Math.round(form.length))
                    if (typeof animation.setLength === 'function') animation.setLength(frames / fps)
                    else animation.length = frames / fps
                    animation.loop = whileReaction ? 'loop' : 'once'
                    animation.snapping = snappingFor(fps)
                    animation.nameplate_fps = fps
                    if (shaking) addShake(animation, frames, fps)
                    syncScheduleMarkers(animation, fps)
                    if (pending || shaking) animation.select()
                    Blockbench.dispatchEvent('edit_animation_properties', { animation } as any)
                },
                pending ? () => ({ animations: [animation, ...shared] }) : undefined,
            )
            if (shaking) selectPlateRow()
            if (typeof Animator.preview === 'function' && BBAnimation.selected === animation) Animator.preview()
        },
    } as any)
    dialog.show()
}
