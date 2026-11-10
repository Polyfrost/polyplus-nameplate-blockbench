import { animationPath, checkAnimations, dropWrapKeys, scheduleGroups, scheduleIdOf } from './animate/checks'
import { isWhile } from './animate/props'
import { describe, loadBundle } from './engine'
import { bodyJson } from './kinds/body'
import { spriteJson as spriteLayerJson } from './kinds/sprite'
import { stringifyJson } from './util/bundleJson'
import { DEFAULT_LOOP_FRAMES } from './format'
import { currentExtra, mergeExtra } from './import/extra'
import { groupBreakpointsJson } from './library/groups'
import { applyFlags } from './flags/compile'
import { applyPaletteAnimation } from './palanim/compile'
import { applyMotionManifest, layerTextureUuids, usesSprites } from './motion/compile'
import { pathJson } from './kinds/path'
import { emitterJson } from './kinds/emitter'
import { BURST_CHANNEL, BurstKey, SPEED_CHANNEL, SpeedKey } from './motion/types'
import { reactionPaletteTracks } from './palanim/reaction'
import { applyMaterials } from './material/compile'
import { effectJson } from './kinds/effect'
import { isMaterialLayer, MaterialsState } from './material/types'
import { keyValueJson } from './molang/keys'
import { applySlotMolang } from './molang/slots'
import { textBadgeManifest, variantStyleJson } from './text/compile'
import { letterTracksJson, withLetters } from './text/reaction'
import { colorwaysJson, slotJson } from './palette/blend'
import { maskTarget, usesLayout, withLayoutData } from './art/layout'
import {
    AnimationData,
    BundleIssue,
    Channel,
    CompiledBundle,
    KeyData,
    LayerData,
    LAYOUT_CAPABILITY,
    PER_PLAYER_PHASE,
    ProjectSnapshot,
    SpriteFrames,
    TrackData,
} from './model'

const CHANNEL_ORDER: Channel[] = ['frame', 'position', 'opacity', 'visible']
const TAGGED_INTERPOLATIONS = ['linear', 'ease']
const TEXTURE_GONE = 'texture not found'
const NO_SPRITE_ID = "sprite id ''"

let snapshotSource: (() => ProjectSnapshot) | null = null
let cacheKey: string | null = null
let cacheValue: CompiledBundle | null = null

export function setSnapshotSource(source: () => ProjectSnapshot): void {
    snapshotSource = source
    cacheKey = null
    cacheValue = null
}

function spriteJson(sprite: SpriteFrames): Record<string, unknown> {
    if (sprite.frames.length === 1) return { colors: sprite.colors, rows: sprite.frames[0] }
    return { colors: sprite.colors, frames: sprite.frames }
}

function keyJson(key: KeyData): unknown[] {
    const entry: unknown[] = [key.step, keyValueJson(key)]
    if (TAGGED_INTERPOLATIONS.includes(key.interpolation)) entry.push(key.interpolation)
    return entry
}

function keysJson(keys: KeyData[]): unknown[][] {
    const sorted = keys
        .map((key, index) => ({ key, index }))
        .sort((a, b) => a.key.step - b.key.step || a.index - b.index)
        .map((entry) => entry.key)
    const encoded = sorted.map(keyJson)
    if (sorted.length > 0 && sorted[0].step !== 0) encoded.unshift([0, keyValueJson(sorted[0])])
    return encoded
}

function tracksJson(
    tracks: TrackData[],
    resolve: (reference: string) => string,
    issues: BundleIssue[],
    animation = 'loop',
): Record<string, Record<string, unknown[][]>> {
    const byTarget = new Map<string, Map<string, TrackData>>()
    for (const track of tracks) {
        const target = resolve(track.target)
        let channels = byTarget.get(target)
        if (!channels) {
            channels = new Map()
            byTarget.set(target, channels)
        }
        if (channels.has(track.channel)) {
            issues.push({
                path: `manifest.json#animations.${animation}.tracks.${target}.${track.channel}`,
                message: 'more than one track for this channel',
            })
            continue
        }
        channels.set(track.channel, track)
    }
    const result: Record<string, Record<string, unknown[][]>> = {}
    for (const [target, channels] of byTarget) {
        const entry: Record<string, unknown[][]> = {}
        const names = [
            ...CHANNEL_ORDER.filter((name) => channels.has(name)),
            ...Array.from(channels.keys()).filter((name) => !CHANNEL_ORDER.includes(name as Channel)),
        ]
        for (const name of names) entry[name] = keysJson(channels.get(name)!.keys)
        result[target] = entry
    }
    return result
}

