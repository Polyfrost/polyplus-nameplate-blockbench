import { engineSignals } from '../engine'
import { HOST_CONTROLS, hostInitial, isHostShown } from './registry'
import { activeKind, readCosmetic } from './state'

export interface SignalControl {
    name: string
    label: string
    toggle: boolean
    min: number
    max: number
    step: number
    names?: Readonly<Record<number, string>>
}

export interface PreviewState {
    values: Record<string, number>
    host: Record<string, number>
}

const RANGES: Record<string, [number, number, number]> = {
    ground_speed: [0, 40, 0.5],
    vertical_speed: [-80, 20, 1],
    time_of_day: [0, 1, 0.05],
    biome_temperature: [-1, 2, 0.1],
    dimension: [-1, 2, 1],
}

const VALUE_NAMES: Record<string, Readonly<Record<number, string>>> = {
    dimension: { [-1]: 'Other', 0: 'Overworld', 1: 'Nether', 2: 'End' },
}

const ALIASES: Array<[string, string]> = [
    ['query.', 'q.'],
    ['variable.', 'v.'],
]

export const preview: PreviewState = { values: {}, host: {} }

export const EQUIP_EVENT = 1 << 7

let pendingEvents = 0
const engineDrivers = new Set<string>()

const saved = new Map<string, { had: boolean, value: unknown }>()

export function signalLabel(name: string): string {
    const words = name.replace(/^is_/, '').split('_').join(' ')
    return words.charAt(0).toUpperCase() + words.slice(1)
}

export function signalControls(): SignalControl[] {
    return engineSignals().map((name) => {
        const toggle = name.startsWith('is_')
        const [min, max, step] = RANGES[name] ?? [0, 1, toggle ? 1 : 0.1]
        const names = VALUE_NAMES[name]
        return { name, label: signalLabel(name), toggle, min, max, step, ...(names ? { names } : {}) }
    })
}

export function typedValue(raw: unknown): number | null {
    if (typeof raw === 'string' && !raw.trim()) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
}

export function signalValueText(control: SignalControl, value: number): string {
    return control.names?.[value] ?? String(value)
}

function globals(): Record<string, unknown> | null {
    const parser = (typeof Animator !== 'undefined' ? (Animator as any).MolangParser : null) as { global_variables?: Record<string, unknown> } | null
    return parser?.global_variables ?? null
}

function write(target: Record<string, unknown>, name: string, value: number) {
    if (!saved.has(name)) saved.set(name, { had: Object.prototype.hasOwnProperty.call(target, name), value: target[name] })
    target[name] = value
}

function put(target: Record<string, unknown>, name: string, value: number) {
    write(target, name, value)
    for (const [long, short] of ALIASES) {
        if (name.startsWith(long)) write(target, short + name.slice(long.length), value)
    }
}

export function setEngineDriven(on: boolean, owner = 'preview') {
    if (on) engineDrivers.add(owner)
    else engineDrivers.delete(owner)
}

export function isEngineDriven(): boolean {
    return engineDrivers.size > 0
}

function playOnce(animation: { playing: boolean }) {
    if (isEngineDriven()) return
    animation.playing = true
    if (typeof Timeline !== 'undefined') {
        Timeline.setTime(0)
        Timeline.start()
    }
}

function playReactions(signal: string, on: boolean) {
    if (isEngineDriven() || typeof Animator === 'undefined') return
    for (const reaction of readCosmetic().reactions) {
        if (reaction.signal !== signal || !reaction.play) continue
        const animation = Animator.animations.find((item) => item.name === reaction.play)
        if (!animation) continue
        if (reaction.on === 'while') animation.playing = on
        else if ((reaction.on === 'start' && on) || (reaction.on === 'stop' && !on)) playOnce(animation)
    }
}

export function takeEvents(): number {
    const events = pendingEvents
    pendingEvents = 0
    return events
}

export function wearAgain() {
    pendingEvents |= EQUIP_EVENT
    if (typeof Animator !== 'undefined') {
        for (const reaction of readCosmetic().reactions) {
            if (reaction.on !== 'equip' || !reaction.play) continue
            const animation = Animator.animations.find((item) => item.name === reaction.play)
            if (animation) playOnce(animation)
        }
    }
    applyPreview()
}

export function applyPreview() {
    const target = globals()
    if (!target) return
    for (const [name, value] of Object.entries(preview.values)) {
        put(target, `query.${name}`, value)
        put(target, `query.owner.${name}`, value)
    }
    for (const [name, value] of Object.entries(preview.host)) put(target, `variable.${name}`, value)
    const kind = activeKind()
    const data = kind ? readCosmetic() : null
    for (const control of HOST_CONTROLS) {
        if (!kind || !data || !control.kinds.includes(kind)) continue
        if (!isHostShown(control, data, preview.host)) put(target, `variable.${control.name}`, control.initial ?? 0)
        else if (control.initial !== undefined && !(control.name in preview.host)) put(target, `variable.${control.name}`, control.initial)
    }
    if (!isEngineDriven() && typeof Animator !== 'undefined' && typeof Animator.preview === 'function') Animator.preview()
}

export function setSignal(name: string, value: number) {
    const before = preview.values[name] ?? 0
    preview.values[name] = value
    if (name.startsWith('is_') && (before !== 0) !== (value !== 0)) playReactions(name, value !== 0)
    applyPreview()
}

export function setHostVariable(name: string, value: number) {
    preview.host[name] = value
    applyPreview()
}

export function resetPreview() {
    for (const name of Object.keys(preview.values)) preview.values[name] = 0
    for (const name of Object.keys(preview.host)) preview.host[name] = hostInitial(name, activeKind())
    applyPreview()
}

export function clearPreview() {
    const target = globals()
    if (target) {
        for (const [name, prior] of saved) {
            if (prior.had) target[name] = prior.value
            else delete target[name]
        }
    }
    saved.clear()
}
