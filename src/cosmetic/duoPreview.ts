import { describe, EmoteActor, EmoteDriver, engineSignals, IDENTITY, PLAYER_BONES } from '../engine'
import { createListenerSet } from '../util/events'
import { lastBuild, onChecks } from './checks'
import { controllerPlayLength, placement, rolePlayLength, Seat, seats, Spot } from './duo'
import { freshHolds, HOLD_STEP_SECONDS, holdInput, holdsFinished, holdTicks, reactHolds, RoleHold } from './duoHold'
import { Affine, affineAt, engineRoot, multiply, propBoneNames } from './livePose'
import { geometryOf } from './livePreview'
import { cameraView, ParticleLayer } from './particles'
import { animationsLength, captureRest, copyRig, deformsOf, groupNodes, poseNodes, RigNode, RigRest, showDefaultPose, three, toBlockbench } from './rigScene'
import { preview, setEngineDriven } from './preview'
import { recordSignals, SignalChange, signalsAt } from './signalLog'
import { activeKind, readCosmetic } from './state'

export const duoUi = { on: false, playing: false, time: 0, length: 1, note: '' }

const listeners = createListenerSet('a duo preview listener failed')
const ENGINE_OWNER = 'duo'

interface Dummy {
    seat: Seat
    actor: EmoteActor
    nodes: RigNode[]
    props: RigNode[]
    place: any
}

interface Duo {
    driver: EmoteDriver
    rig: RigRest
    bones: readonly string[]
    dummies: Dummy[]
    copies: any
    shown: Map<any, boolean>
    holds: RoleHold[]
    heldTo: number
    particles: ParticleLayer | null
}

export const DUO_VIEW_ROOT: readonly number[] = Object.freeze(engineRoot(IDENTITY))

export function duoActorRoot(spot: Spot): Affine {
    return multiply(DUO_VIEW_ROOT, placement(spot))
}

export function duoActor(seat: Seat): EmoteActor {
    return { ...seat.actor, root: duoActorRoot(seat.spot) }
}

let duo: Duo | null = null
let signals: SignalChange[] = []
let chosenLength: number | null = null
let clock = 0
let last = 0
let replay = false
let frameRequest: number | null = null
let unhook: (() => void) | null = null

export function onDuoChange(listener: () => void): () => void {
    return listeners.on(listener)
}

export function canPreviewDuo(): boolean {
    return activeKind() === 'emote' && !!three() && readCosmetic().emote.roles.length >= 2
}

function close(keepPose = false) {
    for (const [object, visible] of duo?.shown ?? []) object.visible = visible
    duo?.particles?.dispose()
    duo?.driver.dispose()
    duo?.copies?.parent?.remove?.(duo.copies)
    duo = null
    if (!keepPose) showDefaultPose()
}

function open(): boolean {
    const reopening = !!duo
    close(true)
    if (start()) return true
    if (reopening) showDefaultPose()
    return false
}

function start(): boolean {
    const roles = readCosmetic().emote.roles
    const placed = seats(roles)
    if (placed.length < 2) {
        duoUi.note = 'Add two roles to preview a duo.'
        return false
    }
    const built = lastBuild()
    if (!built) {
        duoUi.note = 'Checks are still running. Try again in a moment.'
        return false
    }
    let driver: EmoteDriver | null = null
    try {
        driver = EmoteDriver.open(built.files, built.binary, engineSignals())
    } catch (error) {
        duoUi.note = `The engine couldn't play it: ${describe(error)}`
        return false
    }
    if (!driver) {
        duoUi.note = 'Fix the problems in Checks to play it.'
        return false
    }
    const rig = captureRest()
    const { copies, objectOf } = copyRig(rig, 'polyplus_duo_partner')
    const props = propBoneNames(geometryOf(built.files))
    const bones = driver.bones === PLAYER_BONES.length + props.length ? [...PLAYER_BONES, ...props] : PLAYER_BONES
    const animated = new Set(bones.slice(PLAYER_BONES.length))
    const dummies = placed.map((seat, i) => {
        const at = placement(seat.spot)
        const nodes = i === 0 ? groupNodes(rig) : groupNodes(rig, objectOf)
        return { seat, actor: duoActor(seat), nodes, props: nodes.filter((node) => animated.has(node.name)), place: toBlockbench(rig, at) }
    })
    const clips = placed.map((seat) => roles[seat.role]?.animation ?? '')
    duoUi.length = chosenLength ?? Math.max(rolePlayLength(clips, built.files, (name) => animationsLength([name])), controllerPlayLength(built.files))
    const particles = driver.hasEffects() ? new ParticleLayer(rig.holder, driver, built.binary) : null
    duo = { driver, rig, bones, dummies, copies, shown: new Map(), holds: freshHolds(dummies.length), heldTo: duoCatchUpFrom(duoUi.time, duoUi.length) - HOLD_STEP_SECONDS, particles }
    duoUi.note = ''
    return true
}