function inSteps(tracks: TrackData[], step: number): TrackData[] {
    if (step <= 1) return tracks
    return tracks.map((track) => {
        const byStep = new Map<number, KeyData>()
        for (const key of track.keys) byStep.set(Math.round(key.step / step), { ...key, step: Math.round(key.step / step) })
        return { ...track, keys: Array.from(byStep.values()) }
    })
}

function burstsInSteps(keys: BurstKey[], step: number): unknown[][] {
    const byStep = new Map<number, number>()
    for (const key of keys) byStep.set(Math.round(key.step / Math.max(1, step)), key.count)
    return Array.from(byStep.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([at, count]) => [at, count])
}

function addBursts(
    tracks: Record<string, Record<string, unknown>>,
    animation: AnimationData,
    step: number,
    resolve: (reference: string) => string,
) {
    for (const burst of animation.bursts ?? []) {
        const target = resolve(burst.target)
        tracks[target] = { ...(tracks[target] ?? {}), [BURST_CHANNEL]: burstsInSteps(burst.keys, step) }
    }
}

function speedKeysJson(keys: SpeedKey[]): unknown[][] {
    const byFrame = new Map<number, SpeedKey>()
    for (const key of keys) byFrame.set(key.step, key)
    const sorted = Array.from(byFrame.values()).sort((a, b) => a.step - b.step)
    const encoded = sorted.map((key, index) => {
        const entry: unknown[] = [key.step, key.value]
        if (index > 0 && TAGGED_INTERPOLATIONS.includes(key.interpolation)) entry.push(key.interpolation)
        return entry
    })
    if (sorted.length > 0 && sorted[0].step !== 0) encoded.unshift([0, sorted[0].value])
    return encoded
}

function triggeredTracks(
    animation: AnimationData,
    snapshot: ProjectSnapshot,
    length: number,
    resolve: (reference: string) => string,
    issues: BundleIssue[],
): Record<string, Record<string, unknown>> {
    const tracks: Record<string, Record<string, unknown>> = tracksJson(animation.tracks, resolve, issues, animation.name)
    addBursts(tracks, animation, 1, resolve)
    for (const speed of animation.speeds ?? []) {
        const target = resolve(speed.target)
        tracks[target] = { ...(tracks[target] ?? {}), [SPEED_CHANNEL]: speedKeysJson(speed.keys) }
    }
    Object.assign(tracks, reactionPaletteTracks(animation.palette ?? [], snapshot.nameplate.palette, length))
    Object.assign(tracks, letterTracksJson(animation))
    return tracks
}

function triggerJson(animation: AnimationData): unknown {
    const trigger = animation.trigger
    if (!trigger) return null
    switch (trigger.kind) {
        case 'reaction':
            return { reaction: trigger.reaction, on: trigger.on }
        case 'appear':
            return { appear: trigger.seconds }
        default:
            return 'equip'
    }
}

