import { bodyOptions, currentNode, EDGE_LABELS, flag, followPart, list, pairField, paintPicture, percentOf, PERCENT, rangesPart, textureOptions, whole, WHOLE_TAG } from './motionForm'
import { limited, limitedDecimals, limitedPair, limitedValue, tell } from '../elements/limits'
import { layerNodes } from '../elements/nodes'
import { isSectionOpen, setSectionOpen } from '../inspector/sections'
import { SPRITE_TYPE } from '../model'
import { ANCHOR_LABELS, secondsHint } from '../motion/form'
import { readBreakpoints } from '../motion/read'
import { EDGE_ANCHORS, EDGES, LIMITS, SPAWN_SHAPES } from '../motion/types'
import { field, fixed, group, heading, labeled, note, Part, Values } from '../schema/form'
import { widthRanges } from './ranges'

const SHAPE_LABELS: Record<string, string> = {
    point: 'From one point',
    line: 'Along an edge',
    area: 'Anywhere in the box',
    area_inside: 'Anywhere inside the shape',
    border: 'All around the border',
}
const AREA_INSIDE = 'area_inside'
const FOLDED_MARK = 'layer.emitter.folded'
const FOLDED_SECTIONS = ['layer.emitter.bursts', 'layer.emitter.more_motion']

const rateOn = (result: Values) => !!result?.rate_on
const wobbleOn = (result: Values) => !!result?.wobble_on
const fadeOn = (result: Values) => !!result?.fade_on
const anchors = () => labeled(EDGE_ANCHORS, ANCHOR_LABELS)

const emitterRanges = widthRanges({
    prefix: 'bp',
    read: (node) => readBreakpoints(node.breakpoints),
    onDescription: 'Hides this layer outside the ranges below',
    fallback: 'current',
})

function foldEmitterSections() {
    if (!isSectionOpen(FOLDED_MARK)) return
    setSectionOpen(FOLDED_MARK, false)
    for (const section of FOLDED_SECTIONS) setSectionOpen(section, false)
}

function emitterTargets(current: string): Record<string, string> {
    const result = bodyOptions('', WHOLE_TAG)
    for (const sprite of layerNodes().filter((entry) => entry.type === SPRITE_TYPE && !entry.repeatOn)) result[sprite.uuid] = `Sprite: ${sprite.name}`
    if (!current || current in result) return result
    const target = layerNodes().find((entry) => entry.uuid === current)
    result[current] = target ? `${target.name} (can't hold particles: pick another)` : 'Missing layer'
    return result
}

function poolCount(node: any): number {
    const sprites = Array.isArray(node.sprites) ? node.sprites : []
    return Math.max(1, Math.min(LIMITS.pool, sprites.length || 1))
}

function fadeStepCount(value: unknown, fallback: number): number {
    if (Number(value) > LIMITS.fadeSteps) {
        tell(`The most is ${LIMITS.fadeSteps} fade steps, so it was set to ${LIMITS.fadeSteps}.`)
        return LIMITS.fadeSteps
    }
    return limited(value, 1, LIMITS.fadeSteps, fallback, 'Fade steps')
}

function applySpawnShape(node: any, value: unknown) {
    if (value === AREA_INSIDE) {
        node.shape = 'area'
        node.follow = 'inside'
        return
    }
    if (!SPAWN_SHAPES.includes(value as any)) return
    if (node.follow === 'inside' && (node.shape === 'area' || value === 'area')) node.follow = ''
    node.shape = value
}

