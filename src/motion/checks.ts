import { pathCycle, withoutWrapBursts, withoutWrapSpeed } from '../animate/checks'
import { isOneShot, readSettings, triggerOf } from '../animate/props'
import { assignIds } from '../elements/ids'
import { EFFECT_TYPE } from '../material/types'
import { isGroupNode, isLayerNode, walkNodes } from '../elements/nodes'
import { currentFps, currentLoopFrames } from '../format'
import { BODY_TYPE, FORMAT_ID, LOOP_ANIMATION, NAME_MASK, SPRITE_TYPE } from '../model'
import { ART_PROPERTY, isNameAnchor, readArt } from '../art/layout'
import { showLayer } from '../navigate'
import { SELECT_LAYER } from '../checks/helpers'
import { frameCountOf } from '../palette/sprites'
import { readNameplate } from '../palette/state'
import { findTexture, readTexturePixels } from '../util/texture'
import { readBurstKeys, readSpriteAdaptive } from './read'
import { readPath } from '../kinds/path'
import { readEmitter } from '../kinds/emitter'
import {
    BURST_CHANNEL,
    BurstKey,
    EdgeFollow,
    EMITTER_TYPE,
    EmitterData,
    FACINGS,
    isMotionNode,
    LIMITS,
    MotionLayerData,
    PATH_TYPE,
    PathData,
    PathStop,
    SPEED_CHANNEL,
    SPRITE_FOLLOWS,
    SpriteAdaptiveData,
    SpriteFollow,
    WidthBreakpoint,
} from './types'

export const MOTION_CHECK_ID = 'polyplus_nameplate_motion'

const PLACED: Record<string, { kind: string, field: string, fallback: string, target: string }> = {
    [SPRITE_TYPE]: { kind: 'Sprite', field: 'Placed against', fallback: 'sits against the whole tag', target: 'body' },
    [PATH_TYPE]: { kind: 'Path', field: 'Follows', fallback: 'runs along the whole tag', target: 'body' },
    [EMITTER_TYPE]: { kind: 'Particles', field: 'Around', fallback: 'spawns around the whole tag', target: 'body or sprite' },
    [EFFECT_TYPE]: { kind: 'Effect', field: 'Covers', fallback: "fills the whole tag's background", target: 'body' },
}

export interface MotionProblem {
    level: 'error' | 'warning'
    message: string
    designerOnly?: boolean
}

export interface EdgeBody {
    art: boolean
    height: number
}

export interface MotionContext {
    name: string
    loop: number
    frames(texture: string): number | null
    blank(texture: string): boolean
    edgeBody?: EdgeBody | null
    edgeName: string
    pictureHeight(texture: string): number | null
    triggeredSpeed: boolean
    scheduledBursts: boolean
    oneShotBursts: OneShotBurst[]
}

export interface OneShotBurst {
    keys: BurstKey[]
    copies: number
}

function followProblems(name: string, follow: EdgeFollow | null, textures: string[], context: MotionContext, otherwise = 'pick Outside'): MotionProblem[] {
    const body = context.edgeBody
    if (!follow || body === undefined) return []
    if (body === null) {
        return [{ level: 'warning', message: `${name} follows ${context.edgeName}, which has no corners, so it runs along a plain rectangle. To go around corners, pick a body in the Inspector.` }]
    }
    if (body.art) {
        return [{ level: 'warning', message: `${name} follows a body drawn from a picture, so it runs along a plain rectangle. To go around corners, use a body with no picture.` }]
    }
    const tallest = Math.max(0, ...textures.map((texture) => context.pictureHeight(texture) ?? 0))
    if (follow === 'inside' && tallest > body.height) {
        return [{ level: 'warning', message: `${name}: its picture is ${tallest} px tall, but the body is only ${body.height} px tall on a one-line name, so it can't stay inside. Use a smaller picture, add padding to the body, or ${otherwise}.` }]
    }
    return []
}