function animationsJson(
    snapshot: ProjectSnapshot,
    loopFrames: number,
    resolve: (reference: string) => string,
    issues: BundleIssue[],
): Record<string, unknown> {
    const animations = snapshot.animations ?? []
    const groups = scheduleGroups(animations, snapshot.layers)
    const result: Record<string, unknown> = {}
    for (const animation of animations) {
        if (animation.schedule) {
            const step = groups.get(scheduleIdOf(animation))?.step ?? 1
            const schedule: Record<string, unknown> = {
                window: Math.round(animation.schedule.window / step),
                jitter: Math.round(animation.schedule.jitter / step),
                chance: animation.schedule.chance,
            }
            if (animation.schedule.id !== null) schedule.id = animation.schedule.id
            if (animation.schedule.weight !== 1) schedule.weight = animation.schedule.weight
            const tracks = tracksJson(inSteps(animation.tracks, step), resolve, issues, animation.name)
            addBursts(tracks, animation, step, resolve)
            result[animation.name] = {
                schedule,
                length: Math.round(animation.length / step),
                tracks,
            }
            continue
        }
        if (!animation.trigger) continue
        const whileReaction = isWhile(animation.trigger)
        const entry: Record<string, unknown> = { trigger: triggerJson(animation) }
        if (!whileReaction) entry.length = animation.length
        entry.tracks = triggeredTracks(animation, snapshot, whileReaction ? loopFrames : animation.length, resolve, issues)
        if (!whileReaction && animation.restart) entry.restart = true
        if (whileReaction && animation.reduced) entry.reduced = animation.reduced
        result[animation.name] = entry
    }
    return result
}

function usesFlags(layers: LayerData[], manifest: Record<string, unknown>): boolean {
    const variants = manifest.variants as Record<string, Record<string, unknown>> | undefined
    if (variants && Object.values(variants).some((variant) => typeof variant.flag === 'string')) return true
    return layers.some((layer) => layer.kind === 'body' && (layer.fill?.kind === 'flag' || layer.rings.some((ring) => ring.kind === 'flag')))
}

function covers(prefix: string, path: string): boolean {
    if (!path.startsWith(prefix)) return false
    const next = path.charAt(prefix.length)
    return next === '' || next === '.' || next === '['
}

function layerFile(
    layer: LayerData,
    spriteIds: Map<string, string>,
    issues: BundleIssue[],
    materials?: MaterialsState,
): Record<string, unknown> {
    if (isMaterialLayer(layer)) return effectJson(layer, materials, issues)
    if (layer.kind === 'path') return pathJson(layer, spriteIds, issues)
    if (layer.kind === 'emitter') return emitterJson(layer, spriteIds, issues)
    if (layer.kind === 'body') return bodyJson(layer, spriteIds, issues)
    return spriteLayerJson(layer, spriteIds, issues)
}