export function setDuoLength(seconds: number) {
    if (!(Number.isFinite(seconds) && seconds > 0)) return
    chosenLength = Math.max(MIN_DUO_LENGTH, seconds)
    duoUi.length = chosenLength
    listeners.notify()
}

const HIDDEN_SCALE = 1e-6
const MIN_DUO_LENGTH = 0.25
export const DUO_CATCH_UP_SECONDS = 120

export function duoCatchUpFrom(time: number, length: number): number {
    if (!(time > DUO_CATCH_UP_SECONDS)) return 0
    const loop = length > 0 ? Math.min(time, Math.floor(time / length) * length) : 0
    return time - loop <= DUO_CATCH_UP_SECONDS ? loop : time - DUO_CATCH_UP_SECONDS
}

function hiddenBone(bones: ArrayLike<number>, index: number): boolean {
    const a = affineAt(bones, index)
    return Math.hypot(a[0], a[4], a[8]) < HIDDEN_SCALE && Math.hypot(a[1], a[5], a[9]) < HIDDEN_SCALE && Math.hypot(a[2], a[6], a[10]) < HIDDEN_SCALE
}

function show(open: Duo, object: any, visible: boolean) {
    if (!open.shown.has(object)) open.shown.set(object, object.visible !== false)
    object.visible = visible && open.shown.get(object)
}

export interface DuoStep {
    clock: number
    time: number
    replay: boolean
}

export function advanceDuo(clock: number, time: number, length: number, playing: boolean, seconds: number): DuoStep {
    if (!playing || !(seconds > 0)) return { clock, time, replay: false }
    const next = time + seconds
    if (next > length) return { clock: clock + seconds, time: 0, replay: true }
    return { clock: clock + seconds, time: next, replay: false }
}

export function advanceOpenDuo(clock: number, time: number, playing: boolean, seconds: number, finished: boolean): DuoStep {
    if (!playing) return { clock, time, replay: false }
    const step = seconds > 0 ? seconds : 0
    if (finished) return { clock: clock + step, time: 0, replay: true }
    return { clock: clock + step, time: time + step, replay: false }
}

export interface HeldDuo {
    driver: Pick<EmoteDriver, 'frame' | 'statuses' | 'sampleEffectRings'>
    actors: readonly EmoteActor[]
    holds: RoleHold[]
    heldTo: number
}

function heldActors(duo: HeldDuo, age: number): EmoteActor[] {
    return duo.actors.map((actor, i) => ({ ...actor, ...holdInput(duo.holds[i], age) }))
}

export type DuoSignals = Readonly<Record<string, number>> | ((time: number) => Readonly<Record<string, number>>)

export function heldFrame(duo: HeldDuo, clock: number, time: number, signals: DuoSignals = {}, view: readonly number[] | null = null): Float32Array[] {
    const at = typeof signals === 'function' ? signals : () => signals
    const start = clock - time
    for (const tick of holdTicks(duo.heldTo, time)) {
        duo.driver.frame(start + tick, tick, heldActors(duo, tick), at(tick))
        if (view) duo.driver.sampleEffectRings(view)
        reactHolds(duo.holds, duo.driver.statuses, tick)
    }
    duo.heldTo = Math.max(duo.heldTo, time)
    return duo.driver.frame(clock, time, heldActors(duo, time), at(time))
}

