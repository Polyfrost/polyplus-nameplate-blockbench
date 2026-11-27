import { CosmeticDriver, describe, DriverFrame, DriverInput, DriverRole, engineSignals, IDENTITY } from '../engine'
import { createListenerSet } from '../util/events'
import { lastBuild, onChecks } from './checks'
import { HOLD_STEP_SECONDS } from './duoHold'
import { advanceDuo } from './duoPreview'
import { genericPetMotion, isGenericMove, NO_ROLE, petPairSeats, petPairSignals, petPreviewInteractions, petRoleClips, petSessionSeconds, placement, Seat, Spot, wrapDegrees } from './duo'
import { geometryOf, hostVariableNames } from './livePreview'
import { Affine, boneTargets, engineRoot, invert, multiply } from './livePose'
import { petScaleKept } from './data'
import { cameraView, ParticleLayer } from './particles'
import { petRoleVariables, petScaleRange } from './pet'
import { preview, setEngineDriven, takeEvents } from './preview'
import { RIG_PROPERTY } from './project'
import { compactSignals, hostAt, recordSignals, SignalChange, signalsAt } from './signalLog'
import { ColorwayPaint, manifestOf } from './recolor'
import { captureRest, copyRig, deformsOf, groupNodes, poseNodes, RigNode, RigRest, showDefaultPose, three, toBlockbench } from './rigScene'
import { claimRig, releaseRig } from './rigOwner'
import { PreviewSounds } from './sounds'
import { activeKind, readCosmetic } from './state'

export const petUi = { on: false, playing: false, time: 0, length: 1, note: '', interaction: '', interactions: [] as string[] }

const listeners = createListenerSet('a pet role preview listener failed')
const RIG_OWNER = 'pets'

interface Dummy {
    seat: Seat
    nodes: RigNode[]
    place: any
    roots: any[]
    paint: ColorwayPaint
}

interface Together {
    driver: CosmeticDriver
    rig: RigRest
    targets: string[]
    dummies: Dummy[]
    copies: any
    unroot: number[]
    size: Affine
    scale: number
    moving: boolean
    sounds: PreviewSounds
    particles: ParticleLayer | null
    manifest: unknown
}

let together: Together | null = null
let history: PetEvent[] = []
let signals: PetSignalChange[] = []
let clock = 0
let origin = 0
let laps: number[] = []
let last = 0
let replay = false
let frameRequest: number | null = null
let unhook: (() => void) | null = null

export function onPetPlayChange(listener: () => void): () => void {
    return listeners.on(listener)
}

export function canPreviewPetRoles(): boolean {
    return activeKind() === 'pet' && !!three() && petPreviewInteractions(readCosmetic().pet).length > 0
}

export function syncPetInteractions() {
    petUi.interactions = activeKind() === 'pet' ? petPreviewInteractions(readCosmetic().pet) : []
    if (!petUi.interactions.includes(petUi.interaction)) petUi.interaction = petUi.interactions[0] ?? ''
}

function close(keepPose = false) {
    for (const dummy of together?.dummies ?? []) dummy.paint.clear()
    together?.particles?.dispose()
    together?.sounds.dispose()
    together?.driver.dispose()
    together?.copies?.parent?.remove?.(together.copies)
    together = null
    if (!keepPose) showDefaultPose()
}

function open(): boolean {
    const reopening = !!together
    close(true)
    if (start()) return true
    if (reopening) showDefaultPose()
    return false
}

