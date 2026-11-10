import * as EngineModule from '../../engine/PolyPlus-nameplate-engine.js'
import { BODY_TYPE, BodyArtData, BodyData, LayerData, NAME_MASK, ProjectSnapshot, SPRITE_TYPE, SpriteAnchor, SpriteData } from '../model'
import { pictureStem } from '../palette/ids'
import { readSprites } from '../palette/sprites'
import { presentIntegerAtLeast } from '../util/num'
import { disposeAllSafe } from '../util/teardown'
import { findTexture } from '../util/texture'

const api = EngineModule.org.polyfrost.polyplus.nameplate.engine.js

export const AT_PROPERTY = 'at'
export const ART_PROPERTY = 'art'
export const NO_AT = -1

function engineList(read: () => ArrayLike<string>, fallback: string[]): string[] {
    try {
        const list = Array.from(read())
        return list.length > 0 ? list : fallback
    } catch {
        return fallback
    }
}

export const SPRITE_ANCHORS: string[] = engineList(() => api.NameplateLayout.anchors, [
    'top_left', 'top', 'top_right', 'left', 'right', 'bottom_left', 'bottom', 'bottom_right', 'name_left', 'name_right',
])
const AT_ANCHORS: string[] = engineList(() => api.NameplateLayout.atAnchors, ['top', 'left', 'right', 'bottom'])
const NAME_ANCHORS: string[] = engineList(() => api.NameplateLayout.nameAnchors, ['name_left', 'name_right'])

export function isNameAnchor(anchor: unknown): boolean {
    return typeof anchor === 'string' && NAME_ANCHORS.includes(anchor)
}

export function takesAt(anchor: unknown): boolean {
    return typeof anchor === 'string' && AT_ANCHORS.includes(anchor)
}

export function atValue(value: unknown): number | null {
    const number = Number(value)
    if (!isFinite(number) || number < 0 || number > 1) return null
    return number
}

function columns(value: unknown): [number, number] | null {
    if (!Array.isArray(value) || value.length !== 2) return null
    const from = presentIntegerAtLeast(value[0], 0)
    const to = presentIntegerAtLeast(value[1], 0)
    return from === null || to === null ? null : [from, to]
}

export function readArt(value: unknown): BodyArtData | null {
    if (!value || typeof value !== 'object') return null
    const raw = value as Record<string, unknown>
    const texture = typeof raw.texture === 'string' ? raw.texture : ''
    const sprite = typeof raw.sprite === 'string' ? raw.sprite : ''
    if (!texture && !sprite) return null
    const mirror = raw.mirror === true
    return {
        texture: texture || sprite,
        left: presentIntegerAtLeast(raw.left, 0) ?? 0,
        right: mirror ? 0 : (presentIntegerAtLeast(raw.right, 0) ?? 0),
        mirror,
        segment: columns(raw.segment),
        center: columns(raw.center),
        top: presentIntegerAtLeast(raw.top, 0),
        bottom: presentIntegerAtLeast(raw.bottom, 0),
    }
}

export function artTexture(art: BodyArtData | null | undefined): Texture | null {
    if (!art || typeof Texture === 'undefined') return null
    const byUuid = findTexture(art.texture)
    if (byUuid) return byUuid
    return Texture.all.find((texture) => pictureStem(texture.name) === art.texture) ?? null
}

export function artJson(art: BodyArtData, sprite: string): Record<string, unknown> {
    const file: Record<string, unknown> = { sprite, left: art.left }
    if (art.mirror) file.mirror = true
    else file.right = art.right
    if (art.segment) file.segment = art.segment.slice()
    if (art.center) file.center = art.center.slice()
    if (art.top !== null) file.top = art.top
    if (art.bottom !== null) file.bottom = art.bottom
    return file
}