function breakpointProblems(name: string, breakpoints: WidthBreakpoint[], mainFrames: number | null, context: MotionContext): MotionProblem[] {
    const problems: MotionProblem[] = []
    breakpoints.forEach((breakpoint, index) => {
        if (breakpoint.max !== null && breakpoint.max <= breakpoint.min) {
            problems.push({ level: 'error', message: `${name}: name width range ${index + 1} stops at ${breakpoint.max}, which is not above where it starts (${breakpoint.min}). Raise the second number, or set it to 0 for no limit.` })
        }
        if (breakpoint.texture && mainFrames !== null) {
            const frames = context.frames(breakpoint.texture)
            if (frames === null) {
                problems.push({ level: 'error', message: `${name}: the picture for name width range ${index + 1} is missing. Pick another picture in the Inspector.` })
            } else if (frames !== mainFrames) {
                problems.push({ level: 'error', message: `${name}: the picture for name width range ${index + 1} has ${frames} frames, the main picture has ${mainFrames}. Give both the same number of frames.` })
            }
        }
    })
    return problems
}

function stopProblems(name: string, stops: PathStop[]): MotionProblem[] {
    const problems: MotionProblem[] = []
    if (stops.length > LIMITS.stops) {
        problems.push({ level: 'error', message: `${name} has ${stops.length} waits; the most is ${LIMITS.stops}. Remove some waits.` })
    }
    const outside = stops.findIndex((stop) => !(stop.at >= 0 && stop.at <= 1))
    if (outside >= 0) {
        problems.push({ level: 'error', message: `${name}: wait ${outside + 1} is not on the path. Set it between 0 and 100% of the path.` })
    }
    const early = stops.findIndex((stop, index) => index > 0 && stop.at <= stops[index - 1].at)
    if (early > 0) {
        problems.push({ level: 'error', message: `${name}: wait ${early + 1} must come later on the path than wait ${early}. Raise its % or lower the one before.` })
    }
    const long = stops.findIndex((stop) => !(stop.pause >= 1 && stop.pause <= LIMITS.pause))
    if (long >= 0) {
        problems.push({ level: 'error', message: `${name}: wait ${long + 1} must last 1 to ${LIMITS.pause} frames.` })
    }
    return problems
}

function lapProblems(name: string, layer: PathData, cycle: number, context: MotionContext): MotionProblem[] {
    const laps = layer.laps
    if (laps === null) return []
    const problems: MotionProblem[] = []
    if (!(Number.isInteger(laps) && laps >= 1 && laps <= LIMITS.laps)) {
        problems.push({ level: 'error', message: `${name} is set to ${laps} laps per loop. It must be a whole number from 1 to ${LIMITS.laps}.` })
    }
    if (layer.end === 'stop') {
        problems.push({ level: 'error', message: `${name}: Laps needs Start again or Turn around at the end. Change At the end, or set Timing to Speed.` })
    }
    if (layer.speedKeys.length > 0) {
        problems.push({ level: 'error', message: `${name} counts laps and has Speed keyframes, which can't go together. Delete the Speed keyframes in Animate, or set Timing to Speed.` })
    }
    if (context.triggeredSpeed) {
        problems.push({ level: 'error', message: `${name} counts laps, so Speed keyframes in a reaction or one-shot can't work on it. Delete them in Animate, or set Timing to Speed.` })
    }
    const waits = layer.stops.reduce((sum, stop) => sum + stop.pause, 0) + layer.points.reduce((sum, point) => sum + point.pause, 0)
    if (waits === 0 || !(laps >= 1)) return problems
    if (cycle % laps !== 0) {
        problems.push({ level: 'error', message: `${name} has waits, so its laps must fit the loop exactly, but ${cycle} frames don't divide by ${laps}. Change Laps per loop or the length of the loop.` })
        return problems
    }
    const total = layer.end === 'bounce' ? waits * 2 : waits
    const lap = cycle / laps
    if (total >= lap) {
        problems.push({ level: 'error', message: `${name}: the waits add up to more than one lap: ${total} frames of ${lap}. Shorten the waits, use fewer laps, or make the loop longer.` })
    }
    return problems
}

