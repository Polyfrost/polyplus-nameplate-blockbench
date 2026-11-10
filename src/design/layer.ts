import { limited, tell } from '../elements/limits'
import { findNode, groupNodes, isGroupNode, layerNodes, primarySelectedNode, selectedLayerNodes } from '../elements/nodes'
import { DEPTHS, readLayers } from '../elements/read'
import { BODY_TYPE, NAME_MASK, SPRITE_TYPE } from '../model'
import { EMITTER_TYPE, PATH_TYPE, SPRITE_FOLLOWS } from '../motion/types'
import { layerTextureUuids } from '../motion/compile'
import { EFFECT_TYPE } from '../material/types'
import { showTexture } from '../navigate'
import { MAX_SPRITE_FRAMES } from '../sprite'
import { frameCountOf } from '../palette/sprites'
import { applyMotionField, motionHandlers, secondsHint } from '../motion/form'
import { applyEffect, effectForm, effectKindInfo } from '../kinds/effectForm'
import { applyGroupChange, groupFormConfig, groupFormValues, selectedGroupNode } from '../library/groups'
import { bodyForm } from '../kinds/bodyForm'
import { spriteForm } from '../kinds/spriteForm'
import { pathForm } from '../kinds/pathForm'
import { emitterForm } from '../kinds/emitterForm'
import { onCurrentNode } from '../kinds/motionForm'
import { fixed, Part } from '../schema/form'
import { ART_PROPERTY, artTexture, AT_PROPERTY, isNameAnchor, NO_AT, readArt, registerLayoutProperties } from '../art/layout'
import { openArtAfterPick } from '../art/form'
import { hasArt } from '../art/dialog'
import { offerPictureSetup } from '../pictures/strip'
import { heading, labeled } from '../util/form'
import { hasProject } from '../util/project'
import { findTexture, setFrameCount } from '../util/texture'
import { undoEdit } from '../util/undo'
import { disposeAllSafe } from '../util/teardown'

export type FormConfig = Record<string, FormElementOptions | '_'>

const MASK_PROPERTY = 'mask'
const CLIP_PROPERTY = 'clip'
const CLIP_FILL = 'fill'
const MASKED_TYPES = [BODY_TYPE, SPRITE_TYPE, PATH_TYPE, EMITTER_TYPE, EFFECT_TYPE]
const MASKABLE_TYPES = [BODY_TYPE, SPRITE_TYPE, EFFECT_TYPE]
const MASK_SOURCE_TYPES = [BODY_TYPE, SPRITE_TYPE]
const PICTURE_TYPES = [SPRITE_TYPE, PATH_TYPE, EMITTER_TYPE]
const AT_SCALE = 100
const SIDE_EDGES = ['left', 'right']
const CLIP_NOTE = 'This body has no fill or picture, so there is nothing to clip to and this layer stays hidden. Give the body a fill, or turn this off.'
const CLIP_OFF_NOTE = 'Leave its outlines alone was turned off: it needs a body to clip by.'
const FOLLOW_OFF_NOTE = "Follow the body's edge was turned off: the ends of the name have no body edge to follow."
const FOLLOW_EDGE_NOTE = "Repeats can only follow the top or bottom edge, so the repeat's Edge is now the top edge."
const NUDGE_RESET_NOTE = 'Nudge is back to 0, 0. Undo brings it back.'

const DEPTH_LABELS: Record<string, string> = {
    behind: 'Behind everything',
    background: 'Background',
    over_background: 'Over the background, behind the name',
    over_text: 'In front of the name',
}
const OUTSIDE_PIVOTS: Record<string, string> = {
    top_left: 'bottom_right',
    top: 'bottom',
    top_right: 'bottom_left',
    left: 'right',
    right: 'left',
    bottom_left: 'top_right',
    bottom: 'top',
    bottom_right: 'top_left',
}
const KIND_LABELS: Record<string, string> = { body: 'Body', sprite: 'Sprite', group: 'Group', path: 'Path', emitter: 'Particles', effect: 'Effect' }
const KIND_ICONS: Record<string, string> = { body: 'rounded_corner', sprite: 'image', group: 'folder', path: 'route', emitter: 'grain', effect: 'auto_awesome' }

export type LayerKind = 'body' | 'sprite' | 'group' | 'path' | 'emitter' | 'effect'

