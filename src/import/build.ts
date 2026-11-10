import { syncScheduleMarkers } from '../animate/markers'
import { settingsFrom, writeSettings } from '../animate/props'
import { linkVariantLayers } from '../design/nameplate'
import { createNameplateAnimation, ensureLoopAnimation, ensureNameplateData, snappingFor } from '../format'
import { BADGE_TARGET, BODY_TYPE, FORMAT_ID, NAME_MASK, PLATE_TARGET, SPRITE_TYPE } from '../model'
import { EMITTER_TYPE, SPEED_CHANNEL } from '../motion/types'
import { ensureBadgeNode } from '../badge'
import { ensurePlateNode } from '../plate'
import { readNameplate } from '../palette/state'
import { writeMotion } from '../palanim/reaction'
import { writeLetterTrack } from '../text/reaction'
import { goMode } from '../navigate'
import { EXTRA_PROPERTY } from './extra'
import { applyGroupBreakpoints } from '../library/groups'
import { dataPointWithMolang } from '../molang/keys'
import { writeSlotMolang } from '../molang/slots'
import { writeFlags } from '../flags/state'
import { emptyFlags } from '../flags/types'
import { addMotionKeyframes, addPlanMotionKeyframes, linkMotionTextures, motionTypeFor } from '../motion/build'
import { materialTypeFor } from '../material/element'
import { writeMaterials } from '../material/state'
import { emptyMaterials } from '../material/types'
import { linkArtTexture } from '../art/layout'
import { AnimationPlan, ImportPlan, KeyPlan, NodePlan, TexturePlan, TrackPlan } from './plan'
import { cloneJson } from '../util/json'
import { canvasOf, textureFromCanvas } from '../util/texture'

function createTexture(plan: TexturePlan): Texture {
    const height = plan.frameHeight * plan.frames
    const canvas = canvasOf(plan.width, height, (context) => context.putImageData(new ImageData(new Uint8ClampedArray(plan.rgba), plan.width, height), 0, 0))
    return textureFromCanvas(canvas, { name: plan.id, frames: plan.frames })
}

function keyData(channel: string, value: KeyPlan['value']): Record<string, string> {
    if (channel === 'position' && Array.isArray(value)) return { x: String(value[0]), y: String(value[1]), z: '0' }
    if (typeof value === 'boolean') return { x: value ? '1' : '0', y: '0', z: '0' }
    return { x: String(value), y: '0', z: '0' }
}

function addTrack(animation: any, node: any, track: TrackPlan, fps: number) {
    const animator = animation.getBoneAnimator(node)
    if (!animator || !animator.channels?.[track.channel]) return
    track.keys.forEach((key, index) => {
        const before = index > 0 ? (key.step - track.keys[index - 1].step) / fps : 0
        const after = index + 1 < track.keys.length ? (track.keys[index + 1].step - key.step) / fps : 0
        animator.addKeyframe({
            channel: track.channel,
            time: key.step / fps,
            interpolation: key.interpolation,
            data_points: [dataPointWithMolang(track.channel, key, keyData(track.channel, key.value))],
            bezier_linked: false,
            bezier_left_time: [-before / 3, -before / 3, -before / 3],
            bezier_right_time: [after / 3, after / 3, after / 3],
            bezier_left_value: [0, 0, 0],
            bezier_right_value: [0, 0, 0],
        })
    })
}

function createAnimation(plan: AnimationPlan, nodes: Map<string, any>, fps: number) {
    const whileReaction = plan.trigger?.kind === 'reaction' && plan.trigger.on === 'while'
    const animation = createNameplateAnimation({ name: plan.name, frames: Math.max(1, plan.length), fps, loop: whileReaction ? 'loop' : 'once' })
    writeSettings(animation, settingsFrom(plan.trigger, plan.schedule, plan.restart, plan.reduced))
    for (const entry of plan.palette ?? []) writeMotion(animation, entry.slot, entry.motion)
    if (plan.letters) writeLetterTrack(animation, plan.letters)
    animation.add(false)
    for (const track of plan.tracks) {
        const node = nodes.get(track.target)
        if (node) addTrack(animation, node, track, fps)
    }
    for (const burst of plan.bursts ?? []) {
        const node = nodes.get(burst.target)
        if (node) addMotionKeyframes(animation, node, { kind: 'emitter', bursts: burst.keys }, fps)
    }
    for (const speed of plan.speeds ?? []) {
        const node = nodes.get(speed.target)
        if (node) addTrack(animation, node, { target: speed.target, channel: SPEED_CHANNEL as any, keys: speed.keys }, fps)
    }
    syncScheduleMarkers(animation, fps)
}