export function pathProblems(raw: PathData, context: MotionContext): MotionProblem[] {
    const cycle = pathCycle(context.loop, raw.step)
    const layer: PathData = { ...raw, speedKeys: withoutWrapSpeed(raw.speedKeys, cycle) }
    const name = `Path '${context.name}'`
    const problems: MotionProblem[] = []
    const frames = layer.texture ? context.frames(layer.texture) : null
    if (!layer.texture) {
        problems.push({ level: 'error', message: `${name} has no picture. Pick a picture under Picture in the Inspector.` })
    } else if (frames === null) {
        problems.push({ level: 'error', message: `${name}: its picture is missing. Pick another picture under Picture in the Inspector.` })
    } else if (context.blank(layer.texture)) {
        problems.push({ level: 'warning', message: `${name}: its picture is empty, so nothing walks. Paint the picture, or pick another one under Picture.` })
    }
    if (!layer.preset && layer.points.length < 2) {
        problems.push({ level: 'error', message: `${name} needs at least 2 points. Set Points to 2 or more, or pick a ready-made path.` })
    }
    if (layer.points.length > LIMITS.pathPoints) {
        problems.push({ level: 'error', message: `${name} has ${layer.points.length} points; the most is ${LIMITS.pathPoints}. Remove some points.` })
    }
    const pauses = layer.points.some((point) => point.pause > 0)
    if (pauses && layer.speedKeys.length > 0) {
        problems.push({ level: 'error', message: `${name} has waits at its points and Speed keyframes. Waits need a steady speed: delete the Speed keyframes in Animate, or set every wait to 0.` })
    }
    if (layer.stops.length > 0 && layer.speedKeys.length > 0) {
        problems.push({ level: 'error', message: `${name} has waits along the path and Speed keyframes. Waits need a steady speed: delete the Speed keyframes in Animate, or remove the waits.` })
    }
    problems.push(...stopProblems(name, layer.stops), ...lapProblems(name, layer, cycle, context))
    if (layer.laps === null && layer.speedKeys.length === 0 && !(layer.speed > 0)) {
        problems.push({ level: 'error', message: `${name} has speed 0, so it never moves. Set Speed above 0.` })
    }
    if (layer.speedKeys.length > 0 && layer.speedKeys.every((key) => key.value <= 0)) {
        problems.push({ level: 'warning', message: `${name}: every Speed keyframe is 0, so it never moves. Set one above 0.` })
    }
    for (const key of layer.speedKeys) {
        if (key.step >= cycle) {
            problems.push({
                level: 'error',
                message: key.step === cycle
                    ? `${name} has a Speed keyframe at the very end of the loop, which is the start of the next lap. Give it the same speed as the first Speed keyframe, or move it earlier.`
                    : `${name} has a Speed keyframe after the end of the loop. Move it before the end, or make the loop longer.`,
            })
            break
        }
    }
    if (frames !== null) {
        for (const facing of FACINGS) {
            const list = layer.facings[facing]
            if (list && list.some((frame) => frame >= frames)) {
                problems.push({ level: 'error', message: `${name}: the ${facing} frames go up to ${Math.max(...list)}, but the picture has frames 0 to ${frames - 1}. Fix the numbers under Direction frames.` })
            }
        }
    }
    if (layer.walkers > LIMITS.walkers) {
        problems.push({ level: 'error', message: `${name} has ${layer.walkers} copies. Use ${LIMITS.walkers} or fewer.` })
    }
    if (layer.even && layer.end === 'stop') {
        problems.push({ level: 'error', message: `${name}: evenly spaced copies need Start again or Turn around at the end. Change At the end, or turn off Space them evenly.` })
    }
    if (layer.walkers > 1 && layer.spacing === 0 && !layer.even) {
        problems.push({ level: 'warning', message: `${name}: its ${layer.walkers} copies sit on top of each other. Set a gap between copies, or turn on Space them evenly.` })
    }
    problems.push(...breakpointProblems(name, layer.breakpoints, frames, context))
    problems.push(...followProblems(name, layer.follow, [layer.texture], context))
    return problems
}

function burstWindow(keys: BurstKey[], longest: number, step: number): number {
    const byStep = new Map<number, number>()
    for (const key of keys) byStep.set(key.step, key.count)
    const sorted = Array.from(byStep.entries()).sort((a, b) => a[0] - b[0])
    let most = 0
    for (let first = 0; first < sorted.length; first++) {
        let alive = 0
        for (let key = first; key < sorted.length; key++) {
            if (Math.floor((sorted[key][0] - sorted[first][0]) / step) >= longest) break
            alive += sorted[key][1]
        }
        most = Math.max(most, alive)
    }
    return most
}

