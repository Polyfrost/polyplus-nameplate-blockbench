import type { Depth, Interpolation, LayerBase } from '../model'

export const PATH_TYPE = 'nameplate_path'
export const EMITTER_TYPE = 'nameplate_emitter'

export const SPEED_CHANNEL = 'speed'
export const BURST_CHANNEL = 'burst'

export type EdgeAnchor =
    | 'top_left' | 'top' | 'top_right'
    | 'left' | 'right'
    | 'bottom_left' | 'bottom' | 'bottom_right'

export const EDGE_ANCHORS: EdgeAnchor[] = [
    'top_left', 'top', 'top_right',
    'left', 'right',
    'bottom_left', 'bottom', 'bottom_right',
]

export const MOTION_DEPTHS: Depth[] = ['behind', 'background', 'over_background', 'over_text']

export type Edge = 'top' | 'bottom' | 'left' | 'right'
export const EDGES: Edge[] = ['top', 'bottom', 'left', 'right']

export type PathPreset = 'top' | 'bottom' | 'perimeter'
export const PATH_PRESETS: Record<PathPreset, EdgeAnchor[]> = {
    top: ['top_left', 'top_right'],
    bottom: ['bottom_left', 'bottom_right'],
    perimeter: ['top_left', 'top_right', 'bottom_right', 'bottom_left', 'top_left'],
}

export type EdgeFollow = 'outside' | 'line' | 'inside'
export const EDGE_FOLLOWS: EdgeFollow[] = ['outside', 'line', 'inside']

export type SpriteFollow = 'outside' | 'line'
export const SPRITE_FOLLOWS: SpriteFollow[] = ['outside', 'line']

export type PathEnd = 'wrap' | 'bounce' | 'stop'
export const PATH_ENDS: PathEnd[] = ['wrap', 'bounce', 'stop']

export type Facing = 'right' | 'left' | 'up' | 'down'
export const FACINGS: Facing[] = ['right', 'left', 'up', 'down']

export type SpawnShape = 'point' | 'line' | 'area' | 'border'
export const SPAWN_SHAPES: SpawnShape[] = ['point', 'line', 'area', 'border']

export type ParticleFrames = 'loop' | 'stretch'

export const LIMITS = {
    pathPoints: 32,
    pause: 600,
    speed: 16,
    walkers: 32,
    spacing: 256,
    repeats: 64,
    breakpoints: 8,
    width: 4096,
    pool: 8,
    spawnCount: 32,
    lifetime: 240,
    particleSpeed: 16,
    gravity: 4,
    wobble: 8,
    burst: 64,
    offset: 64,
    loop: 600,
    quads: 800,
    spriteFrames: 120,
    cachedStates: 120,
    glyphHeight: 8,
    laps: 64,
    stops: 32,
    fadeSteps: 16,
}

export interface PathPoint {
    anchor: EdgeAnchor
    offset: [number, number]
    pause: number
}

export interface PathStop {
    at: number
    pause: number
}

export interface FadeData {
    after: number
    to: number
    steps: number
}

export interface SpeedKey {
    step: number
    value: number
    interpolation: Interpolation
}

export interface WidthBreakpoint {
    min: number
    max: number | null
    texture: string
}

export interface RepeatData {
    edge: Edge
    spacing: number
    min: number
    max: number
}

export interface SpriteAdaptiveData {
    repeat: RepeatData | null
    breakpoints: WidthBreakpoint[]
}

export interface PathData extends LayerBase {
    kind: 'path'
    texture: string
    of: string | null
    pivot: EdgeAnchor
    offset: [number, number]
    preset: PathPreset | null
    follow: EdgeFollow | null
    points: PathPoint[]
    speed: number
    speedKeys: SpeedKey[]
    end: PathEnd
    walkers: number
    spacing: number
    facings: Partial<Record<Facing, number[]>>
    breakpoints: WidthBreakpoint[]
    laps: number | null
    reverse: boolean
    even: boolean
    stops: PathStop[]
}

export interface BurstKey {
    step: number
    count: number
}

export interface EmitterData extends LayerBase {
    kind: 'emitter'
    sprites: string[]
    of: string | null
    shape: SpawnShape
    follow: EdgeFollow | null
    anchor: EdgeAnchor
    edge: Edge
    spawnOffset: [number, number]
    rate: { every: number, count: number, jitter: number } | null
    lifetime: [number, number]
    velocityX: [number, number]
    velocityY: [number, number]
    gravity: [number, number]
    drift: [number, number]
    wobble: { x: number, y: number, period: number } | null
    frames: ParticleFrames
    bursts: BurstKey[]
    breakpoints: WidthBreakpoint[]
    fade: FadeData | null
}

export type MotionLayerData = PathData | EmitterData

export function isMotionLayer(layer: { kind: string }): layer is MotionLayerData {
    return layer.kind === 'path' || layer.kind === 'emitter'
}

export function isMotionNode(node: any): boolean {
    return !!node && (node.type === PATH_TYPE || node.type === EMITTER_TYPE)
}