function createNodes(plan: ImportPlan, textures: Map<string, Texture>): Map<string, any> {
    const created = new Map<string, any>()
    const bodyType = (OutlinerElement.types as any)[BODY_TYPE]
    const spriteType = (OutlinerElement.types as any)[SPRITE_TYPE]
    if (!bodyType || !spriteType) throw new Error('the nameplate layer types are not registered')
    const sprites: Array<{ node: any, of: string | null }> = []
    const masks: Array<{ node: any, mask: string }> = []
    const place = (nodes: NodePlan[], parent: any) => {
        for (const entry of nodes) {
            if (entry.kind === 'group') {
                const group: any = new Group({ name: entry.id } as any)
                group.isOpen = true
                group.addTo(parent)
                group.init()
                applyGroupBreakpoints(group, entry.breakpoints)
                created.set(entry.id, group)
                place(entry.children, group)
                continue
            }
            const props: Record<string, unknown> = { ...entry.props }
            if (entry.kind === 'sprite') props.texture = entry.sprite ? (textures.get(entry.sprite)?.uuid ?? '') : ''
            const type = materialTypeFor(entry.kind) ?? motionTypeFor(entry.kind) ?? (entry.kind === 'body' ? bodyType : spriteType)
            const node = new type(props)
            linkMotionTextures(node, entry, textures)
            linkArtTexture(node, textures)
            node.addTo(parent)
            node.init()
            created.set(entry.id, node)
            if (entry.kind !== 'body') sprites.push({ node, of: entry.of })
            if (entry.mask) masks.push({ node, mask: entry.mask })
        }
    }
    place(plan.root, 'root')
    for (const { node, of } of sprites) {
        const target = of ? created.get(of) : undefined
        node.of = of === NAME_MASK ? NAME_MASK : target && (target.type === BODY_TYPE || (node.type === EMITTER_TYPE && target.type === SPRITE_TYPE)) ? target.uuid : ''
    }
    for (const { node, mask } of masks) {
        const target = created.get(mask)
        node.mask = target && target !== node ? target.uuid : ''
    }
    return created
}

function linkBadgeBodies(nodes: Map<string, any>) {
    const plate = readNameplate()
    const link = (badge: { of?: string | null } | undefined) => {
        const target = badge?.of ? nodes.get(badge.of) : undefined
        if (badge && target?.type === BODY_TYPE) badge.of = target.uuid
    }
    link(plate.badge)
    for (const variant of Object.values(plate.variants)) link(variant.badge)
    Project.nameplate = plate
}

function isKeyed(plan: ImportPlan, target: string): boolean {
    return plan.tracks.some((track) => track.target === target) || plan.animations.some((entry) => entry.tracks.some((track) => track.target === target))
}

function populateProject(plan: ImportPlan) {
    ensureNameplateData(Project)
    Project.nameplate = cloneJson(plan.nameplate)
    ;(Project as any)[EXTRA_PROPERTY] = cloneJson(plan.extra)
    writeFlags(plan.flags ?? emptyFlags())
    writeMaterials(plan.materials ?? emptyMaterials())
    writeSlotMolang(plan.slotMolang ?? {})
    Project.name = plan.nameplate.id

    const textures = new Map<string, Texture>()
    for (const texture of plan.textures) textures.set(texture.id, createTexture(texture))
    const first = plan.textures.find((texture) => texture.used) ?? plan.textures[0]
    if (first) {
        Project.texture_width = first.width
        Project.texture_height = first.frameHeight
    }

    const nodes = createNodes(plan, textures)
    linkVariantLayers()
    linkBadgeBodies(nodes)
    const badge = isKeyed(plan, BADGE_TARGET) ? ensureBadgeNode() : null
    if (badge) nodes.set(BADGE_TARGET, badge)
    const wholePlate = isKeyed(plan, PLATE_TARGET) ? ensurePlateNode() : null
    if (wholePlate) nodes.set(PLATE_TARGET, wholePlate)

    const fps = Math.max(1, plan.nameplate.fps)
    const animation: any = ensureLoopAnimation(false)
    if (animation) {
        animation.length = Math.max(1, plan.loop) / fps
        animation.snapping = snappingFor(fps)
        animation.nameplate_fps = fps
        for (const track of plan.tracks) {
            const node = nodes.get(track.target)
            if (node) addTrack(animation, node, track, fps)
        }
        addPlanMotionKeyframes(animation, nodes, plan.root, fps)
    }
    for (const entry of plan.animations) createAnimation(entry, nodes, fps)
    animation?.select()

    goMode('design')
    const firstLayer = Array.from(nodes.values()).find((node) => node.type === BODY_TYPE || node.type === SPRITE_TYPE)
    firstLayer?.select?.()
    Undo.history.length = 0
    Undo.index = 0
}

export function applyPlan(plan: ImportPlan): boolean {
    const format = Formats[FORMAT_ID]
    if (!format || !newProject(format)) return false
    const created = Project
    try {
        populateProject(plan)
    } catch (error) {
        console.error('[polyplus_nameplate] building the imported project failed', error)
        if (created) {
            created.saved = true
            created.close(true)
        }
        throw error
    }
    return true
}
