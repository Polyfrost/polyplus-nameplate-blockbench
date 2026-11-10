import { Reaction, REACTIONS, ReactionMode, ReducedMode, ScheduleData, TriggerData } from '../model'
import { finiteOr, wholeOr } from '../util/num'

export type Plays = 'reaction' | 'appear' | 'equip' | 'schedule'

const PLAYS: Plays[] = ['reaction', 'appear', 'equip', 'schedule']
export const REACTION_MODES: ReactionMode[] = ['while', 'start', 'stop']
export const DEFAULT_APPEAR_SECONDS = 5
export const MAX_APPEAR_SECONDS = 30
export const MAX_SCHEDULE_WEIGHT = 1000
export const MAX_LENGTH_FRAMES = 600
export const ID_PATTERN = /^[a-z0-9_]{1,64}$/

const PROP = {
    plays: 'nameplate_plays',
    reaction: 'nameplate_reaction',
    on: 'nameplate_on',
    appear: 'nameplate_appear',
    restart: 'nameplate_restart',
    window: 'nameplate_window',
    jitter: 'nameplate_jitter',
    chance: 'nameplate_chance',
    weight: 'nameplate_weight',
    schedule: 'nameplate_schedule',
    reduced: 'nameplate_reduced',
    palette: 'nameplate_palette',
} as const

export const REDUCED_MODES: ReducedMode[] = ['auto', 'drop']

export const REDUCED_NAMES: Record<ReducedMode, string> = {
    auto: 'Keep a still version',
    drop: 'Skip it',
}

export const REACTION_NAMES: Record<Reaction, string> = {
    sneaking: 'Sneaking',
    sprinting: 'Sprinting',
    hurt: 'Hurt (the red damage flash)',
    on_fire: 'On fire',
    swimming: 'Swimming',
    gliding: 'Gliding with an elytra',
    riding: 'Riding something',
    sleeping: 'Sleeping in a bed',
    emote: 'Playing a PolyPlus emote',
}

export const MODE_NAMES: Record<ReactionMode, string> = {
    while: 'For as long as it lasts',
    start: 'Once, when it starts',
    stop: 'Once, when it stops',
}

export interface AnimationSettings {
    plays: Plays | ''
    reaction: Reaction
    on: ReactionMode
    appear: number
    restart: boolean
    window: number
    jitter: number
    chance: number
    weight: number
    schedule: string
    reduced: ReducedMode | ''
}

export function defineAnimationProperties(): Property[] {
    const target = BBAnimation as any
    return [
        new Property(target, 'string', PROP.plays, { default: '' }),
        new Property(target, 'string', PROP.reaction, { default: 'hurt' }),
        new Property(target, 'string', PROP.on, { default: 'start' }),
        new Property(target, 'number', PROP.appear, { default: DEFAULT_APPEAR_SECONDS }),
        new Property(target, 'boolean', PROP.restart, { default: false }),
        new Property(target, 'number', PROP.window, { default: 0 }),
        new Property(target, 'number', PROP.jitter, { default: 0 }),
        new Property(target, 'number', PROP.chance, { default: 1 }),
        new Property(target, 'number', PROP.weight, { default: 1 }),
        new Property(target, 'string', PROP.schedule, { default: '' }),
        new Property(target, 'string', PROP.reduced, { default: '' }),
        new Property(target, 'object', PROP.palette, { default: () => ({}) }),
    ]
}

export function isReaction(value: unknown): value is Reaction {
    return (REACTIONS as readonly string[]).includes(value as string)
}

export function isReactionMode(value: unknown): value is ReactionMode {
    return REACTION_MODES.includes(value as ReactionMode)
}

export function isReducedMode(value: unknown): value is ReducedMode {
    return REDUCED_MODES.includes(value as ReducedMode)
}