export function compile(source: ProjectSnapshot): CompiledBundle {
    const issues: BundleIssue[] = []
    const files: Record<string, string> = {}
    const loopFrames = source.loop ? source.loop.length : DEFAULT_LOOP_FRAMES
    const snapshot = dropWrapKeys(source, loopFrames)
    const { nameplate } = snapshot

    if (snapshot.layers.length === 0) {
        issues.push({ path: 'manifest.json#layers', message: 'needs at least one layer' })
    }

    const layerReferences = new Map<string, string>()
    for (const layer of snapshot.layers) {
        layerReferences.set(layer.id, layer.id)
        if (layer.uuid) layerReferences.set(layer.uuid, layer.id)
    }
    const groupReferences = new Map<string, string>()
    for (const group of snapshot.groups) {
        groupReferences.set(group.id, group.id)
        if (group.uuid) groupReferences.set(group.uuid, group.id)
    }
    const resolveLayer = (reference: string) => layerReferences.get(reference) ?? reference
    const resolveGroup = (reference: string) => groupReferences.get(reference) ?? reference
    const resolveTarget = (reference: string) =>
        layerReferences.get(reference) ?? groupReferences.get(reference) ?? reference

    const spriteIds = new Map<string, string>()
    for (const [texture, sprite] of Object.entries(snapshot.sprites)) spriteIds.set(texture, sprite.id)

    const usedSprites = new Map<string, { texture: string; text: string }>()
    for (const layer of snapshot.layers) {
        for (const texture of [...layerTextureUuids(layer), ...(layer.kind === 'body' && layer.art ? [layer.art.texture] : [])]) {
            const sprite = snapshot.sprites[texture]
            if (!sprite) continue
            const text = stringifyJson(spriteJson(sprite))
            const existing = usedSprites.get(sprite.id)
            if (existing && existing.text !== text) {
                issues.push({
                    path: `sprites/${sprite.id}.json`,
                    message: `textures '${existing.texture}' and '${texture}' both use this sprite id`,
                })
                continue
            }
            usedSprites.set(sprite.id, { texture, text })
        }
    }

    for (const pixel of snapshot.pixelIssues) {
        if (pixel.color === TEXTURE_GONE) continue
        if (pixel.x < 0 || pixel.y < 0) {
            issues.push({ path: `textures/${pixel.texture}`, message: pixel.color })
            continue
        }
        issues.push({
            path: `textures/${pixel.texture}#frame ${pixel.frame} (${pixel.x}, ${pixel.y})`,
            message: `off-palette ${pixel.color}`,
        })
    }

    const requires = ['canvas']
    if (snapshot.layers.some((layer) => (!isMaterialLayer(layer) && usesSprites(layer)) || (layer.kind === 'body' && !!layer.art))) requires.push('sprites')

    const maskWarnings: BundleIssue[] = []
    const resolveMask = (layer: LayerData): string | null => {
        const target = maskTarget(layer, (reference) => layerReferences.get(reference))
        if (target === undefined) {
            maskWarnings.push({
                path: `layers/${layer.id}.json`,
                message: layer.kind === 'path' || layer.kind === 'emitter'
                    ? "It can't be clipped: paths and particles always draw whole. Its clipping is ignored."
                    : 'It was clipped by a layer that is gone, so it is not clipped any more. Pick another layer in the Inspector.',
            })
            return null
        }
        return target
    }
    const manifest: Record<string, unknown> = {
        format: 1,
        id: nameplate.id,
        requires,
        fps: nameplate.fps,
        loop: loopFrames,
        ownsBackground: nameplate.ownsBackground,
        ...(nameplate.phase === PER_PLAYER_PHASE ? { phase: PER_PLAYER_PHASE } : {}),
        ...textBadgeManifest(nameplate, resolveLayer),
        layers: snapshot.layers.map((layer) => {
            const mask = resolveMask(layer)
            const entry = { id: layer.id, depth: layer.depth, step: layer.step }
            if (!mask) return entry
            return layer.clip ? { ...entry, mask, clip: layer.clip } : { ...entry, mask }
        }),
    }

    const variantWarnings: BundleIssue[] = []
    const variantEntries = Object.entries(nameplate.variants)
    if (variantEntries.length > 0) {
        const variants: Record<string, Record<string, unknown>> = {}
        const gone = (reference: string) => reference.includes('-') && !layerReferences.has(reference)
        for (const [key, variant] of variantEntries) {
            const entry: Record<string, unknown> = { palette: variant.palette }
            const hide = Array.from(new Set(variant.hide.filter((reference) => !gone(reference)).map(resolveLayer)))
            const swap: Record<string, string> = {}
            for (const [from, to] of Object.entries(variant.swap)) {
                if (gone(from)) continue
                if (!gone(to)) {
                    swap[resolveLayer(from)] = resolveLayer(to)
                    continue
                }
                variantWarnings.push({
                    path: `manifest.json#variants.${key}.swap`,
                    message: `'${resolveLayer(from)}' showed a layer that is gone, so it shows itself again. Pick another layer in this variant.`,
                })
            }
            if (hide.length > 0) entry.hide = hide
            if (Object.keys(swap).length > 0) entry.swap = swap
            if (variant.ownsBackground !== undefined) entry.ownsBackground = variant.ownsBackground
            Object.assign(entry, variantStyleJson(variant, resolveLayer))
            if (variant.params && Object.keys(variant.params).length > 0) entry.params = { ...variant.params }
            variants[key] = entry
        }
        manifest.variants = variants
    }

    if (snapshot.groups.length > 0) {
        manifest.groups = snapshot.groups.map((group) => ({
            id: group.id,
            parent: group.parent === null ? null : resolveGroup(group.parent),
            layers: group.layers.map(resolveLayer),
            ...groupBreakpointsJson(group),
        }))
    }

    const checks = checkAnimations(snapshot, loopFrames)
    issues.push(...checks.issues)
    const animations: Record<string, unknown> = {}
    if (snapshot.loop && snapshot.loop.tracks.length > 0) {
        animations.loop = { tracks: tracksJson(snapshot.loop.tracks, resolveTarget, issues) }
    }
    for (const [name, entry] of Object.entries(animationsJson(snapshot, loopFrames, resolveTarget, issues))) {
        if (name === 'loop' || Object.prototype.hasOwnProperty.call(animations, name)) {
            issues.push({ path: animationPath(name), message: `Two animations are called '${name}'. Rename one of them.` })
            continue
        }
        animations[name] = entry
    }
    if (Object.keys(animations).length > 0) manifest.animations = animations

    applyMotionManifest(snapshot.layers, manifest)
    applyPaletteAnimation(nameplate.palette, loopFrames, manifest, issues)
    applyFlags(snapshot.flags, manifest, files, issues)
    applySlotMolang(manifest, nameplate.palette, snapshot.slotMolang, issues)
    if (usesFlags(snapshot.layers, manifest)) requires.push('flags')
    const badgeFollows = !!nameplate.badge?.follow || Object.values(nameplate.variants).some((variant) => variant.badge?.follow !== undefined)
    if (usesLayout(snapshot.layers) || badgeFollows || (manifest.layers as Array<Record<string, unknown>>).some((entry) => !!entry.mask)) requires.push(LAYOUT_CAPABILITY)
    const binary = applyMaterials(snapshot.layers, snapshot.materials, manifest, files)
    files['manifest.json'] = stringifyJson(manifest)
    files['palettes.json'] = stringifyJson({
        slots: nameplate.palette.slots.map(slotJson),
        colorways: colorwaysJson(nameplate.palette),
    })
    for (const layer of snapshot.layers) {
        files[`layers/${layer.id}.json`] = stringifyJson(layerFile(layer, spriteIds, issues, snapshot.materials))
    }
    for (const [id, entry] of usedSprites) files[`sprites/${id}.json`] = entry.text

    mergeExtra(files)
    const loaded = loadBundle(files, binary)
    const covered = checks.issues.map((issue) => issue.path)
    issues.push(...loaded.issues.filter((issue) => !issue.message.startsWith(NO_SPRITE_ID) && !covered.some((prefix) => covers(prefix, issue.path))))
    if (loaded.skipped) issues.push({ path: '', message: `skipped: ${loaded.skipped}` })

    return { files, issues, warnings: [...checks.warnings, ...maskWarnings, ...variantWarnings], binary }
}

function withMasks(snapshot: ProjectSnapshot): ProjectSnapshot {
    const nodes = typeof OutlinerNode !== 'undefined' ? (OutlinerNode as any).uuids : null
    if (!nodes) return snapshot
    let changed = false
    const layers = snapshot.layers.map((layer) => {
        const node = nodes[layer.uuid]
        const mask = node?.mask
        if (typeof mask !== 'string' || !mask) return layer
        changed = true
        return node.clip === 'fill' ? { ...layer, mask, clip: 'fill' as const } : { ...layer, mask }
    })
    return changed ? { ...snapshot, layers } : snapshot
}

export function currentBundle(): CompiledBundle {
    if (!snapshotSource) return { files: {}, issues: [{ path: '', message: 'no project' }] }
    try {
        const snapshot = withLetters(withLayoutData(withMasks(snapshotSource())))
        const key = stringifyJson(snapshot) +JSON.stringify(currentExtra())
        if (cacheKey === key && cacheValue) return cacheValue
        const bundle = compile(snapshot)
        cacheKey = key
        cacheValue = bundle
        return bundle
    } catch (error) {
        return {
            files: {},
            issues: [{ path: '', message: describe(error) }],
        }
    }
}