interface LayerHeader {
    kind: LayerKind
    name: string
    count: number
    icon: string
    kindLabel: string
    node: any
}

const MOTION_KINDS: Record<string, { kind: string }> = { [PATH_TYPE]: { kind: 'path' }, [EMITTER_TYPE]: { kind: 'emitter' } }
const handles: { properties: Property[] } = { properties: [] }
const PLACEMENT = fixed((node) => placementConfig(node))
const LAYER_FORMS: Record<string, Part> = {
    [BODY_TYPE]: bodyForm(PLACEMENT),
    [SPRITE_TYPE]: spriteForm(PLACEMENT, () => importPicture()),
    [PATH_TYPE]: pathForm(PLACEMENT, () => importPicture()),
    [EFFECT_TYPE]: effectForm(PLACEMENT),
    [EMITTER_TYPE]: emitterForm(PLACEMENT, onCurrentNode((target) => motionHandlers()?.newParticleTexture(target)), onCurrentNode((target) => motionHandlers()?.emitterPreset(target)), () => importPicture()),
}

function primaryLayer(): any | null {
    return selectedLayerNodes()[0] ?? null
}

function maskOf(node: any): string {
    return typeof node?.mask === 'string' ? node.mask : ''
}

function masksOthers(node: any): boolean {
    return !!node && layerNodes().some((layer) => layer !== node && maskOf(layer) === node.uuid)
}

function maskChoices(node: any): Record<string, string> {
    const options: Record<string, string> = { '': 'Not clipped' }
    if (!masksOthers(node)) {
        options[NAME_MASK] = 'The name (only where the name sits)'
        for (const layer of layerNodes()) {
            if (layer.uuid === node?.uuid || !MASK_SOURCE_TYPES.includes(layer.type) || maskOf(layer)) continue
            options[layer.uuid] = `${layer.type === BODY_TYPE ? 'Body' : 'Sprite'}: ${String(layer.name ?? layer.uuid)}`
        }
    }
    const current = maskOf(node)
    if (!current || current in options) return options
    const target = current === NAME_MASK ? null : findNode(current)
    const label = current === NAME_MASK ? 'The name' : target ? String(target.name ?? current) : ''
    return { [current]: label ? `${label} (can't clip this layer: pick another)` : 'Missing layer', ...options }
}

function bodyOf(uuid: unknown): any | null {
    const node = typeof uuid === 'string' && uuid ? findNode(uuid) : null
    return node?.type === BODY_TYPE ? node : null
}

function showsClip(result: any): boolean {
    const body = bodyOf(result?.mask)
    return !!body && ((Array.isArray(body.rings) && body.rings.length > 0) || primaryLayer()?.clip === CLIP_FILL)
}

function emptyBody(body: any): boolean {
    return !!body && (!body.fill || body.fill.kind === 'none') && !hasArt(body)
}

function placementConfig(node: any): FormConfig {
    const groups: Record<string, string> = { '': 'No group' }
    for (const group of groupNodes()) groups[group.uuid] = group.name
    const clipping: FormConfig = MASKABLE_TYPES.includes(node?.type)
        ? {
            mask: { type: 'select', label: 'Clipped by', options: maskChoices(node), description: 'Only the parts over the other layer\'s pixels show' },
            mask_note: { type: 'info', text: 'Other layers are clipped by this one, so it can\'t be clipped itself.', condition: () => masksOthers(primaryLayer()) },
            clip: { type: 'checkbox', label: 'Leave its outlines alone', style: 'toggle_switch', value: false, condition: showsClip, description: 'This layer never draws over the body\'s outlines' },
            clip_note: { type: 'info', text: CLIP_NOTE, condition: (result: any) => showsClip(result) && !!result?.clip && emptyBody(bodyOf(result?.mask)) },
        }
        : maskOf(node)
            ? { mask_note: { type: 'info', text: 'Paths and particles can\'t be clipped, so this layer draws whole.' } }
            : {}
    return {
        placement_title: heading('Placement'),
        depth: { type: 'select', label: 'Draws', options: labeled(DEPTHS, DEPTH_LABELS) },
        group: { type: 'select', label: 'Group', options: groups, description: 'Layers in a group move and animate together' },
        ...clipping,
        animation_title: heading('Animation'),
        step: { type: 'number', label: 'Hold each frame for (frames)', step: 1, value: 1, description: `2 plays at half speed. This layer's moves, waits and lifetimes stretch to match. ${secondsHint()}` },
    }
}