export function readSettings(animation: any): AnimationSettings {
    const plays = animation?.[PROP.plays]
    const reaction = animation?.[PROP.reaction]
    const on = animation?.[PROP.on]
    return {
        plays: PLAYS.includes(plays) ? plays : '',
        reaction: isReaction(reaction) ? reaction : 'hurt',
        on: isReactionMode(on) ? on : 'start',
        appear: wholeOr(animation?.[PROP.appear], DEFAULT_APPEAR_SECONDS),
        restart: animation?.[PROP.restart] === true,
        window: wholeOr(animation?.[PROP.window], 0),
        jitter: wholeOr(animation?.[PROP.jitter], 0),
        chance: finiteOr(animation?.[PROP.chance], 1),
        weight: wholeOr(animation?.[PROP.weight], 1),
        schedule: typeof animation?.[PROP.schedule] === 'string' ? animation[PROP.schedule] : '',
        reduced: isReducedMode(animation?.[PROP.reduced]) ? animation[PROP.reduced] : '',
    }
}

export function writeSettings(animation: any, settings: AnimationSettings) {
    animation[PROP.plays] = settings.plays
    animation[PROP.reaction] = settings.reaction
    animation[PROP.on] = settings.on
    animation[PROP.appear] = settings.appear
    animation[PROP.restart] = settings.restart
    animation[PROP.window] = settings.window
    animation[PROP.jitter] = settings.jitter
    animation[PROP.chance] = settings.chance
    animation[PROP.weight] = settings.weight
    animation[PROP.schedule] = settings.schedule
    animation[PROP.reduced] = settings.reduced
}

export function triggerOf(settings: AnimationSettings): TriggerData | null {
    switch (settings.plays) {
        case 'reaction':
            return { kind: 'reaction', reaction: settings.reaction, on: settings.on }
        case 'appear':
            return { kind: 'appear', seconds: settings.appear }
        case 'equip':
            return { kind: 'equip' }
        default:
            return null
    }
}

export function scheduleOf(settings: AnimationSettings): ScheduleData | null {
    if (settings.plays !== 'schedule') return null
    return {
        window: settings.window,
        jitter: settings.jitter,
        chance: settings.chance,
        weight: settings.weight,
        id: settings.schedule ? settings.schedule : null,
    }
}

export function reducedOf(settings: AnimationSettings): ReducedMode | null {
    return settings.plays === 'reaction' && settings.on === 'while' && settings.reduced ? settings.reduced : null
}

export function settingsFrom(trigger: TriggerData | null, schedule: ScheduleData | null, restart: boolean, reduced: ReducedMode | null = null): AnimationSettings {
    const settings: AnimationSettings = {
        plays: '',
        reaction: 'hurt',
        on: 'start',
        appear: DEFAULT_APPEAR_SECONDS,
        restart,
        window: 0,
        jitter: 0,
        chance: 1,
        weight: 1,
        schedule: '',
        reduced: reduced ?? '',
    }
    if (schedule) {
        settings.plays = 'schedule'
        settings.window = schedule.window
        settings.jitter = schedule.jitter
        settings.chance = schedule.chance
        settings.weight = schedule.weight
        settings.schedule = schedule.id ?? ''
    } else if (trigger?.kind === 'reaction') {
        settings.plays = 'reaction'
        settings.reaction = trigger.reaction
        settings.on = trigger.on
    } else if (trigger?.kind === 'appear') {
        settings.plays = 'appear'
        settings.appear = trigger.seconds
    } else if (trigger?.kind === 'equip') {
        settings.plays = 'equip'
    }
    return settings
}

export function isWhile(trigger: TriggerData | null): boolean {
    return trigger?.kind === 'reaction' && trigger.on === 'while'
}

export function isOneShot(trigger: TriggerData | null): boolean {
    return !!trigger && !isWhile(trigger)
}

export function suggestedName(settings: AnimationSettings): string {
    switch (settings.plays) {
        case 'reaction':
            if (settings.on === 'while') return `while_${settings.reaction}`
            return settings.on === 'start' ? `on_${settings.reaction}` : `after_${settings.reaction}`
        case 'appear':
            return 'appear'
        case 'equip':
            return 'equip'
        case 'schedule':
            return 'random'
        default:
            return 'animation'
    }
}

export function suggestedId(name: string): string {
    const cleaned = String(name ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64)
    return cleaned.length > 0 ? cleaned : 'animation'
}
