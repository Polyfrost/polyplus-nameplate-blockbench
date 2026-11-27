import { CosmeticDriver, describe, DriverPlay, engineSignals } from '../engine'
import { createListenerSet } from '../util/events'
import { bundleHash, reloadNeeded } from './bundleHash'
import { lastBuild, onChecks } from './checks'
import { boneTargets, engineRoot, invert } from './livePose'
import { Move, Mover, withMoves } from './moves'
import { ParticleLayer } from './particles'
import { preview, setEngineDriven, takeEvents } from './preview'
import { manifestOf, restoreTextures, showColorway } from './recolor'
import { RIG_PROPERTY } from './project'
import { captureRest, deformsOf, groupNodes, poseNodes, RigNode, RigRest, showDefaultPose, three } from './rigScene'
import { activeKind, readCosmetic } from './state'
import { HOST_VARIABLES } from './autocomplete'
import { HOST_CONTROLS } from './registry'
import { claimRig, releaseRig } from './rigOwner'
import { PreviewSounds } from './sounds'

export const liveUi = { on: false, colorway: '', note: '', effects: [] as string[], playing: '' }

const LIVE_KINDS = ['item', 'pet', 'effect']
const RIG_OWNER = 'live'
const listeners = createListenerSet('a live preview listener failed')

interface Live {
    driver: CosmeticDriver
    targets: string[]
    rig: RigRest
    nodes: RigNode[]
    manifest: unknown
    colorway: number
    particles: ParticleLayer | null
    sounds: PreviewSounds
    hash: string
}

interface MomentRun {
    clip: number
    started: number
    until: number
}

let live: Live | null = null
let moment: MomentRun | null = null
let mover = new Mover()
let clock = 0
let last = 0
let frameRequest: number | null = null
let unhook: (() => void) | null = null

export function onLiveChange(listener: () => void): () => void {
    return listeners.on(listener)
}

export function canGoLive(): boolean {
    const kind = activeKind()
    return !!kind && LIVE_KINDS.includes(kind) && !!three()
}

export function geometryOf(files: Record<string, string>): unknown {
    const path = Object.keys(files).find((name) => name.startsWith('models/') && name.endsWith('.geo.json'))
    if (!path) return null
    try {
        return JSON.parse(files[path])
    } catch {
        return null
    }
}

export function hostVariableNames(): string[] {
    const kind = activeKind()
    if (!kind) return []
    return Array.from(new Set([...(HOST_VARIABLES[kind] ?? []), ...HOST_CONTROLS.filter((control) => control.kinds.includes(kind)).map((control) => control.name)]))
}

function close(keepPose = false) {
    restoreTextures()
    live?.particles?.dispose()
    live?.sounds.dispose()
    live?.driver.dispose()
    live = null
    if (!keepPose) showDefaultPose()
}

function open(): boolean {
    const reopening = !!live
    close(true)
    if (start()) return true
    if (reopening) showDefaultPose()
    return false
}

function start(): boolean {
    const built = lastBuild()
    if (!built) {
        liveUi.note = 'Checks are still running. Try again in a moment.'
        return false
    }
    let driver: CosmeticDriver | null = null
    try {
        driver = CosmeticDriver.open(built.files, built.binary, engineSignals(), hostVariableNames())
    } catch (error) {
        liveUi.note = `The engine couldn't play it: ${describe(error)}`
        return false
    }
    if (!driver) {
        liveUi.note = 'Fix the problems in Checks to play it.'
        return false
    }
    const rigs = new Set(Group.all.filter((group) => (group as any)[RIG_PROPERTY] === true).map((group) => group.name))
    const rig = captureRest()
    live = { driver, targets: boneTargets(geometryOf(built.files), rigs), rig, nodes: groupNodes(rig), manifest: manifestOf(built.files), colorway: -1, particles: null, sounds: new PreviewSounds(built.binary), hash: bundleHash(built.files, built.binary) }
    liveUi.effects = driver.namedEffects()
    moment = null
    liveUi.playing = ''
    if (driver.hasEffects()) live.particles = new ParticleLayer(rig.holder, driver, built.binary)
    driver.play(clock)
    liveUi.note = ''
    return true
}