export function layerFormValues(node: any): Record<string, any> {
    const groupValues = groupFormValues(node)
    if (groupValues) return groupValues
    const values: Record<string, any> = {
        depth: node.depth,
        group: isGroupNode(node.parent) ? node.parent.uuid : '',
        mask: typeof node.mask === 'string' ? node.mask : '',
        clip: node.clip === CLIP_FILL,
        step: node.step ?? 1,
    }
    const form = LAYER_FORMS[node.type]
    if (form) return { ...values, ...form.values!(node) }
    return values
}

function pair(value: unknown): [number, number] {
    const list = Array.isArray(value) ? value : [0, 0]
    return [Math.round(Number(list[0])) || 0, Math.round(Number(list[1])) || 0]
}

function outsidePivot(anchor: unknown): string {
    return OUTSIDE_PIVOTS[String(anchor)] ?? ''
}

function carriedPivot(node: any, anchor: string): string {
    const pivot = String(node.pivot ?? '')
    return pivot && pivot === outsidePivot(node.anchor) ? outsidePivot(anchor) : pivot
}

function seatSprite(node: any, anchor: string) {
    if (!node.follow) node.pivot = node.pivot ? carriedPivot(node, anchor) : outsidePivot(anchor)
    const [x, y] = pair(node.offset)
    if (!x && !y) return
    node.offset = [0, 0]
    tell(NUDGE_RESET_NOTE)
}

function setAnchor(node: any, anchor: string) {
    if (node.type === SPRITE_TYPE && node.follow && isNameAnchor(anchor)) {
        node.follow = ''
        tell(FOLLOW_OFF_NOTE)
    }
    if (node.type === SPRITE_TYPE && !node.repeatOn && anchor !== node.anchor) seatSprite(node, anchor)
    node.anchor = anchor
}

function setFollow(node: any, result: Record<string, any>) {
    node.follow = SPRITE_FOLLOWS.includes(result.follow) ? result.follow : ''
    if (!node.follow || !SIDE_EDGES.includes(node.repeatEdge)) return
    applyMotionField(node, 'repeat_edge', { repeat_edge: 'top' })
    tell(FOLLOW_EDGE_NOTE)
}

function applyTo(node: any, key: string, result: Record<string, any>) {
    const form = LAYER_FORMS[node.type]
    if (form?.owns!(key)) {
        form.apply!(node, key, result)
        return
    }
    switch (key) {
        case 'depth':
            if (DEPTHS.includes(result.depth)) node.depth = result.depth
            break
        case 'step':
            node.step = limited(result.step, 1, Infinity, node.step ?? 1, 'Hold each frame for')
            break
        case 'texture':
            node.texture = String(result.texture ?? '')
            break
        case 'of':
        case 'pivot':
            node[key] = String(result[key] ?? '')
            break
        case 'anchor':
            setAnchor(node, String(result.anchor ?? ''))
            break
        case 'follow':
            if (node.type === SPRITE_TYPE) setFollow(node, result)
            else applyMotionField(node, key, result)
            break
        case 'at': {
            const value = Number(result.at)
            node[AT_PROPERTY] = isFinite(value) ? Math.min(AT_SCALE, Math.max(0, Math.round(value))) / AT_SCALE : NO_AT
            break
        }
        case 'offset':
            node.offset = pair(result.offset)
            break
        case 'mirror':
            node.mirror = !!result.mirror
            break
        case 'mirror_delay':
            node.mirrorDelay = limited(result.mirror_delay, 0, Infinity, node.mirrorDelay ?? 0, 'Copy starts late by')
            break
        case 'mirror_seed':
            node.mirrorSeed = !!result.mirror_seed
            break
        default:
            applyMotionField(node, key, result)
    }
}