function start(): boolean {
    syncPetInteractions()
    const pet = readCosmetic().pet
    const roles = pet.roles
    const scale = petScaleKept(pet.scale, petScaleRange())
    const placed = petPairSeats(roles, petUi.interaction, scale, pet.interactions[petUi.interaction as keyof typeof pet.interactions])
    if (!placed.length) {
        petUi.note = "This pet can't do anything with another pet yet. Turn on an interaction or add a role."
        return false
    }
    const built = lastBuild()
    if (!built) {
        petUi.note = 'Checks are still running. Try again in a moment.'
        return false
    }
    let driver: CosmeticDriver | null = null
    try {
        driver = CosmeticDriver.open(built.files, built.binary, engineSignals(), hostVariableNames(), true)
    } catch (error) {
        petUi.note = `The engine couldn't play it: ${describe(error)}`
        return false
    }
    if (!driver) {
        petUi.note = 'Fix the problems in Checks to play it.'
        return false
    }
    const rigs = new Set(Group.all.filter((group) => (group as any)[RIG_PROPERTY] === true).map((group) => group.name))
    const rig = captureRest()
    const { copies, objectOf } = copyRig(rig, 'polyplus_pet_partner')
    const { unroot, size } = petRoots(scale)
    const tops = Group.all.filter((group) => !(group.parent instanceof Group)).map((group) => (group as any).mesh).filter(Boolean)
    const dummies = placed.map((seat, i) => ({
        seat,
        nodes: i === 0 ? groupNodes(rig) : groupNodes(rig, objectOf),
        place: toBlockbench(rig, multiply(placement(seat.spot), size)),
        roots: i === 0 ? tops : [copies],
        paint: new ColorwayPaint(),
    }))
    const moving = isGenericMove(petUi.interaction, placed)
    const particles = driver.hasEffects() ? new ParticleLayer(rig.holder, driver, built.binary) : null
    together = { driver, rig, targets: boneTargets(geometryOf(built.files), rigs), dummies, copies, unroot, size, scale, moving, sounds: new PreviewSounds(built.binary), particles, manifest: manifestOf(built.files) }
    replay = true
    petUi.length = petSessionSeconds(petUi.interaction, petRoleClips(roles, placed, built.load?.meta ?? null, built.files))
    petUi.time = Math.min(petUi.time, petUi.length)
    petUi.note = ''
    return true
}

export function petRoots(scale: number): { root: Affine, unroot: Affine, size: Affine } {
    const size = [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0]
    return { root: engineRoot(size), unroot: invert(engineRoot(IDENTITY)), size }
}

export const PET_PAIR_VIEW_ROOT: readonly number[] = Object.freeze(engineRoot(IDENTITY))

export function petPairRoot(spot: Spot, size: Affine): Affine {
    return multiply(multiply(PET_PAIR_VIEW_ROOT, placement(spot)), size)
}

export function petPairRole(seat: Seat, spot: Spot, age: number): DriverRole {
    const [x, y, z] = seat.actor.anchor
    const radians = (spot.yaw * Math.PI) / 180
    const s = Math.sin(radians)
    const c = Math.cos(radians)
    return { index: seat.role, anchor: [spot.x + x * c - z * s, spot.y + y, spot.z + x * s + z * c], yaw: wrapDegrees(seat.actor.yaw + spot.yaw), age }
}

export function petPairInput(seat: Seat, spot: Spot, size: Affine, time: number, signals: Record<string, number>, variables: Record<string, number>, events: number): DriverInput {
    return {
        signals,
        variables,
        events,
        root: petPairRoot(spot, size),
        ...(seat.role === NO_ROLE ? {} : { role: petPairRole(seat, spot, time) }),
    }
}

export type PetSessionDriver = Pick<CosmeticDriver, 'reset' | 'play' | 'frameAll' | 'sampleEffectRings' | 'breakRings'>

export interface PetEvent {
    at: number
    bits: number
    sent: boolean
}

export type PetSignalChange = SignalChange

export const PET_CATCH_UP_SECONDS = 120
const MAX_PET_EVENTS = 64
const NEAR = 1e-9

export const petSignalsAt = signalsAt
export const petHostAt = hostAt
export const recordPetSignals = recordSignals

export function loopPetSignals(changes: readonly PetSignalChange[], ended: number, keep = PET_CATCH_UP_SECONDS): PetSignalChange[] {
    const shifted = changes.filter((change) => change.at <= ended + NEAR).map((change) => ({ ...change, at: change.at - ended }))
    return compactSignals(shifted, -keep)
}

export function recordPetEvent(history: PetEvent[], at: number, bits: number) {
    if (!bits) return
    const same = history.find((event) => !event.sent && event.at === at)
    if (same) same.bits |= bits
    else history.push({ at, bits, sent: false })
    history.sort((a, b) => a.at - b.at)
    if (history.length > MAX_PET_EVENTS) history.splice(0, history.length - MAX_PET_EVENTS)
}