export function particleEstimate(layer: EmitterData, loop: number, oneShots: OneShotBurst[]): number {
    const longest = layer.lifetime[1]
    let live = layer.rate ? layer.rate.count * Math.ceil((longest + layer.rate.jitter) / layer.rate.every) : 0
    for (const shot of oneShots) live += shot.copies * burstWindow(shot.keys, longest, Math.max(1, layer.step))
    const cycle = Math.max(1, Math.floor(loop / Math.max(1, layer.step)))
    if (layer.bursts.length > 0) {
        let most = 0
        for (let time = 0; time < cycle; time++) {
            let alive = 0
            for (const burst of layer.bursts) {
                const step = Math.floor(burst.step / Math.max(1, layer.step))
                const laps = Math.floor((time - step) / cycle) - Math.floor((time - step - longest) / cycle)
                alive += laps * burst.count
            }
            most = Math.max(most, alive)
        }
        live += most
    }
    return live
}

export function emitterProblems(raw: EmitterData, context: MotionContext): MotionProblem[] {
    const layer: EmitterData = { ...raw, bursts: withoutWrapBursts(raw.bursts, context.loop) }
    const name = `Particles '${context.name}'`
    const problems: MotionProblem[] = []
    if (layer.sprites.length === 0) {
        problems.push({ level: 'error', message: `${name} has no pictures. Add one under Particles in the Inspector.` })
    }
    if (layer.sprites.length > LIMITS.pool) {
        problems.push({ level: 'error', message: `${name} has ${layer.sprites.length} pictures. Use ${LIMITS.pool} or fewer.` })
    }
    let frames = 0
    for (const texture of layer.sprites) {
        const count = context.frames(texture)
        if (count === null) problems.push({ level: 'error', message: `${name}: one of its pictures is missing. Pick another picture under Particles.` })
        else frames += count
    }
    if (layer.sprites.length > 0 && layer.sprites.every((texture) => context.frames(texture) !== null && context.blank(texture))) {
        problems.push({ level: 'warning', message: `${name}: its pictures are empty, so no particles show. Paint the picture, or pick another one under Particles.` })
    }
    if (frames > LIMITS.cachedStates) {
        problems.push({ level: 'error', message: `${name}: its pictures have ${frames} frames together; the most is ${LIMITS.cachedStates}. Use fewer pictures or frames.` })
    }
    if (!layer.rate && layer.bursts.length === 0 && !context.scheduledBursts) {
        problems.push({ level: 'warning', message: `${name} never sends out particles. Turn on Keep spawning, or add a Burst keyframe in Animate.` })
    }
    if (layer.rate && layer.rate.jitter >= layer.rate.every) {
        problems.push({ level: 'error', message: `${name}: the random delay (${layer.rate.jitter}) must be less than Every (${layer.rate.every}). Lower the delay.` })
    }
    if (layer.lifetime[0] < 1 || layer.lifetime[0] > layer.lifetime[1] || layer.lifetime[1] > LIMITS.lifetime) {
        problems.push({ level: 'error', message: `${name}: Lives for must be two numbers with the first no bigger than the second, between 1 and ${LIMITS.lifetime}.` })
    }
    const ranges: Array<[string, [number, number]]> = [['Sideways speed', layer.velocityX], ['Up or down speed', layer.velocityY]]
    for (const [label, range] of ranges) {
        if (range[0] > range[1]) problems.push({ level: 'error', message: `${name}: ${label} min is above max. Swap the two numbers.` })
    }
    for (const burst of layer.bursts) {
        if (burst.count > LIMITS.burst) {
            problems.push({ level: 'error', message: `${name}: a Burst keyframe asks for ${burst.count} particles. Use ${LIMITS.burst} or fewer.` })
            break
        }
    }
    const late = layer.bursts.find((burst) => burst.step >= context.loop)
    if (late) {
        problems.push({
            level: 'error',
            message: late.step === context.loop
                ? `${name} has a Burst keyframe at the very end of the loop, which is the start of the next lap. Move it to the start, or give it the same count as a burst at the start.`
                : `${name} has a Burst keyframe after the end of the loop. Move it before the end.`,
        })
    }
    const live = particleEstimate(layer, context.loop, context.oneShotBursts)
    if (live > LIMITS.quads) {
        problems.push({ level: 'error', message: `${name} can have about ${live} particles at once, more than the ${LIMITS.quads} a nameplate may draw. Spawn fewer, less often, or for a shorter life.` })
    } else if (live > LIMITS.quads / 4) {
        problems.push({ level: 'warning', message: `${name} can have about ${live} particles at once, which is a lot. Spawn fewer, less often, or for a shorter life.` })
    }
    for (const breakpoint of layer.breakpoints) {
        if (breakpoint.max !== null && breakpoint.max <= breakpoint.min) {
            problems.push({ level: 'error', message: `${name}: a name width range stops at or below where it starts. Raise the second number, or set it to 0 for no limit.` })
            break
        }
    }
    if (layer.fade) {
        const { after, to, steps } = layer.fade
        if (!(after >= 0 && after < 1)) {
            problems.push({ level: 'error', message: `${name}: Start fading after must be at least 0 and below 100%.` })
        }
        if (!(to >= 0 && to <= 1)) {
            problems.push({ level: 'error', message: `${name}: Fade down to must be 0 to 100%.` })
        }
        if (!(Number.isInteger(steps) && steps >= 1 && steps <= LIMITS.fadeSteps)) {
            problems.push({ level: 'error', message: `${name}: Fade steps must be a whole number from 1 to ${LIMITS.fadeSteps}.` })
        }
    }
    problems.push(...followProblems(name, layer.follow, layer.sprites, context, layer.shape === 'area' ? 'pick another Spawn' : 'pick Outside'))
    return problems
}