function resizeFrames(texture: Texture, from: number, to: number) {
    const canvas = texture.canvas
    const frameHeight = Math.floor(canvas.height / from)
    if (!(frameHeight >= 1)) return
    const width = canvas.width
    const oldHeight = canvas.height
    texture.edit(() => {
        const copy = document.createElement('canvas')
        copy.width = width
        copy.height = canvas.height
        copy.getContext('2d')!.drawImage(canvas, 0, 0)
        canvas.height = frameHeight * to
        const ctx = texture.ctx
        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, width, canvas.height)
        ctx.drawImage(copy, 0, 0, width, frameHeight * Math.min(from, to), 0, 0, width, frameHeight * Math.min(from, to))
        for (let frame = from; frame < to; frame++) {
            ctx.drawImage(copy, 0, (from - 1) * frameHeight, width, frameHeight, 0, frame * frameHeight, width, frameHeight)
        }
        texture.width = width
        texture.height = canvas.height
        texture.uv_height = (Number(texture.uv_height) || oldHeight) * (canvas.height / oldHeight)
        ;(texture as any).keep_size = true
    }, { no_undo: true })
    if (texture.selected) Project.texture_height = texture.uv_height
}

function flatForFrames(texture: Texture): boolean {
    const layer = (TextureLayer as any).selected
    if (layer?.in_limbo && layer.texture === texture) layer.resolveLimbo()
    if (!(texture as any).layers_enabled) return true
    tell('This picture has layers. Merge them in the Picture Layers panel first: Frames only works on a flat picture.')
    return false
}

function setFrames(node: any, value: unknown) {
    const texture = findTexture(node.texture)
    if (!texture) return
    const current = frameCountOf(texture)
    const wanted = Math.floor(Number(value))
    if (!(wanted >= 1)) tell(`A picture needs at least 1 frame, so this one stays at ${current}.`)
    const frames = wanted >= 1 && flatForFrames(texture) ? limited(wanted, 1, MAX_SPRITE_FRAMES, current, 'Frames') : current
    if (frames === current) {
        Blockbench.dispatchEvent('update_selection', {} as any)
        return
    }
    undoEdit({ textures: [texture], bitmap: true }, frames > current ? 'Add sprite frames' : 'Remove sprite frames', () => {
        setFrameCount(texture, frames)
        if (texture.canvas && texture.canvas.height % current === 0) resizeFrames(texture, current, frames)
    })
    if (typeof UVEditor !== 'undefined' && (UVEditor as any).vue?.updateTexture) (UVEditor as any).vue.updateTexture()
}

function moveToGroup(node: any, uuid: string) {
    const target = uuid ? findNode(uuid) : null
    if (uuid && !target) return
    if ((target ?? 'root') === node.parent) return
    undoEdit({ outliner: true }, 'Move layer to group', () => {
        node.addTo(target ?? 'root', 0)
        if (target) target.isOpen = true
    })
}

function setMask(targets: any[], uuid: string) {
    const changing = targets.filter((node) => (typeof node.mask === 'string' ? node.mask : '') !== (uuid === node.uuid ? '' : uuid))
    if (changing.length === 0) return
    const dropClip = !bodyOf(uuid) && changing.some((node) => node.clip === CLIP_FILL)
    undoEdit({ elements: changing }, 'Clip layer', () => {
        for (const node of changing) {
            node.mask = uuid === node.uuid ? '' : uuid
            if (dropClip) node.clip = ''
        }
    })
    if (dropClip) tell(CLIP_OFF_NOTE)
}

function setClip(targets: any[], on: boolean) {
    const value = on ? CLIP_FILL : ''
    const changing = targets.filter((node) => (!on || !!bodyOf(node.mask)) && (node.clip ?? '') !== value)
    if (changing.length === 0) return
    undoEdit({ elements: changing }, 'Clip layer', () => {
        for (const node of changing) node.clip = value
    })
}

function usePicture(node: any, texture: Texture) {
    if (node.type !== EMITTER_TYPE) {
        node.texture = texture.uuid
        return
    }
    const sprites: string[] = Array.isArray(node.sprites) ? node.sprites.filter((uuid: string) => !!uuid) : []
    node.sprites = [...sprites, texture.uuid]
}

function pictureInUse(uuid: string): boolean {
    return readLayers().some((layer) => layerTextureUuids(layer as any).includes(uuid)) || layerNodes().some((node) => artTexture(readArt(node[ART_PROPERTY]))?.uuid === uuid)
}

