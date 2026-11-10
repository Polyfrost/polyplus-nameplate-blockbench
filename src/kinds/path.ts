import { blockbenchInterpolations, readBack } from '../animate/interpolation'
import type { LayerPlan } from '../import/plan'
import { BODY_TYPE, BundleIssue, Interpolation } from '../model'
import { asEdgeAnchor, asFollow, asPreset, readBreakpoints, readFacings, readPoints, readSpeedKeys, readStops, wholePair } from '../motion/read'
import { EDGE_ANCHORS, FACINGS, PATH_ENDS, PathData, PathEnd } from '../motion/types'
import { decimalOr, wholeOr, wholeOrAtLeast } from '../util/num'
import { isRecord } from '../util/json'
import { asDepth, breakpointsJson, breakpointsPlan, Json, keepUnknown, layerPath, MotionPlanContext, SpriteIds, spriteRef, targetIdOf } from './motion'

export function definePathProperties(target: any) {
    new Property(target, 'string', 'name', { default: 'path' })
    new Property(target, 'boolean', 'visibility', { default: true })
    new Property(target, 'enum', 'depth', { default: 'over_background', values: ['behind', 'background', 'over_background', 'over_text'] })
    new Property(target, 'number', 'step', { default: 1 })
    new Property(target, 'string', 'texture', { default: '' })
    new Property(target, 'string', 'of', { default: '' })
    new Property(target, 'enum', 'pivot', { default: 'bottom', values: EDGE_ANCHORS })
    new Property(target, 'array', 'offset', { default: () => [0, 0] })
    new Property(target, 'string', 'preset', { default: 'top' })
    new Property(target, 'string', 'follow', { default: '' })
    new Property(target, 'object', 'points', { default: () => [] })
    new Property(target, 'number', 'speed', { default: 1 })
    new Property(target, 'enum', 'end', { default: 'wrap', values: PATH_ENDS })
    new Property(target, 'number', 'walkers', { default: 1 })
    new Property(target, 'number', 'spacing', { default: 0 })
    new Property(target, 'boolean', 'lapsOn', { default: false })
    new Property(target, 'number', 'laps', { default: 1 })
    new Property(target, 'boolean', 'reverse', { default: false })
    new Property(target, 'boolean', 'even', { default: false })
    new Property(target, 'object', 'stops', { default: () => [] })
    new Property(target, 'object', 'facings', { default: () => ({}) })
    new Property(target, 'object', 'breakpoints', { default: () => [] })
}

export function readPath(node: any, id: string, ids: Map<string, string>, layers: any[]): PathData {
    const step = wholeOrAtLeast(node.step, 1, 1)
    const preset = node.preset === '' ? null : asPreset(node.preset) ?? 'top'
    return {
        kind: 'path',
        uuid: node.uuid,
        id,
        depth: asDepth(node.depth),
        step,
        texture: typeof node.texture === 'string' ? node.texture : '',
        of: targetIdOf(node.of, ids, layers, [BODY_TYPE]),
        pivot: asEdgeAnchor(node.pivot, 'bottom'),
        offset: wholePair(node.offset, [0, 0]),
        preset,
        follow: preset ? asFollow(node.follow) : null,
        points: preset ? [] : readPoints(node.points),
        speed: Math.max(0, decimalOr(node.speed, 1)),
        speedKeys: readSpeedKeys(node.uuid, step),
        end: PATH_ENDS.includes(node.end as PathEnd) ? (node.end as PathEnd) : 'wrap',
        walkers: wholeOrAtLeast(node.walkers, 1, 1),
        spacing: wholeOrAtLeast(node.spacing, 0, 0),
        facings: readFacings(node.facings),
        breakpoints: readBreakpoints(node.breakpoints),
        laps: node.lapsOn ? wholeOr(node.laps, 1) : null,
        reverse: !!node.reverse,
        even: !!node.even,
        stops: preset ? readStops(node.stops) : [],
    }
}

export function pathJson(layer: PathData, spriteIds: SpriteIds, issues: BundleIssue[]): Json {
    const sprite = spriteRef(layer.texture, spriteIds, layerPath(layer.id, 'texture'), 'path layer', issues) ?? ''
    const file: Json = { kind: 'sprite', sprite }
    if (layer.of) file.of = layer.of
    file.pivot = layer.pivot
    file.offset = layer.offset.slice()
    const path: Json = {}
    if (layer.preset) {
        path.preset = layer.preset
        if (layer.follow) path.follow = layer.follow
    } else {
        path.points = layer.points.map((point) => {
            const entry: Json = { anchor: point.anchor, offset: point.offset.slice() }
            if (point.pause > 0) entry.pause = point.pause
            return entry
        })
    }
    if (layer.laps === null) path.speed = speedJson(layer.speed, layer.speedKeys)
    else path.laps = layer.laps
    path.end = layer.end
    if (layer.reverse) path.reverse = true
    if (layer.preset && layer.stops.length > 0) path.stops = layer.stops.map((stop) => ({ at: stop.at, pause: stop.pause }))
    const frames: Record<string, number[]> = {}
    for (const facing of FACINGS) {
        const list = layer.facings[facing]
        if (list && list.length > 0) frames[facing] = list.slice()
    }
    if (Object.keys(frames).length > 0) path.frames = frames
    file.path = path
    if (layer.even) file.walkers = { count: layer.walkers, even: true }
    else if (layer.walkers !== 1 || layer.spacing !== 0) file.walkers = { count: layer.walkers, spacing: layer.spacing }
    if (layer.breakpoints.length > 0) {
        file.breakpoints = breakpointsJson(layer.breakpoints, layer.texture, spriteIds, layer.id, issues, true)
    }
    return file
}