export function spriteFollowProblems(follow: SpriteFollow, adaptive: SpriteAdaptiveData, nameAnchor: boolean, texture: string, context: MotionContext): MotionProblem[] {
    const name = `Sprite '${context.name}'`
    if (nameAnchor) {
        return [{ level: 'error', message: `${name} sticks to an end of the name, so it can't follow the body's edge. Turn off Follow the body's edge, or pick another point under Sticks to.` }]
    }
    const problems = followProblems(name, follow, [texture], context)
    const edge = adaptive.repeat?.edge
    if (edge === 'left' || edge === 'right') {
        problems.push({ level: 'error', message: `${name} repeats along the ${edge} edge and follows the body's edge. Only the top and bottom edges can follow the curve. Pick one of them under Repeat, or turn following off.` })
    }
    return problems
}

export function spriteAdaptiveProblems(
    adaptive: SpriteAdaptiveData,
    mirror: boolean,
    texture: string,
    context: MotionContext,
): MotionProblem[] {
    const name = `Sprite '${context.name}'`
    const problems: MotionProblem[] = []
    if (texture && context.frames(texture) !== null && context.blank(texture)) {
        problems.push({ level: 'warning', message: `${name}: its picture is empty, so it shows nothing. Paint the picture, or pick another one under Picture in the Inspector.` })
    }
    const repeat = adaptive.repeat
    if (repeat) {
        if (repeat.min > repeat.max) {
            problems.push({ level: 'error', message: `${name}: Repeat "At least" is above "At most". Lower it.` })
        }
        if (mirror) {
            problems.push({ level: 'error', message: `${name} repeats and has a mirrored copy. Turn one of them off.` })
        }
    }
    if (adaptive.breakpoints.length > LIMITS.breakpoints) {
        problems.push({ level: 'error', message: `${name} has ${adaptive.breakpoints.length} name width ranges. Remove some; the most is ${LIMITS.breakpoints}.` })
    }
    problems.push(...breakpointProblems(name, adaptive.breakpoints, texture ? context.frames(texture) : null, context))
    return problems
}

function textureFrames(uuid: string): number | null {
    const texture = findTexture(uuid)
    return texture ? frameCountOf(texture) : null
}

function texturePictureHeight(uuid: string): number | null {
    const texture = findTexture(uuid)
    return texture ? texture.height / Math.max(1, frameCountOf(texture)) : null
}

function edgeBodyOf(node: any, layers: any[]): EdgeBody | null {
    const body = layers.find((entry) => entry.uuid === node.of && entry.type === BODY_TYPE)
    if (!body) return null
    const padding: number[] = Array.isArray(body.padding) ? body.padding : []
    const rings = Array.isArray(body.rings) ? body.rings.length : 0
    return {
        art: !!readArt(body[ART_PROPERTY]),
        height: LIMITS.glyphHeight + (Number(padding[1]) || 0) + (Number(padding[3]) || 0) + rings * 2,
    }
}

