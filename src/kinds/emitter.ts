import type { LayerPlan } from '../import/plan'
import { BODY_TYPE, BundleIssue, SPRITE_TYPE } from '../model'
import { asEdge, asEdgeAnchor, asFollow, decimalPair, readBreakpoints, readBurstKeys, wholePair } from '../motion/read'
import { EDGE_ANCHORS, EDGES, EmitterData, SPAWN_SHAPES, SpawnShape } from '../motion/types'
import { isRecord } from '../util/json'
import { decimalOr, wholeOr, wholeOrAtLeast } from '../util/num'
import { asDepth, breakpointsJson, breakpointsPlan, Json, keepUnknown, layerPath, MotionPlanContext, SpriteIds, spriteRef, targetIdOf } from './motion'

export function defineEmitterProperties(target: any) {
    new Property(target, 'string', 'name', { default: 'emitter' })
    new Property(target, 'boolean', 'visibility', { default: true })
    new Property(target, 'enum', 'depth', { default: 'over_background', values: ['behind', 'background', 'over_background', 'over_text'] })
    new Property(target, 'number', 'step', { default: 1 })
    new Property(target, 'object', 'sprites', { default: () => [] })
    new Property(target, 'string', 'of', { default: '' })
    new Property(target, 'enum', 'shape', { default: 'line', values: SPAWN_SHAPES })
    new Property(target, 'string', 'follow', { default: '' })
    new Property(target, 'enum', 'spawnAnchor', { default: 'top', values: EDGE_ANCHORS })
    new Property(target, 'enum', 'spawnEdge', { default: 'top', values: EDGES })
    new Property(target, 'array', 'spawnOffset', { default: () => [0, 0] })
    new Property(target, 'boolean', 'rateOn', { default: true })
    new Property(target, 'number', 'rateEvery', { default: 4 })
    new Property(target, 'number', 'rateCount', { default: 1 })
    new Property(target, 'number', 'rateJitter', { default: 0 })
    new Property(target, 'array', 'lifetime', { default: () => [8, 12] })
    new Property(target, 'array', 'velocityX', { default: () => [0, 0] })
    new Property(target, 'array', 'velocityY', { default: () => [-0.5, -0.25] })
    new Property(target, 'array', 'gravity', { default: () => [0, 0] })
    new Property(target, 'array', 'drift', { default: () => [0, 0] })
    new Property(target, 'boolean', 'wobbleOn', { default: false })
    new Property(target, 'array', 'wobble', { default: () => [1, 0] })
    new Property(target, 'number', 'wobblePeriod', { default: 8 })
    new Property(target, 'enum', 'particleFrames', { default: 'loop', values: ['loop', 'stretch'] })
    new Property(target, 'boolean', 'fadeOn', { default: false })
    new Property(target, 'number', 'fadeAfter', { default: 0.5 })
    new Property(target, 'number', 'fadeTo', { default: 0 })
    new Property(target, 'number', 'fadeSteps', { default: 4 })
    new Property(target, 'object', 'breakpoints', { default: () => [] })
}

export function readEmitter(node: any, id: string, ids: Map<string, string>, layers: any[]): EmitterData {
    const sprites = Array.isArray(node.sprites) ? node.sprites.filter((uuid: unknown): uuid is string => typeof uuid === 'string' && !!uuid) : []
    const wobble = wholePair(node.wobble, [0, 0])
    const shape = SPAWN_SHAPES.includes(node.shape as SpawnShape) ? (node.shape as SpawnShape) : 'line'
    return {
        kind: 'emitter',
        uuid: node.uuid,
        id,
        depth: asDepth(node.depth),
        step: wholeOrAtLeast(node.step, 1, 1),
        sprites,
        of: targetIdOf(node.of, ids, layers, [BODY_TYPE, SPRITE_TYPE]),
        shape,
        follow: shape === 'border' || (shape === 'area' && node.follow === 'inside') ? asFollow(node.follow) : null,
        anchor: asEdgeAnchor(node.spawnAnchor, 'top'),
        edge: asEdge(node.spawnEdge, 'top'),
        spawnOffset: wholePair(node.spawnOffset, [0, 0]),
        rate: node.rateOn
            ? { every: wholeOrAtLeast(node.rateEvery, 1, 4), count: wholeOrAtLeast(node.rateCount, 1, 1), jitter: wholeOrAtLeast(node.rateJitter, 0, 0) }
            : null,
        lifetime: wholePair(node.lifetime, [8, 12]),
        velocityX: decimalPair(node.velocityX, [0, 0]),
        velocityY: decimalPair(node.velocityY, [0, 0]),
        gravity: decimalPair(node.gravity, [0, 0]),
        drift: decimalPair(node.drift, [0, 0]),
        wobble: node.wobbleOn ? { x: wobble[0], y: wobble[1], period: wholeOrAtLeast(node.wobblePeriod, 1, 8) } : null,
        frames: node.particleFrames === 'stretch' ? 'stretch' : 'loop',
        bursts: readBurstKeys(node.uuid),
        breakpoints: readBreakpoints(node.breakpoints),
        fade: node.fadeOn ? { after: decimalOr(node.fadeAfter, 0), to: decimalOr(node.fadeTo, 0), steps: wholeOr(node.fadeSteps, 4) } : null,
    }
}