export function pathProps(id: string, file: any, context: MotionPlanContext, base: { depth: string, step: number }): LayerPlan {
    const path = isRecord(file.path) ? file.path : {}
    keepUnknown(file, PATH_KEYS, PATH_DEFAULTS, id, context)
    for (const key of Object.keys(path)) {
        if (!PATH_FIELD_KEYS.has(key)) context.keep(['path', key], path[key], `Path ${id}: ${key}`)
    }
    const sprite = typeof file.sprite === 'string' ? file.sprite : null
    const preset = asPreset(path.preset)
    const { speed, keys } = speedPlan(path.speed, id, context)
    const walkers = isRecord(file.walkers) ? file.walkers : {}
    const facings = readFacings(path.frames)
    for (const facing of Object.keys(isRecord(path.frames) ? path.frames : {})) {
        if (!(FACINGS as string[]).includes(facing)) context.change(`Path ${id}: direction '${facing}' is not left, right, up or down and was dropped`)
    }
    const breakpoints = breakpointsPlan(file.breakpoints, sprite)
    if (path.follow !== undefined && !(preset && asFollow(path.follow))) {
        context.change(`Path ${id}: following the body's edge only works on a ready-made path, so it was turned off`)
    }
    const stops = Array.isArray(path.stops) ? path.stops : []
    if (stops.length > 0 && !preset) context.change(`Path ${id}: waits along the path only work on a ready-made path, so they were dropped. Give the points their own waits instead`)
    const laps = path.laps ?? null
    if (laps !== null && path.speed !== undefined) context.change(`Path ${id}: it sets both speed and laps, which can't go together, so its speed is ignored`)
    if (walkers.even === true && Number(walkers.spacing) > 0) context.change(`Path ${id}: its copies are spaced evenly, so their gap is ignored`)
    return {
        kind: 'path',
        id,
        of: typeof file.of === 'string' ? file.of : null,
        sprite,
        pool: [],
        breakpointSprites: breakpoints.sprites,
        speedKeys: keys,
        bursts: [],
        props: {
            name: id,
            depth: base.depth,
            step: base.step,
            pivot: asEdgeAnchor(file.pivot ?? file.anchor, 'top_left'),
            offset: wholePair(file.offset, [0, 0]),
            preset: preset ?? '',
            follow: (preset && asFollow(path.follow)) || '',
            points: preset ? [] : readPoints(path.points),
            speed,
            end: PATH_ENDS.includes(path.end) ? path.end : 'wrap',
            walkers: Math.max(1, wholeOr(walkers.count, 1)),
            spacing: Math.max(0, wholeOr(walkers.spacing, 0)),
            lapsOn: laps !== null,
            laps: wholeOr(laps, 1),
            reverse: path.reverse === true,
            even: walkers.even === true,
            stops: preset ? readStops(stops) : [],
            facings,
            breakpoints: breakpoints.list,
        },
    }
}

export function speedJson(speed: number, keys: PathData['speedKeys']): number | unknown[][] {
    if (keys.length === 0) return speed
    const encoded = keys.map((key) => {
        const entry: unknown[] = [key.step, key.value]
        if (TAGGED.includes(key.interpolation)) entry.push(key.interpolation)
        return entry
    })
    if (keys[0].step !== 0) encoded.unshift([0, keys[0].value])
    return encoded
}

export const PATH_KEYS = new Set(['kind', 'sprite', 'of', 'anchor', 'pivot', 'offset', 'path', 'walkers', 'breakpoints'])

export const PATH_DEFAULTS: Record<string, unknown> = { mirror: false, mirrorDelay: 0, mirrorSeed: false }

export const PATH_FIELD_KEYS = new Set(['preset', 'follow', 'points', 'speed', 'end', 'frames', 'laps', 'reverse', 'stops'])

export function speedPlan(raw: unknown, id: string, context: MotionPlanContext): { speed: number, keys: NonNullable<LayerPlan['speedKeys']> } {
    if (!Array.isArray(raw)) return { speed: raw === undefined ? 1 : decimalOr(raw, 1), keys: [] }
    const keys = raw
        .filter((key) => Array.isArray(key) && key.length >= 2)
        .map((key: any[], index) => ({
            step: wholeOr(key[0], 0),
            value: decimalOr(key[1], 0),
            interpolation: index === 0 || key.length < 3 ? 'step' : (['linear', 'ease'].includes(key[2]) ? key[2] : 'step') as Interpolation,
        }))
    const chosen = blockbenchInterpolations(keys.map((key) => key.interpolation))
    for (let i = 1; i < keys.length; i++) {
        const read = readBack(chosen[i - 1], chosen[i])
        if (read !== keys[i].interpolation) {
            context.change(`Path ${id}: speed steps ${keys[i - 1].step} to ${keys[i].step} were ${keys[i].interpolation} and read back as ${read}`)
        }
    }
    return {
        speed: keys[0]?.value ?? 1,
        keys: keys.map((key, index) => ({ step: key.step, value: key.value, interpolation: chosen[index] })),
    }
}

export const TAGGED = ['linear', 'ease']