const pool = list({
    count: 'pool_count',
    countInput: { type: 'number', label: 'Different pictures', step: 1, value: 1, description: 'Each particle picks one of these at random' },
    owns: (key) => /^pool_\d+$/.test(key),
    total: poolCount,
    row: (index, node) => {
        const sprites: string[] = Array.isArray(node.sprites) ? node.sprites : []
        return {
            [`pool_${index}`]: {
                type: 'select',
                label: `Picture ${index + 1}`,
                options: textureOptions('None', sprites[index] ?? ''),
                condition: ((result: Values) => Number(result?.pool_count ?? 1) > index) as any,
            },
            [`pool_${index}_paint`]: {
                type: 'buttons',
                buttons: ['Paint this picture'],
                condition: ((result: Values) => Number(result?.pool_count ?? 1) > index && !!result?.[`pool_${index}`]) as any,
                click: () => paintPicture(currentNode()?.sprites?.[index]),
            },
        }
    },
    values: (node) => {
        const sprites: string[] = Array.isArray(node.sprites) ? node.sprites : []
        const values: Values = { pool_count: poolCount(node) }
        sprites.slice(0, LIMITS.pool).forEach((uuid, index) => {
            values[`pool_${index}`] = uuid
        })
        return values
    },
    apply: (node, result) => {
        const current: string[] = Array.isArray(node.sprites) ? node.sprites : []
        const count = limited(result.pool_count, 1, LIMITS.pool, 1, 'Different pictures')
        const next: string[] = []
        for (let index = 0; index < count; index++) {
            const value = result[`pool_${index}`]
            next.push(typeof value === 'string' ? value : (current[index] ?? ''))
        }
        node.sprites = next
    },
})

