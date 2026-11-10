import type { FlagsState } from './flags/types'
import type { PaletteMotion } from './palanim/types'
import type { BurstKey, EmitterData, PathData, SpeedKey, SpriteAdaptiveData, SpriteFollow } from './motion/types'
import type { MaterialLayerData, MaterialsState } from './material/types'
import type { BadgeOverride, BadgeSettings, TextOverride, TextSettings } from './text/types'

export const FORMAT_ID = 'polyplus_nameplate'
export const BODY_TYPE = 'nameplate_body'
export const SPRITE_TYPE = 'nameplate_sprite'
export const LOOP_ANIMATION = 'loop'
export const BADGE_TYPE = 'nameplate_badge'
export const BADGE_TARGET = '$badge'
export const PLATE_TYPE = 'nameplate_plate'
export const PLATE_TARGET = '$plate'
export const LAYOUT_CAPABILITY = 'layout'
export const CAPABILITIES = ['canvas', 'sprites', 'flags', 'materials', LAYOUT_CAPABILITY]
export const NAME_MASK = '$name'
export const PER_PLAYER_PHASE = 'per_player'

export type Depth = 'behind' | 'background' | 'over_background' | 'over_text'
export type Anchor =
    | 'top_left' | 'top' | 'top_right'
    | 'left' | 'right'
    | 'bottom_left' | 'bottom' | 'bottom_right'
export type NameAnchor = 'name_left' | 'name_right'
export type SpriteAnchor = Anchor | NameAnchor
export type Interpolation = 'step' | 'linear' | 'ease'
export type Channel = 'frame' | 'position' | 'opacity' | 'visible'
export const REACTIONS = ['sneaking', 'sprinting', 'hurt', 'on_fire', 'swimming', 'gliding', 'riding', 'sleeping', 'emote'] as const
export type Reaction = typeof REACTIONS[number]
export type ReactionMode = 'while' | 'start' | 'stop'
export type ReducedMode = 'auto' | 'drop'

export interface Slot {
    id: string
    name: string
    ramp: string[]
    animation?: PaletteMotion
}

export interface PaletteData {
    slots: Slot[]
    colorways: Record<string, Record<string, string[]>>
}

export interface VariantData {
    palette: string
    hide: string[]
    swap: Record<string, string>
    ownsBackground?: boolean
    text?: TextOverride
    badge?: BadgeOverride
    params?: Record<string, number>
}

export interface NameplateData {
    id: string
    fps: number
    ownsBackground: boolean
    phase?: typeof PER_PLAYER_PHASE
    referenceName: string
    text?: TextSettings
    badge?: BadgeSettings
    palette: PaletteData
    variants: Record<string, VariantData>
}

export type FillData =
    | { kind: 'color', ref: string }
    | { kind: 'gradient', slot: string }
    | { kind: 'blend', slot: string }
    | { kind: 'sweep', slot: string, axis: 'x' | 'y' }
    | { kind: 'flag' }

export interface LayerBase {
    uuid: string
    id: string
    depth: Depth
    step: number
    mask?: string | null
    clip?: 'fill' | null
}

export interface BodyArtData {
    texture: string
    left: number
    right: number
    mirror: boolean
    segment: [number, number] | null
    center: [number, number] | null
    top: number | null
    bottom: number | null
}

export interface BodyData extends LayerBase {
    kind: 'body'
    padding: [number, number, number, number]
    minWidth: number
    radius: number
    corners?: [number, number, number, number] | null
    fill: FillData | null
    rings: FillData[]
    art?: BodyArtData | null
    of?: typeof NAME_MASK | null
}

export interface SpriteData extends LayerBase {
    kind: 'sprite'
    texture: string
    of: string | null
    anchor: SpriteAnchor
    at?: number | null
    pivot: Anchor | null
    offset: [number, number]
    mirror: boolean
    mirrorDelay: number
    mirrorSeed: boolean
    adaptive?: SpriteAdaptiveData
    follow?: SpriteFollow | null
}

export type LayerData = BodyData | SpriteData | PathData | EmitterData | MaterialLayerData

export interface GroupData {
    uuid: string
    id: string
    parent: string | null
    layers: string[]
    breakpoints?: Array<{ min: number, max: number | null }>
}

export interface KeyData {
    step: number
    value: number | [number, number] | boolean
    molang?: string | [string | null, string | null]
    interpolation: Interpolation
}

export interface TrackData {
    target: string
    channel: Channel
    keys: KeyData[]
}

export interface LoopData {
    length: number
    tracks: TrackData[]
}

export type TriggerData =
    | { kind: 'reaction', reaction: Reaction, on: ReactionMode }
    | { kind: 'appear', seconds: number }
    | { kind: 'equip' }

export interface ScheduleData {
    window: number
    jitter: number
    chance: number
    weight: number
    id: string | null
}

export interface BurstTrackData {
    target: string
    keys: BurstKey[]
}

export interface SpeedTrackData {
    target: string
    keys: SpeedKey[]
}

export interface PaletteTrackData {
    slot: string
    motion: PaletteMotion
}

export interface AnimationData {
    uuid: string
    name: string
    trigger: TriggerData | null
    schedule: ScheduleData | null
    length: number
    restart: boolean
    tracks: TrackData[]
    bursts?: BurstTrackData[]
    speeds?: SpeedTrackData[]
    palette?: PaletteTrackData[]
    reduced?: ReducedMode | null
}

export interface SpriteFrames {
    id: string
    colors: Record<string, string>
    frames: string[][]
}

export interface PixelIssue {
    texture: string
    frame: number
    x: number
    y: number
    color: string
}

export interface ProjectSnapshot {
    nameplate: NameplateData
    layers: LayerData[]
    groups: GroupData[]
    loop: LoopData | null
    animations?: AnimationData[]
    sprites: Record<string, SpriteFrames>
    pixelIssues: PixelIssue[]
    flags?: FlagsState
    slotMolang?: Record<string, string[]>
    materials?: MaterialsState
}

export interface BundleIssue {
    path: string
    message: string
    animation?: string
}

export interface CompiledBundle {
    files: Record<string, string>
    issues: BundleIssue[]
    warnings?: BundleIssue[]
    binary?: Record<string, Uint8Array>
}