export function duePetEvents(history: PetEvent[], time: number): number {
    let bits = 0
    for (const event of history) {
        if (event.sent || event.at > time + 1e-9) continue
        event.sent = true
        bits |= event.bits
    }
    return bits
}

export function loopPetEvents(history: readonly PetEvent[], ended: number, keep = PET_CATCH_UP_SECONDS): PetEvent[] {
    return history
        .filter((event) => event.at <= ended + NEAR && event.at - ended >= -keep)
        .map((event) => ({ at: event.at - ended, bits: event.bits, sent: true }))
}

export function nextPetLap(laps: readonly number[], span: number): number[] {
    const next = [...laps, 0].map((start) => start - span)
    while (next.length > 1 && next[1] <= -PET_CATCH_UP_SECONDS) next.shift()
    return next
}

export function petLapStart(laps: readonly number[], at: number): number {
    let start = laps.length ? laps[0] : 0
    for (const lap of [...laps, 0]) if (lap <= at + NEAR) start = lap
    return start
}

export function petLapTime(laps: readonly number[], at: number): number {
    return Math.max(0, at - petLapStart(laps, at))
}

export function replayTicks(time: number, marks: readonly number[], window = PET_CATCH_UP_SECONDS, origin = 0): number[] {
    const earliest = Math.max(marks.reduce((min, at) => Math.min(min, at), Math.min(0, origin)), -window)
    const ticks: number[] = []
    for (let k = Math.ceil(earliest / HOLD_STEP_SECONDS - NEAR) || 0; k * HOLD_STEP_SECONDS < time - NEAR; k++) ticks.push(k * HOLD_STEP_SECONDS)
    for (const at of marks) if (at < time - NEAR) ticks.push(at)
    ticks.sort((a, b) => a - b)
    return ticks.filter((tick, i) => i === 0 || tick - ticks[i - 1] > NEAR)
}

export function replayPetSession(driver: PetSessionDriver, clock: number, time: number, inputsAt: (time: number, events: number) => DriverInput[], history: PetEvent[] = [], changes: readonly PetSignalChange[] = [], view: readonly number[] | null = null, origin = 0, laps: readonly number[] = []) {
    const start = clock - time
    driver.reset()
    driver.play(start + origin)
    for (const event of history) event.sent = false
    let lap: number | null = null
    const enterLap = (at: number) => {
        const begun = petLapStart(laps, at)
        if (lap !== null && begun !== lap) driver.breakRings()
        lap = begun
    }
    for (const tick of replayTicks(time, [...history.map((event) => event.at), ...changes.map((change) => change.at), ...laps], PET_CATCH_UP_SECONDS, origin)) {
        enterLap(tick)
        driver.frameAll(start + tick, inputsAt(tick, duePetEvents(history, tick)))
        if (view) driver.sampleEffectRings(view)
    }
    enterLap(time)
}

function spotsAt(open: Together, time: number): { spots: Spot[], speeds: number[] } {
    const motion = open.moving ? genericPetMotion(petUi.interaction, open.scale, time) : null
    return {
        spots: open.dummies.map((dummy) => motion?.spots[dummy.seat.seat] ?? dummy.seat.spot),
        speeds: open.dummies.map((dummy) => motion?.speeds[dummy.seat.seat] ?? 0),
    }
}

function inputsAt(open: Together, time: number, values: Readonly<Record<string, number>>, host: Readonly<Record<string, number>>, events = 0): DriverInput[] {
    const { spots, speeds } = spotsAt(open, time)
    return open.dummies.map((dummy, i) => {
        const variables = petRoleVariables(host, petUi.interaction, dummy.seat.seat, time)
        if (open.moving) variables.pet_speed = speeds[i]
        return petPairInput(dummy.seat, spots[i], open.size, time, time > NEAR ? petPairSignals(values, petUi.interaction, dummy.seat) : values, variables, i === 0 ? events : 0)
    })
}