export function emitterJson(layer: EmitterData, spriteIds: SpriteIds, issues: BundleIssue[]): Json {
    const sprites: string[] = []
    if (layer.sprites.length === 0) issues.push({ path: layerPath(layer.id, 'sprites'), message: 'particles have no sprites' })
    layer.sprites.forEach((texture, index) => {
        const sprite = spriteRef(texture, spriteIds, layerPath(layer.id, `sprites[${index}]`), 'particles sprite', issues)
        if (sprite && !sprites.includes(sprite)) sprites.push(sprite)
    })
    const file: Json = { kind: 'emitter', sprites }
    if (layer.of) file.of = layer.of
    const spawn: Json = { shape: layer.shape, anchor: layer.anchor, edge: layer.edge, offset: layer.spawnOffset.slice() }
    if (layer.follow) spawn.follow = layer.follow
    file.spawn = spawn
    if (layer.rate) file.rate = { every: layer.rate.every, count: layer.rate.count, jitter: layer.rate.jitter }
    file.lifetime = layer.lifetime.slice()
    file.velocity = { x: layer.velocityX.slice(), y: layer.velocityY.slice() }
    file.gravity = layer.gravity.slice()
    file.drift = layer.drift.slice()
    if (layer.wobble) file.wobble = { x: layer.wobble.x, y: layer.wobble.y, period: layer.wobble.period }
    file.frames = layer.frames
    if (layer.fade) file.fade = { after: layer.fade.after, to: layer.fade.to, steps: layer.fade.steps }
    if (layer.breakpoints.length > 0) {
        file.breakpoints = breakpointsJson(layer.breakpoints, null, spriteIds, layer.id, issues, false)
    }
    return file
}

export function emitterProps(id: string, file: any, context: MotionPlanContext, base: { depth: string, step: number }): LayerPlan {
    keepUnknown(file, EMITTER_KEYS, {}, id, context)
    const spawn = isRecord(file.spawn) ? file.spawn : {}
    const rate = isRecord(file.rate) ? file.rate : null
    const velocity = isRecord(file.velocity) ? file.velocity : {}
    const wobble = isRecord(file.wobble) ? file.wobble : null
    const pool = Array.isArray(file.sprites) ? file.sprites.filter((sprite: unknown): sprite is string => typeof sprite === 'string') : []
    const breakpoints = breakpointsPlan(file.breakpoints, null)
    const shape = ['point', 'line', 'area', 'border'].includes(spawn.shape) ? spawn.shape : 'point'
    const follow = shape === 'border' ? asFollow(spawn.follow) : shape === 'area' && spawn.follow === 'inside' ? 'inside' : null
    if (spawn.follow !== undefined && !follow) {
        context.change(`Particles ${id}: following the body's edge only works when particles spawn all around the border or anywhere inside the shape, so it was turned off`)
    }
    const fade = isRecord(file.fade) ? file.fade : null
    return {
        kind: 'emitter',
        id,
        of: typeof file.of === 'string' ? file.of : null,
        sprite: null,
        pool,
        breakpointSprites: breakpoints.sprites,
        speedKeys: [],
        bursts: [],
        props: {
            name: id,
            depth: base.depth,
            step: base.step,
            shape,
            follow: follow ?? '',
            spawnAnchor: asEdgeAnchor(spawn.anchor, 'top_left'),
            spawnEdge: asEdge(spawn.edge, 'top'),
            spawnOffset: wholePair(spawn.offset, [0, 0]),
            rateOn: !!rate,
            rateEvery: rate ? Math.max(1, wholeOr(rate.every, 1)) : 4,
            rateCount: rate ? Math.max(1, wholeOr(rate.count, 1)) : 1,
            rateJitter: rate ? Math.max(0, wholeOr(rate.jitter, 0)) : 0,
            lifetime: wholePair(file.lifetime, [1, 1]),
            velocityX: decimalPair(velocity.x, [0, 0]),
            velocityY: decimalPair(velocity.y, [0, 0]),
            gravity: decimalPair(file.gravity, [0, 0]),
            drift: decimalPair(file.drift, [0, 0]),
            wobbleOn: !!wobble,
            wobble: wobble ? [wholeOr(wobble.x, 0), wholeOr(wobble.y, 0)] : [1, 0],
            wobblePeriod: wobble ? Math.max(1, wholeOr(wobble.period, 1)) : 8,
            particleFrames: file.frames === 'stretch' ? 'stretch' : 'loop',
            fadeOn: !!fade,
            fadeAfter: fade ? decimalOr(fade.after, 0) : 0.5,
            fadeTo: fade ? decimalOr(fade.to, 0) : 0,
            fadeSteps: fade ? wholeOr(fade.steps, 4) : 4,
            breakpoints: breakpoints.list,
        },
    }
}

export const EMITTER_KEYS = new Set(['kind', 'sprites', 'of', 'spawn', 'rate', 'lifetime', 'velocity', 'gravity', 'drift', 'wobble', 'frames', 'breakpoints', 'fade'])