function textureBlank(uuid: string): boolean {
    try {
        const pixels = readTexturePixels(findTexture(uuid))
        if (!pixels) return false
        const { data } = pixels
        for (let index = 3; index < data.length; index += 4) {
            if (data[index] !== 0) return false
        }
        return true
    } catch {
        return false
    }
}

function hasTarget(node: any, layers: any[]): boolean {
    if (node.of === NAME_MASK) return node.type === SPRITE_TYPE
    const types = node.type === EMITTER_TYPE ? [BODY_TYPE, SPRITE_TYPE, PATH_TYPE] : [BODY_TYPE]
    return layers.some((entry) => entry.uuid === node.of && types.includes(entry.type))
}

function edgeTarget(node: any, layers: any[]): EdgeBody | null | undefined {
    if (!isMotionNode(node) && node.type !== SPRITE_TYPE) return undefined
    if (!node.of || node.of === NAME_MASK) return null
    if (!hasTarget(node, layers)) return undefined
    return layers.find((entry) => entry.uuid === node.of)?.type === BODY_TYPE ? edgeBodyOf(node, layers) : undefined
}

function placementProblems(node: any, layers: any[]): MotionProblem[] {
    const place = PLACED[node.type]
    if (!place || typeof node.of !== 'string' || !node.of) return []
    if (node.type === SPRITE_TYPE && isNameAnchor(node.anchor)) return []
    if (hasTarget(node, layers)) return []
    const name = `${place.kind} '${String(node.name ?? '')}'`
    return [{ level: 'warning', message: `${name}: the ${place.target} it was placed against is gone, so it now ${place.fallback}. Pick a ${place.target} under ${place.field} in the Inspector.` }]
}

function attachProblems(node: any, layers: any[]): MotionProblem[] {
    if (node.type !== EMITTER_TYPE || !node.of) return []
    const target = layers.find((entry) => entry.uuid === node.of)
    if (!target) return []
    const name = `Particles '${String(node.name ?? '')}'`
    const label = String(target.name ?? '')
    if (target.type === PATH_TYPE) {
        return [{ level: 'error', message: `${name} can't attach to path '${label}'. Pick a body or a sprite under Around.` }]
    }
    if (target.type !== SPRITE_TYPE) return []
    if (target.repeatOn) {
        return [{ level: 'error', message: `${name} is attached to sprite '${label}', which repeats, so there is no single spot for its particles. Pick another layer under Around, or turn off Repeat on that sprite.` }]
    }
    return Object.entries(readNameplate().variants)
        .filter(([, variant]) => variant.hide.includes(target.uuid))
        .map(([key]) => ({ level: 'warning', message: `${name} is attached to sprite '${label}', which variant '${key}' hides, but its particles still show. Hide this layer in that variant too if you don't want them.` }))
}

function nameOnlyProblems(layers: any[]): Array<MotionProblem & { node: any }> {
    const bodies = layers.filter((node) => node.type === BODY_TYPE)
    if (bodies.length === 0 || bodies.some((node) => node.of !== NAME_MASK)) return []
    const plate = readNameplate()
    if (!plate.ownsBackground && !Object.values(plate.variants).some((variant) => variant.ownsBackground)) return []
    const name = String(bodies[0].name ?? '')
    return [{ level: 'warning', designerOnly: true, node: bodies[0], message: `Body '${name}' wraps just the name, so a rank or extra line gets no background. Add a body that wraps the whole tag, or turn off Draws its own background.` }]
}