function render() {
    const open = together
    if (!open) return
    const pressed = takeEvents()
    recordPetEvent(history, petUi.time, pressed)
    recordPetSignals(signals, petUi.time, preview.values, preview.host)
    const view = open.particles ? cameraView(open.rig.rootInverse, PET_PAIR_VIEW_ROOT) : null
    if (replay) {
        replay = false
        replayPetSession(open.driver, clock, petUi.time, (time, events) => inputsAt(open, petLapTime(laps, time), petSignalsAt(signals, time), petHostAt(signals, time), events), history, signals, view, origin, laps)
    }
    const { driver, dummies, rig } = open
    const { spots } = spotsAt(open, petUi.time)
    const frames: DriverFrame[] = driver.frameAll(clock, inputsAt(open, petUi.time, preview.values, preview.host, duePetEvents(history, petUi.time)))
    if (petUi.playing || pressed) open.sounds.play(driver, driver.soundEvents())
    dummies.forEach((dummy, i) => {
        const place = open.moving ? toBlockbench(rig, multiply(placement(spots[i]), open.size)) : dummy.place
        poseNodes(dummy.nodes, deformsOf(rig, frames[i].bones, open.targets, open.unroot), place)
        dummy.paint.show(dummy.roots, driver, open.manifest, frames[i].colorway)
    })
    if (view) open.particles?.drawView(view, PET_PAIR_VIEW_ROOT)
}

function tick(now: number) {
    frameRequest = null
    if (!together || !petUi.on) return
    const seconds = last ? Math.min(0.1, (now - last) / 1000) : 0
    last = now
    const step = advanceDuo(clock, petUi.time, petUi.length, petUi.playing, seconds)
    if (step.replay) {
        const span = petUi.time + step.clock - clock
        origin -= span
        laps = nextPetLap(laps, span)
        history = loopPetEvents(history, span)
        signals = loopPetSignals(signals, span)
        together.driver.breakRings()
    }
    clock = step.clock
    petUi.time = step.time
    try {
        render()
    } catch (error) {
        console.error('[polyplus_nameplate] the pet role preview failed', error)
        stopPetPlay(`The preview stopped: ${describe(error)}`)
        return
    }
    frameRequest = requestAnimationFrame(tick)
}

function schedule() {
    if (frameRequest === null && petUi.on) frameRequest = requestAnimationFrame(tick)
}

export function startPetPlay(): boolean {
    if (!canPreviewPetRoles()) return false
    claimRig(RIG_OWNER, stopPetPlay)
    takeEvents()
    history = []
    signals = []
    clock = 0
    origin = 0
    laps = []
    last = 0
    replay = false
    petUi.time = 0
    if (typeof Timeline !== 'undefined') (Timeline as any).pause?.()
    if (!open()) {
        releaseRig(RIG_OWNER)
        listeners.notify()
        return false
    }
    petUi.on = true
    petUi.playing = true
    setEngineDriven(true, RIG_OWNER)
    unhook ??= onChecks(() => {
        if (petUi.on && !open()) stopPetPlay(petUi.note)
    })
    schedule()
    listeners.notify()
    return true
}

export function stopPetPlay(note = '') {
    if (frameRequest !== null) cancelAnimationFrame(frameRequest)
    frameRequest = null
    unhook?.()
    unhook = null
    releaseRig(RIG_OWNER)
    const was = petUi.on || !!together
    setEngineDriven(false, RIG_OWNER)
    petUi.on = false
    petUi.playing = false
    petUi.note = note
    history = []
    signals = []
    origin = 0
    laps = []
    if (together) close()
    if (was) listeners.notify()
}

export function togglePetPlay() {
    if (petUi.on) stopPetPlay()
    else startPetPlay()
}

export function playPetRoles(playing: boolean) {
    if (!petUi.on && !startPetPlay()) return
    petUi.playing = playing
    schedule()
    listeners.notify()
}

export function scrubPetRoles(time: number) {
    if (!petUi.on && !startPetPlay()) return
    petUi.playing = false
    const next = Math.max(0, Math.min(petUi.length, Number(time) || 0))
    if (next !== petUi.time) replay = true
    petUi.time = next
    schedule()
    listeners.notify()
}

export function choosePetInteraction(interaction: string) {
    petUi.interaction = interaction
    petUi.time = 0
    history = []
    signals = []
    origin = 0
    laps = []
    if (petUi.on && !open()) stopPetPlay(petUi.note)
    listeners.notify()
}