export function artFromJson(value: unknown): (Omit<BodyArtData, 'texture'> & { sprite: string }) | null {
    if (!value || typeof value !== 'object') return null
    const raw = value as Record<string, unknown>
    if (typeof raw.sprite !== 'string' || !raw.sprite) return null
    const art = readArt({ ...raw, texture: raw.sprite })
    if (!art) return null
    const { texture, ...rest } = art
    return { ...rest, sprite: texture }
}

export function usesLayout(layers: LayerData[]): boolean {
    return layers.some((layer) => {
        if (layer.kind === 'body') return !!layer.art || !!layer.of
        if (layer.kind === 'sprite') return isNameAnchor(layer.anchor) || (takesAt(layer.anchor) && atValue(layer.at) !== null) || !!layer.follow || layer.of === NAME_MASK
        return false
    })
}

export function maskTarget(layer: LayerData, resolve: (reference: string) => string | undefined): string | null | undefined {
    if (!layer.mask) return null
    if (layer.kind === 'path' || layer.kind === 'emitter') return undefined
    if (layer.mask === NAME_MASK) return NAME_MASK
    const target = resolve(layer.mask)
    if (!target) return undefined
    return target === layer.id ? null : target
}

function nodeOf(uuid: string): any {
    if (typeof OutlinerNode === 'undefined') return null
    return (OutlinerNode as any).uuids?.[uuid] ?? null
}

function withSpriteLayout(layer: SpriteData, node: any): SpriteData {
    const anchor = isNameAnchor(node.anchor) ? (node.anchor as SpriteAnchor) : layer.anchor
    const at = atValue(node[AT_PROPERTY])
    if (anchor === layer.anchor && at === null) return layer
    return { ...layer, anchor, at }
}

function withBodyLayout(layer: BodyData, node: any): BodyData {
    const art = readArt(node[ART_PROPERTY])
    if (!art) return layer
    const texture = artTexture(art)
    return { ...layer, art: { ...art, texture: texture?.uuid ?? art.texture } }
}

export function withLayoutData(snapshot: ProjectSnapshot): ProjectSnapshot {
    if (typeof OutlinerNode === 'undefined') return snapshot
    let changed = false
    const layers = snapshot.layers.map((layer) => {
        const node = nodeOf(layer.uuid)
        if (!node) return layer
        const next = layer.kind === 'sprite' && node.type === SPRITE_TYPE
            ? withSpriteLayout(layer, node)
            : layer.kind === 'body' && node.type === BODY_TYPE ? withBodyLayout(layer, node) : layer
        if (next !== layer) changed = true
        return next
    })
    if (!changed) return snapshot
    const artTextures = layers.flatMap((layer) => (layer.kind === 'body' && layer.art && !snapshot.sprites[layer.art.texture] ? [layer.art.texture] : []))
    if (artTextures.length === 0) return { ...snapshot, layers }
    const extra = artTextures.map((texture) => ({ kind: 'sprite', texture }) as unknown as LayerData)
    const { sprites, pixelIssues } = readSprites([...snapshot.layers, ...extra], snapshot.nameplate.palette)
    return { ...snapshot, layers, sprites, pixelIssues }
}

export function linkArtTexture(node: any, textures: Map<string, Texture>) {
    const art = node?.[ART_PROPERTY]
    if (!art || typeof art !== 'object' || typeof art.sprite !== 'string') return
    const { sprite, ...rest } = art
    node[ART_PROPERTY] = { ...rest, texture: textures.get(sprite)?.uuid ?? sprite }
}

const registered: Property[] = []

export function registerLayoutProperties(): () => void {
    const sprite = (OutlinerElement.types as any)[SPRITE_TYPE]
    const body = (OutlinerElement.types as any)[BODY_TYPE]
    if (sprite && !sprite.properties?.[AT_PROPERTY]) registered.push(new Property(sprite, 'number', AT_PROPERTY, { default: NO_AT }))
    if (body && !body.properties?.[ART_PROPERTY]) registered.push(new Property(body, 'object', ART_PROPERTY, { default: () => ({}) }))
    return () => {
        disposeAllSafe(registered, 'could not remove a layout property')
    }
}