export function projectMotionProblems(): Array<MotionProblem & { node: any }> {
    const ordered: any[] = []
    const layers: any[] = []
    walkNodes((node) => {
        if (isGroupNode(node)) ordered.push(node)
        else if (isLayerNode(node) || isMotionNode(node)) {
            ordered.push(node)
            layers.push(node)
        }
    })
    const ids = assignIds(ordered.map((node) => ({ uuid: node.uuid, name: node.name })))
    const loop = currentLoopFrames()
    const motion = new Map<string, MotionLayerData | null>()
    for (const node of layers) {
        if (isMotionNode(node)) motion.set(node.uuid, (node.type === PATH_TYPE ? readPath : readEmitter)(node, ids.get(node.uuid) ?? '', ids, layers))
    }
    const shots = oneShotBursts(layers, motion)
    const result: Array<MotionProblem & { node: any }> = []
    for (const node of layers) {
        const context: MotionContext = {
            name: String(node.name ?? ''),
            loop,
            frames: textureFrames,
            blank: textureBlank,
            scheduledBursts: hasKeysOutsideLoop(node, BURST_CHANNEL, true),
            oneShotBursts: shots.get(node.uuid) ?? [],
            edgeBody: edgeTarget(node, layers),
            edgeName: node.of === NAME_MASK ? 'the name' : 'the whole tag',
            pictureHeight: texturePictureHeight,
            triggeredSpeed: hasKeysOutsideLoop(node, SPEED_CHANNEL, false),
        }
        let problems: MotionProblem[] = []
        if (isMotionNode(node)) {
            const data = motion.get(node.uuid) ?? null
            if (data?.kind === 'path') problems = pathProblems(data, context)
            else if (data?.kind === 'emitter') problems = emitterProblems(data, context)
        } else if (node.type === SPRITE_TYPE) {
            const adaptive = readSpriteAdaptive(node)
            const texture = typeof node.texture === 'string' ? node.texture : ''
            problems = spriteAdaptiveProblems(adaptive, !!node.mirror, texture, context)
            if (SPRITE_FOLLOWS.includes(node.follow)) problems.push(...spriteFollowProblems(node.follow, adaptive, isNameAnchor(node.anchor), texture, context))
        }
        for (const problem of [...problems, ...placementProblems(node, layers), ...attachProblems(node, layers)]) result.push({ ...problem, node })
    }
    return [...result, ...nameOnlyProblems(layers)]
}

function mirrorTail(layers: any[]): number {
    let tail = 0
    for (const node of layers) {
        if (!isLayerNode(node) || !node.mirror) continue
        const delay = Math.max(0, Math.round(Number(node.mirrorDelay) || 0))
        const step = Math.max(1, Math.round(Number(node.step) || 1))
        tail = Math.max(tail, delay * step)
    }
    return tail
}

function oneShotBursts(layers: any[], motion: Map<string, MotionLayerData | null>): Map<string, OneShotBurst[]> {
    const fps = currentFps()
    const tail = mirrorTail(layers)
    const result = new Map<string, OneShotBurst[]>()
    for (const animation of Animator.animations as any[]) {
        if (!animation || animation.name === LOOP_ANIMATION) continue
        const settings = readSettings(animation)
        if (!isOneShot(triggerOf(settings))) continue
        const length = Math.max(1, Math.round(animation.length * fps))
        const fired: Array<{ uuid: string, keys: BurstKey[] }> = []
        let end = 0
        for (const [uuid, data] of motion) {
            if (data?.kind !== 'emitter') continue
            const keys = readBurstKeys(uuid, animation, fps)
            if (keys.length === 0) continue
            fired.push({ uuid, keys })
            const last = Math.max(...keys.map((key) => key.step))
            end = Math.max(end, last + (data.lifetime[1] + 1) * Math.max(1, data.step))
        }
        const copies = end > 0 && (settings.restart || end > length + tail) ? 2 : 1
        for (const entry of fired) {
            const list = result.get(entry.uuid) ?? []
            list.push({ keys: entry.keys, copies })
            result.set(entry.uuid, list)
        }
    }
    return result
}

function hasKeysOutsideLoop(node: any, channel: string, scheduledOnly: boolean): boolean {
    return (Animator.animations as any[]).some((animation) => {
        if (!animation || animation.name === LOOP_ANIMATION) return false
        if (scheduledOnly && readSettings(animation).plays === '') return false
        const keys = animation.animators?.[node.uuid]?.[channel]
        return Array.isArray(keys) && keys.length > 0
    })
}

export function createMotionCheck(): ValidatorCheck {
    return new ValidatorCheck(MOTION_CHECK_ID, {
        update_triggers: ['select_project', 'select_animation', 'update_selection', 'finished_edit', 'update_keyframe_selection'],
        condition: { formats: [FORMAT_ID] },
        run(this: ValidatorCheck) {
            for (const problem of projectMotionProblems()) {
                const report = {
                    message: problem.message,
                    buttons: [{ ...SELECT_LAYER, click: () => showLayer(problem.node) }],
                }
                if (problem.level === 'error') this.fail(report as any)
                else this.warn(report as any)
            }
        },
    } as any)
}