function pose(bones: Float32Array, root: number[]) {
    if (!live) return
    const unroot = live.driver.rig === 'actor' ? invert(root) : null
    poseNodes(live.nodes, deformsOf(live.rig, bones, live.targets, unroot))
}

function drawParticles(root: number[]) {
    if (live?.particles) live.particles.drawFromCamera(live.rig.rootInverse, root)
}

function tick(now: number) {
    frameRequest = null
    if (!live || !liveUi.on) return
    const seconds = last ? Math.min(0.1, (now - last) / 1000) : 0
    last = now
    clock += seconds
    const moved = mover.step(seconds)
    const root = engineRoot(moved.root)
    try {
        const frame = live.driver.frame(clock, {
            signals: withMoves(preview.values, moved.signals, mover.busy()),
            variables: preview.host,
            events: moved.events | takeEvents(),
            root,
            play: momentPlay(),
        })
        live.sounds.play(live.driver, live.driver.soundEvents())
        pose(frame.bones, root)
        drawParticles(root)
        if (frame.colorway !== live.colorway) {
            live.colorway = frame.colorway
            showColorway(live.driver, live.manifest, frame.colorway)
        }
        const name = frame.colorway >= 0 ? Object.keys(readCosmetic().palette.colorways)[frame.colorway] ?? '' : ''
        if (name !== liveUi.colorway) {
            liveUi.colorway = name
            listeners.notify()
        }
    } catch (error) {
        console.error('[polyplus_nameplate] the live preview failed', error)
        stopLive(`The live preview stopped: ${describe(error)}`)
        return
    }
    frameRequest = requestAnimationFrame(tick)
}

function momentPlay(): DriverPlay | null {
    if (moment && clock <= moment.until) return { clip: moment.clip, age: clock - moment.started }
    if (moment || liveUi.playing) {
        moment = null
        liveUi.playing = ''
        listeners.notify()
    }
    return null
}

export function playLiveEffect(name: string): boolean {
    if (!liveUi.on && !startLive()) return false
    const driver = live?.driver
    if (!driver) return false
    try {
        if (!driver.fireEffect(name)) {
            liveUi.note = `There's no effect called '${name}' in the last build. Wait for Checks to finish.`
            listeners.notify()
            return false
        }
    } catch (error) {
        liveUi.note = `The engine couldn't play '${name}': ${describe(error)}`
        listeners.notify()
        return false
    }
    const plan = driver.moments().find((entry) => entry.name === name)
    if (plan) {
        moment = plan.clip !== null && driver.playsMoments ? { clip: plan.clip, started: clock, until: clock + plan.seconds } : null
        liveUi.playing = moment ? name : ''
    }
    liveUi.note = ''
    schedule()
    listeners.notify()
    return true
}

function schedule() {
    if (frameRequest === null && liveUi.on) frameRequest = requestAnimationFrame(tick)
}

export function startLive(): boolean {
    if (!canGoLive()) return false
    claimRig(RIG_OWNER, stopLive)
    takeEvents()
    mover = new Mover()
    clock = 0
    last = 0
    if (typeof Timeline !== 'undefined') (Timeline as any).pause?.()
    if (!open()) {
        releaseRig(RIG_OWNER)
        listeners.notify()
        return false
    }
    liveUi.on = true
    setEngineDriven(true, RIG_OWNER)
    unhook ??= onChecks(() => {
        if (!liveUi.on) return
        const built = lastBuild()
        if (live && built && !reloadNeeded(live.hash, bundleHash(built.files, built.binary))) return
        if (!open()) stopLive(liveUi.note)
    })
    schedule()
    listeners.notify()
    return true
}

export function stopLive(note = '') {
    if (frameRequest !== null) cancelAnimationFrame(frameRequest)
    frameRequest = null
    unhook?.()
    unhook = null
    releaseRig(RIG_OWNER)
    const was = liveUi.on || !!live
    liveUi.on = false
    setEngineDriven(false, RIG_OWNER)
    liveUi.colorway = ''
    liveUi.note = note
    liveUi.effects = []
    liveUi.playing = ''
    moment = null
    if (live) close()
    if (was) listeners.notify()
}

export function toggleLive() {
    if (liveUi.on) stopLive()
    else startLive()
}

export function liveMove(move: Move) {
    if (!liveUi.on && !startLive()) return
    mover.start(move)
    schedule()
}