export function emitterForm(placement: Part, onNewSprite: () => void, onPreset: () => void, onImport: () => void): Part {
    return group(
        fixed(() => {
            foldEmitterSections()
            return {}
        }),
        fixed({ preset: { type: 'buttons', buttons: ['Start from a preset...'], click: () => onPreset() } }),
        heading('pool_title', 'Particles'),
        pool,
        fixed({
            pool_new: { type: 'buttons', buttons: ['New particle picture'], click: () => onNewSprite() },
            import_picture: { type: 'buttons', buttons: ['Add picture...'], click: () => onImport(), description: 'Adds a PNG file to the pictures above' },
        }),
        field('particle_frames', {
            input: { type: 'select', label: 'Animation', options: { loop: 'Loop the frames', stretch: 'Play once over its life' }, value: 'loop' },
            get: (node) => (node.particleFrames === 'stretch' ? 'stretch' : 'loop'),
            set: (node, value) => {
                node.particleFrames = value === 'stretch' ? 'stretch' : 'loop'
            },
        }),
        heading('spawn_title', 'Where they appear'),
        field('of', {
            input: (node) => ({ type: 'select', label: 'Around', options: emitterTargets(node.of ?? ''), description: 'The whole tag, one body, or one sprite. Particles around a moving sprite move with it' }),
            get: (node) => node.of ?? '',
            set: (node, value) => {
                node.of = String(value ?? '')
            },
        }),
        field('spawn_shape', {
            input: { type: 'select', label: 'Spawn', options: SHAPE_LABELS, value: 'line' },
            get: (node) => (node.shape === 'area' && node.follow === 'inside' ? AREA_INSIDE : (node.shape ?? 'line')),
            set: (node, value) => applySpawnShape(node, value),
        }),
        followPart('spawn_follow', (result) => result?.spawn_shape === 'border'),
        field('spawn_anchor', {
            input: { type: 'select', label: 'Point', options: anchors(), condition: ((result: Values) => result?.spawn_shape === 'point') as any },
            get: (node) => node.spawnAnchor ?? 'top',
            set: (node, value) => {
                if (EDGE_ANCHORS.includes(value)) node.spawnAnchor = value
            },
        }),
        field('spawn_edge', {
            input: { type: 'select', label: 'Edge', options: labeled(EDGES, EDGE_LABELS), condition: ((result: Values) => result?.spawn_shape === 'line') as any },
            get: (node) => node.spawnEdge ?? 'top',
            set: (node, value) => {
                if (EDGES.includes(value)) node.spawnEdge = value
            },
        }),
        pairField('spawn_offset', 'spawnOffset', { type: 'vector', label: 'Nudge x, y (px, + is down)', dimensions: 2, step: 1, force_step: true, value: [0, 0] }, [0, 0], (value) => limitedPair(value, -LIMITS.offset, LIMITS.offset, 'Nudge')),
        heading('timing_title', 'When they appear'),
        flag('rate_on', 'rateOn', 'Keep spawning', true, { description: 'Off: particles only come from Burst keyframes you add to this layer in Animate' }),
        whole('rate_every', 'rateEvery', () => ({ type: 'number', label: 'Every (frames)', step: 1, value: 4, condition: rateOn as any, description: secondsHint() }), 1, LIMITS.loop, 4, 'Every'),
        whole('rate_count', 'rateCount', { type: 'number', label: 'How many each time', step: 1, value: 1, condition: rateOn as any }, 1, LIMITS.spawnCount, 1, 'How many each time'),
        whole('rate_jitter', 'rateJitter', { type: 'number', label: 'Random delay up to (frames)', step: 1, value: 0, condition: rateOn as any, description: 'Must be less than Every' }, 0, LIMITS.loop - 1, 0, 'Random delay'),
        pairField('life', 'lifetime', () => ({ type: 'vector', label: 'Lives for min, max (frames)', dimensions: 2, step: 1, force_step: true, value: [8, 12], description: secondsHint() }), [8, 12], (value) => limitedPair(value, 1, LIMITS.lifetime, 'Lives for')),
        heading('bursts_title', 'Bursts'),
        note('burst_note', 'For a burst, add a **Burst** keyframe in Animate. Its value is how many particles appear.'),
        heading('motion_title', 'How they move'),
        pairField('velocity_x', 'velocityX', { type: 'vector', label: 'Sideways speed min, max', dimensions: 2, step: 0.05, value: [0, 0], description: 'Px per frame. Negative goes left' }, [0, 0], (value) => limitedDecimals(value, LIMITS.particleSpeed, 'Sideways speed')),
        pairField('velocity_y', 'velocityY', { type: 'vector', label: 'Up or down speed min, max', dimensions: 2, step: 0.05, value: [0, 0], description: 'Px per frame. Negative goes up' }, [0, 0], (value) => limitedDecimals(value, LIMITS.particleSpeed, 'Up or down speed')),
        flag('fade_on', 'fadeOn', 'Fade out', false),
        field('fade_after', {
            input: { type: 'number', label: 'Start fading after (% of its life)', step: 5, value: 50, condition: fadeOn as any, description: 'Must be below 100' },
            get: (node) => percentOf(Number(node.fadeAfter ?? 0.5)),
            set: (node, value) => {
                node.fadeAfter = limitedValue(value, 0, PERCENT - 1, percentOf(node.fadeAfter ?? 0.5), 'Start fading after') / PERCENT
            },
        }),
        field('fade_to', {
            input: { type: 'number', label: 'Fade down to (% opacity)', step: 5, value: 0, condition: fadeOn as any },
            get: (node) => percentOf(Number(node.fadeTo ?? 0)),
            set: (node, value) => {
                node.fadeTo = limitedValue(value, 0, PERCENT, percentOf(node.fadeTo ?? 0), 'Fade down to') / PERCENT
            },
        }),
        field('fade_steps', {
            input: { type: 'number', label: 'Fade steps', step: 1, value: 4, condition: fadeOn as any, description: `The most is ${LIMITS.fadeSteps}` },
            get: (node) => Number(node.fadeSteps ?? 4),
            set: (node, value) => {
                node.fadeSteps = fadeStepCount(value, node.fadeSteps ?? 4)
            },
        }),
        heading('more_motion_title', 'More movement'),
        pairField('gravity', 'gravity', { type: 'vector', label: 'Gravity x, y', dimensions: 2, step: 0.01, value: [0, 0], description: 'Speeds particles up over time. Positive y pulls down' }, [0, 0], (value) => limitedDecimals(value, LIMITS.gravity, 'Gravity')),
        pairField('drift', 'drift', { type: 'vector', label: 'Drift x, y', dimensions: 2, step: 0.05, value: [0, 0], description: 'A steady push added to every particle' }, [0, 0], (value) => limitedDecimals(value, LIMITS.particleSpeed, 'Drift')),
        flag('wobble_on', 'wobbleOn', 'Wobble', false),
        pairField('wobble', 'wobble', { type: 'vector', label: 'Wobble x, y (px)', dimensions: 2, step: 1, force_step: true, value: [1, 0], condition: wobbleOn as any }, [1, 0], (value) => limitedPair(value, -LIMITS.wobble, LIMITS.wobble, 'Wobble')),
        whole('wobble_period', 'wobblePeriod', { type: 'number', label: 'Wobble every (frames)', step: 1, value: 8, condition: wobbleOn as any }, 1, LIMITS.lifetime, 8, 'Wobble every'),
        rangesPart(emitterRanges),
        placement,
    )
}