function render() {
    const open = duo
    if (!open) return
    recordSignals(signals, duoUi.time, preview.values)
    if (replay) {
        replay = false
        open.driver.reset()
        open.holds = freshHolds(open.dummies.length)
        open.heldTo = -HOLD_STEP_SECONDS
    }
    const view = open.particles ? cameraView(open.rig.rootInverse, DUO_VIEW_ROOT) : null
    const held: HeldDuo = { driver: open.driver, actors: open.dummies.map((dummy) => dummy.actor), holds: open.holds, heldTo: open.heldTo }
    const frames = heldFrame(held, clock, duoUi.time, (time) => signalsAt(signals, time), view)
    open.heldTo = held.heldTo
    open.dummies.forEach((dummy, i) => {
        const deform = deformsOf(open.rig, frames[i], open.bones, placement(dummy.seat.spot))
        for (const node of dummy.props) {
            const hidden = hiddenBone(frames[i], open.bones.indexOf(node.name))
            if (hidden) deform.delete(node.name)
            show(open, node.object, !hidden)
        }
        poseNodes(dummy.nodes, deform, dummy.place)
    })
    if (view) open.particles?.drawView(view, DUO_VIEW_ROOT)
}

function tick(now: number) {
    frameRequest = null
    if (!duo || !duoUi.on) return
    const seconds = last ? Math.min(0.1, (now - last) / 1000) : 0
    last = now
    const step = advanceOpenDuo(clock, duoUi.time, duoUi.playing, seconds, !replay && holdsFinished(duo.holds, duoUi.time))
    clock = step.clock
    if (step.replay) signals = [{ at: 0, values: signalsAt(signals, duoUi.time) }]
    duoUi.time = step.time
    if (step.replay) replay = true
    try {
        render()
    } catch (error) {
        console.error('[polyplus_nameplate] the duo preview failed', error)
        stopDuo(`The duo preview stopped: ${describe(error)}`)
        return
    }
    frameRequest = requestAnimationFrame(tick)
}

function schedule() {
    if (frameRequest === null && duoUi.on) frameRequest = requestAnimationFrame(tick)
}

export function startDuo(): boolean {
    if (!canPreviewDuo()) return false
    clock = 0
    last = 0
    replay = false
    signals = []
    duoUi.time = 0
    if (typeof Timeline !== 'undefined') (Timeline as any).pause?.()
    if (!open()) {
        listeners.notify()
        return false
    }
    duoUi.on = true
    duoUi.playing = true
    setEngineDriven(true, ENGINE_OWNER)
    unhook ??= onChecks(() => {
        if (duoUi.on && !open()) stopDuo(duoUi.note)
    })
    schedule()
    listeners.notify()
    return true
}

export function stopDuo(note = '') {
    if (frameRequest !== null) cancelAnimationFrame(frameRequest)
    frameRequest = null
    unhook?.()
    unhook = null
    const was = duoUi.on || !!duo
    setEngineDriven(false, ENGINE_OWNER)
    chosenLength = null
    duoUi.on = false
    duoUi.playing = false
    duoUi.note = note
    signals = []
    if (duo) close()
    if (was) listeners.notify()
}

export function toggleDuo() {
    if (duoUi.on) stopDuo()
    else startDuo()
}

export function playDuo(playing: boolean) {
    if (!duoUi.on && !startDuo()) return
    duoUi.playing = playing
    schedule()
    listeners.notify()
}

export function scrubDuo(time: number) {
    if (!duoUi.on && !startDuo()) return
    duoUi.playing = false
    const next = Math.max(0, Math.min(duoUi.length, Number(time) || 0))
    if (next !== duoUi.time) replay = true
    duoUi.time = next
    schedule()
    listeners.notify()
}