function importPicture() {
    const node = primaryLayer()
    if (!node || !PICTURE_TYPES.includes(node.type)) return
    const uuid = node.uuid
    const title = node.type === EMITTER_TYPE ? 'Add a particle picture' : 'Import picture'
    Blockbench.import({ resource_id: 'texture', readtype: 'image', type: 'PNG picture', extensions: ['png'], multiple: false, title } as any, (files: Filesystem.FileResult[]) => {
        const file = files?.[0]
        const target = file ? findNode(uuid) : null
        if (!file || !target) return
        const old = target.type === EMITTER_TYPE ? undefined : findTexture(target.texture)
        const shown = !!old?.selected
        const { texture, dropped } = undoEdit(
            { textures: old ? [old] : [], elements: [target], bitmap: true },
            'Import picture',
            () => {
                const texture = new Texture({ name: file.name } as TextureData).fromFile(file as any).add(false, true)
                const textures = [texture]
                usePicture(target, texture)
                const dropped = old && !pictureInUse(old.uuid) ? old : null
                dropped?.remove(true)
                if (old && !dropped) textures.push(old)
                return { texture, textures, dropped }
            },
            ({ textures }) => ({ textures, elements: [target], bitmap: true }),
        )
        if (dropped && shown) showTexture(texture)
        Blockbench.dispatchEvent('update_selection', {} as any)
        if (dropped) Blockbench.showQuickMessage(`'${dropped.name}' left the project: nothing else used it. Undo brings it back.`, 2500)
        offerPictureSetup(texture)
    })
}

export function applyLayerChange(changed: string[], result: Record<string, any>) {
    if (applyGroupChange(changed, result)) return
    const selected = selectedLayerNodes()
    const first = selected[0]
    if (!first) return
    if (changed.includes('frames')) setFrames(first, result.frames)
    if (changed.includes('group')) moveToGroup(first, String(result.group ?? ''))
    if (changed.includes('mask')) setMask(selected, String(result.mask ?? ''))
    if (changed.includes('clip')) setClip(selected, !!result.clip)
    const keys = changed.filter((key) => key !== 'frames' && key !== 'group' && key !== 'mask' && key !== 'clip' && !key.endsWith('_title') && !key.endsWith('_note') && key !== 'paint' && key !== 'import_picture' && key !== 'art_new' && key !== 'art_edit')
    if (keys.length === 0) return
    if (applyEffect(first, keys, result)) return
    const targets = selected.filter((node) => node.type === first.type)
    const hadArt = hasArt(first)
    undoEdit({ elements: targets }, 'Edit layer', () => {
        for (const node of targets) for (const key of keys) applyTo(node, key, result)
    })
    if (keys.includes('texture')) Blockbench.dispatchEvent('update_selection', {} as any)
    if (keys.includes('art_texture')) openArtAfterPick(first, hadArt)
}

export function layerFormConfig(node: any): FormConfig {
    return groupFormConfig(node) ?? LAYER_FORMS[node.type]?.config(node) ?? {}
}

export function layerHeader(): LayerHeader | null {
    if (!hasProject()) return null
    const group = selectedGroupNode()
    if (group) return { kind: 'group', name: String(group.name ?? ''), count: 1, icon: KIND_ICONS.group, kindLabel: KIND_LABELS.group, node: group }
    const layer = primaryLayer()
    if (layer) {
        const info = effectKindInfo(layer) ?? MOTION_KINDS[layer.type] ?? null
        const kind = ((info?.kind as LayerKind | undefined) ?? (layer.type === SPRITE_TYPE ? 'sprite' : 'body'))
        const count = selectedLayerNodes().filter((node) => node.type === layer.type).length
        return { kind, name: String(layer.name ?? ''), count, icon: KIND_ICONS[kind] ?? '', kindLabel: KIND_LABELS[kind] ?? '', node: layer }
    }
    const primary = primarySelectedNode()
    if (primary && isGroupNode(primary)) return { kind: 'group', name: String(primary.name ?? ''), count: 1, icon: KIND_ICONS.group, kindLabel: KIND_LABELS.group, node: primary }
    return null
}

function registerMaskProperties() {
    for (const type of MASKED_TYPES) {
        const target = (OutlinerElement.types as any)[type]
        for (const name of [MASK_PROPERTY, CLIP_PROPERTY]) {
            if (!target || target.properties?.[name]) continue
            handles.properties.push(new Property(target, 'string', name, { default: '' }))
        }
    }
}

function unregisterMaskProperties() {
    disposeAllSafe(handles.properties, 'could not remove the mask property')
}

export function registerLayerProperties(): () => void {
    registerMaskProperties()
    const removeLayoutProperties = registerLayoutProperties()
    return () => {
        unregisterMaskProperties()
        removeLayoutProperties()
    }
}
