import { copyKeys, keyedAnimations } from '../elements/duplicate'
import { limited, tell } from '../elements/limits'
import { firstBodyUuid, freeLayerName, layerNodes, placeNode, primarySelectedNode, selectedLayerNodes } from '../elements/nodes'
import { ensureLoopAnimation, isNameplateActive } from '../format'
import { BODY_TYPE, SPRITE_TYPE } from '../model'
import { DESIGN_MODE, paintTexture, showTexture } from '../navigate'
import { notifyNameplateChanged, readNameplate } from '../palette/state'
import { startPlaying } from '../preview/panel'
import { createBlankTexture, createdNotes, framesDescription, framesLabel, freeTextureName, normalizeSpec, placeholderColors, SpriteSpec } from '../sprite'
import { setMotionFormHandlers } from './form'
import { CREATE_AND_PAINT_BUTTONS } from '../util/dialogs'
import { cloneJson, sameSerialized } from '../util/json'
import { defineDesignAction } from '../util/actions'
import { findTexture } from '../util/texture'
import { undoEdit } from '../util/undo'
import { MotionTypes } from './element'
import { BURST_CHANNEL, EMITTER_TYPE, isMotionNode, LIMITS, PATH_TYPE } from './types'

export const ACTION_ADD_PATH = 'polyplus_nameplate_add_path'
export const ACTION_ADD_EMITTER = 'polyplus_nameplate_add_emitter'
const PATH_DIALOG = 'polyplus_nameplate_path_dialog'
const EMITTER_DIALOG = 'polyplus_nameplate_emitter_dialog'
const NEW_TEXTURE = '__new'

type Preset = Record<string, unknown> & { burst?: number }
type Picture = 'walker' | 'particle'

const PATH_PRESETS: Record<string, { label: string, props: Record<string, unknown> }> = {
    top: { label: 'Walk along the top edge', props: { preset: 'top', pivot: 'bottom', follow: 'outside' } },
    bottom: { label: 'Walk along the bottom edge', props: { preset: 'bottom', pivot: 'top', follow: 'outside' } },
    perimeter: { label: 'Walk all the way around', props: { preset: 'perimeter', pivot: 'bottom', follow: 'outside', lapsOn: true, laps: 1 } },
    custom: {
        label: 'My own points',
        props: { preset: '', pivot: 'bottom', points: [{ anchor: 'top_left', offset: [0, 0], pause: 0 }, { anchor: 'top_right', offset: [0, 0], pause: 0 }] },
    },
}

const EMITTER_PRESETS: Record<string, { label: string, props: Preset }> = {
    rise: {
        label: 'Float up from the top edge',
        props: {
            shape: 'line', spawnEdge: 'top', rateOn: true, rateEvery: 4, rateCount: 1, rateJitter: 2,
            lifetime: [8, 14], velocityX: [-0.1, 0.1], velocityY: [-0.5, -0.25], gravity: [0, 0], drift: [0, 0],
            wobbleOn: true, wobble: [1, 0], wobblePeriod: 8, particleFrames: 'loop',
            fadeOn: true, fadeAfter: 0.5, fadeTo: 0, fadeSteps: 4,
        },
    },
    fall: {
        label: 'Drop from the bottom edge',
        props: {
            shape: 'line', spawnEdge: 'bottom', rateOn: true, rateEvery: 5, rateCount: 1, rateJitter: 3,
            lifetime: [8, 12], velocityX: [0, 0], velocityY: [0.1, 0.25], gravity: [0, 0.02], drift: [0, 0],
            wobbleOn: false, particleFrames: 'loop',
        },
    },
    above: {
        label: 'Fall from above',
        props: {
            shape: 'line', spawnEdge: 'top', spawnOffset: [0, -10], rateOn: true, rateEvery: 5, rateCount: 1, rateJitter: 3,
            lifetime: [30, 40], velocityX: [-0.1, 0.1], velocityY: [0.4, 0.7], gravity: [0, 0], drift: [0, 0],
            wobbleOn: true, wobble: [1, 0], wobblePeriod: 10, particleFrames: 'loop',
        },
    },
    twinkle: {
        label: 'Twinkle around the border',
        props: {
            shape: 'border', follow: 'line', rateOn: true, rateEvery: 3, rateCount: 1, rateJitter: 2,
            lifetime: [4, 8], velocityX: [0, 0], velocityY: [0, 0], gravity: [0, 0], drift: [0, 0],
            wobbleOn: false, particleFrames: 'stretch',
        },
    },
    burst: {
        label: 'Burst out once per loop',
        props: {
            shape: 'point', spawnAnchor: 'top', rateOn: false,
            lifetime: [6, 10], velocityX: [-1, 1], velocityY: [-1, -0.25], gravity: [0, 0.08], drift: [0, 0],
            wobbleOn: false, particleFrames: 'stretch', burst: 8,
        },
    },
}

let activeTypes: MotionTypes | null = null

function presetLabels(presets: Record<string, { label: string }>): Record<string, string> {
    return Object.fromEntries(Object.entries(presets).map(([key, entry]) => [key, entry.label]))
}

function textureChoices(): Record<string, string> {
    const options: Record<string, string> = { [NEW_TEXTURE]: 'Make a new picture' }
    for (const texture of Texture.all) options[texture.uuid] = texture.name
    return options
}

function spriteFields(width: number, height: number, frames: number, picture: Picture, current = NEW_TEXTURE): Record<string, FormElementOptions> {
    const isNew = (result: any) => result?.texture === NEW_TEXTURE
    return {
        texture: { type: 'select', label: 'Picture', options: textureChoices(), value: current },
        name: { type: 'text', label: 'Picture name', value: freeTextureName(picture === 'walker' ? 'sprite' : picture), condition: isNew as any },
        size: { type: 'vector', label: 'Width, height (px)', dimensions: 2, step: 1, force_step: true, value: [width, height], condition: isNew as any },
        frames: { type: 'number', label: framesLabel(), step: 1, value: frames, condition: isNew as any, description: framesDescription() },
    }
}

function drawPicture(picture: Picture): (ctx: CanvasRenderingContext2D, spec: SpriteSpec) => void {
    return (ctx, spec) => {
        const colors = placeholderColors()
        const { width, height, frames } = spec
        for (let frame = 0; frame < frames; frame++) {
            const y = frame * height
            if (picture === 'particle') {
                ctx.fillStyle = colors.light
                if (width < 3 || height < 3) {
                    ctx.fillRect(0, y, width, height)
                    continue
                }
                const cx = Math.floor(width / 2)
                const cy = Math.floor(height / 2)
                ctx.fillRect(cx - 1, y + cy, 3, 1)
                ctx.fillRect(cx, y + cy - 1, 1, 3)
                continue
            }
            const side = width >= 4 ? 1 : 0
            const lift = frame % 2 === 1 && height >= 3 ? 1 : 0
            const top = Math.floor(height / 3) - lift
            ctx.fillStyle = colors.main
            ctx.fillRect(side, y + top, width - side * 2, height - top - lift)
            ctx.fillStyle = colors.light
            ctx.fillRect(side, y + top, width - side * 2, 1)
        }
    }
}

function textureFrom(result: any, fallbackName: string, created: Texture[], picture: Picture): Texture | undefined {
    if (result.texture && result.texture !== NEW_TEXTURE) return findTexture(result.texture)
    const size = Array.isArray(result.size) ? result.size : [8, 8]
    const raw = { name: result.name || fallbackName, width: size[0], height: size[1], frames: result.frames }
    const spec = normalizeSpec(raw)
    createdNotes(raw, spec).forEach(tell)
    const texture = createBlankTexture(spec, { select: false, draw: drawPicture(picture) })
    created.push(texture)
    return texture
}

function loopAnimationsFor(presetKey: string): any[] {
    if (!EMITTER_PRESETS[presetKey]?.props.burst) return []
    const animation = ensureLoopAnimation(false)
    return animation ? [animation] : []
}

function addBurstKeyframe(node: any, count: number) {
    const animation: any = ensureLoopAnimation(false)
    if (!animation) return
    const animator = animation.getBoneAnimator(node)
    if (!animator || (Array.isArray(animator[BURST_CHANNEL]) && animator[BURST_CHANNEL].length > 0)) return
    animator.addKeyframe({ channel: BURST_CHANNEL, time: 0, interpolation: 'step', data_points: [{ x: String(count), y: '0', z: '0' }] })
}

export function addPath(presetKey: string, texture: Texture, walkers: number, spacing: number, carried: Record<string, unknown> = {}): any {
    const types = activeTypes
    if (!types) return null
    const preset = PATH_PRESETS[presetKey] ?? PATH_PRESETS.top
    const element = new types.path({
        name: freeLayerName('path'),
        depth: 'over_background',
        texture: texture.uuid,
        of: firstBodyUuid(),
        walkers: limited(walkers, 1, LIMITS.walkers, 1, 'Copies'),
        spacing: limited(spacing, 0, LIMITS.spacing, 0, 'Gap between copies'),
        ...cloneJson(preset.props),
        ...carried,
    })
    placeNode(element)
    element.init()
    element.select()
    return element
}

function selectedSprite(): any | null {
    const selected = selectedLayerNodes()
    const single = selected.length === 1 && !Group.first_selected
    return single && selected[0].type === SPRITE_TYPE ? selected[0] : null
}

function usedForClipping(sprite: any): boolean {
    return !!sprite.mask || layerNodes().some((node) => node.mask === sprite.uuid)
}

function spritePicture(sprite: any): string | undefined {
    return Texture.all.some((texture) => texture.uuid === sprite?.texture) ? sprite.texture : undefined
}

function carriedFrom(sprite: any): Record<string, unknown> {
    const onBody = layerNodes().some((node) => node.type === BODY_TYPE && node.uuid === sprite.of)
    return {
        name: sprite.name,
        depth: sprite.depth,
        step: sprite.step,
        visibility: sprite.visibility,
        breakpoints: cloneJson(sprite.breakpoints ?? []),
        ...(onBody ? { of: sprite.of } : {}),
    }
}

function moveVariantChoices(from: string, to: string) {
    const link = (uuid: string) => (uuid === from ? to : uuid)
    const plate = readNameplate()
    for (const variant of Object.values(plate.variants)) {
        variant.hide = variant.hide.map(link)
        variant.swap = Object.fromEntries(Object.entries(variant.swap).map(([layer, shown]) => [link(layer), link(shown)]))
    }
    Project.nameplate = plate
}

function replaceSprite(sprite: any, path: any, animations: any[]) {
    copyKeys([[sprite, path]], animations)
    moveVariantChoices(sprite.uuid, path.uuid)
    sprite.remove(false)
}

export function startAddPath() {
    const sprite = selectedSprite()
    const replaceable = !!sprite && !usedForClipping(sprite)
    const dialog: Dialog = new Dialog({
        id: PATH_DIALOG,
        title: 'Add Path',
        width: 460,
        form: {
            route: { type: 'select', label: 'Path', options: presetLabels(PATH_PRESETS), value: 'top' },
            walkers: { type: 'number', label: 'Copies', step: 1, value: 1 },
            spacing: { type: 'number', label: 'Gap between copies (px)', step: 1, value: 12, condition: ((result: any) => Number(result?.walkers ?? 1) > 1) as any },
            ...spriteFields(8, 8, 2, 'walker', spritePicture(sprite)),
            ...(replaceable ? { replace: { type: 'checkbox', label: `Replace '${sprite.name}'`, value: true } as FormElementOptions } : {}),
        },
        ...CREATE_AND_PAINT_BUTTONS,
        onButton(index: number) {
            if (index > 1) return
            const result: any = dialog.getFormResult()
            const replaced = result.replace ? sprite : null
            const elements: any[] = replaced ? [replaced] : []
            const textures: Texture[] = []
            const animations: any[] = replaced ? keyedAnimations([replaced]) : []
            const aspects: any = { elements, outliner: true, textures, bitmap: true, selection: true, animations, nameplate: !!replaced }
            if (replaced) Project.nameplate = readNameplate()
            const { texture, element } = undoEdit(aspects, replaced ? 'Replace sprite with path' : 'Add path', () => {
                const texture = textureFrom(result, 'sprite', textures, 'walker')
                const element = texture ? addPath(String(result.route), texture, Number(result.walkers), Number(result.spacing), replaced ? carriedFrom(replaced) : {}) : null
                if (element && replaced) {
                    replaceSprite(replaced, element, animations)
                    elements.length = 0
                }
                if (element) elements.push(element)
                return { texture, element }
            })
            if (replaced) notifyNameplateChanged()
            if (texture && index === 1) paintTexture(texture)
            else if (texture) showTexture(texture)
            if (element) startPlaying()
        },
    } as any)
    dialog.show()
}

function applyEmitterPreset(node: any, key: string) {
    const preset = EMITTER_PRESETS[key]
    if (!preset) return
    const { burst, ...props } = cloneJson(preset.props) as Preset
    node.extend({ follow: '', spawnOffset: [0, 0], fadeOn: false, ...props })
    if (burst) addBurstKeyframe(node, burst)
}

export function addEmitter(presetKey: string, texture: Texture): any {
    const types = activeTypes
    if (!types) return null
    const element = new types.emitter({
        name: freeLayerName('particles'),
        depth: 'over_background',
        sprites: [texture.uuid],
        of: firstBodyUuid(),
    })
    placeNode(element)
    element.init()
    applyEmitterPreset(element, presetKey)
    element.select()
    return element
}


function matchesPreset(node: any, props: Preset): boolean {
    return Object.entries(props).every(([key, value]) => key === 'burst' || sameSerialized(node[key], value))
}

function nextPreset(node: any): string {
    const keys = Object.keys(EMITTER_PRESETS)
    const current = keys.findIndex((key) => matchesPreset(node, EMITTER_PRESETS[key].props))
    return keys[(current + 1) % keys.length]
}

export function startAddEmitter() {
    const dialog: Dialog = new Dialog({
        id: EMITTER_DIALOG,
        title: 'Add Particles',
        width: 460,
        form: {
            preset: { type: 'select', label: 'Style', options: presetLabels(EMITTER_PRESETS), value: 'rise' },
            ...spriteFields(3, 3, 1, 'particle'),
        },
        ...CREATE_AND_PAINT_BUTTONS,
        onButton(index: number) {
            if (index > 1) return
            const result: any = dialog.getFormResult()
            const elements: any[] = []
            const textures: Texture[] = []
            const animations = loopAnimationsFor(String(result.preset))
            const { texture, element } = undoEdit({ elements, outliner: true, textures, bitmap: true, selection: true, animations }, 'Add particles', () => {
                const texture = textureFrom(result, 'particle', textures, 'particle')
                const element = texture ? addEmitter(String(result.preset), texture) : null
                if (element) elements.push(element)
                return { texture, element }
            })
            if (texture && index === 1) paintTexture(texture)
            else if (texture) showTexture(texture)
            if (element) startPlaying()
        },
    } as any)
    dialog.show()
}

function promptEmitterPreset(node: any) {
    const dialog: Dialog = new Dialog({
        id: `${EMITTER_DIALOG}_preset`,
        title: 'Particles Preset',
        width: 420,
        form: {
            intro: { type: 'info', text: 'Replaces the spawn, timing and movement settings. The pictures stay.' },
            preset: { type: 'select', label: 'Style', options: presetLabels(EMITTER_PRESETS), value: nextPreset(node) },
        },
        onConfirm(result: any) {
            const elements = [node]
            const animations = loopAnimationsFor(String(result.preset))
            undoEdit({ elements, animations }, 'Apply particles preset', () => {
                applyEmitterPreset(node, String(result.preset))
            })
        },
    } as any)
    dialog.show()
}

function promptParticleTexture(node: any) {
    const dialog: Dialog = new Dialog({
        id: `${EMITTER_DIALOG}_texture`,
        title: 'New Particle Picture',
        width: 420,
        form: {
            name: { type: 'text', label: 'Picture name', value: freeTextureName('particle') },
            size: { type: 'vector', label: 'Width, height (px)', dimensions: 2, step: 1, force_step: true, value: [3, 3] },
            frames: { type: 'number', label: framesLabel(), step: 1, value: 1, description: framesDescription() },
        },
        ...CREATE_AND_PAINT_BUTTONS,
        onButton(index: number) {
            if (index > 1) return
            const result: any = dialog.getFormResult()
            const elements = [node]
            const textures: Texture[] = []
            const texture = undoEdit({ elements, textures, bitmap: true }, 'Add particle picture', () => {
                const texture = textureFrom({ ...result, texture: NEW_TEXTURE }, 'particle', textures, 'particle')
                if (texture) {
                    const sprites: string[] = Array.isArray(node.sprites) ? node.sprites.filter((uuid: string) => !!uuid) : []
                    node.sprites = [...sprites, texture.uuid]
                }
                return texture
            })
            if (texture && index === 1) paintTexture(texture)
        },
    } as any)
    dialog.show()
}

function openLayerPicture() {
    if (!isNameplateActive() || typeof Modes === 'undefined' || Modes.id !== DESIGN_MODE) return
    const node = primarySelectedNode() ?? (Outliner.selected as any[]).find(isMotionNode)
    if (node?.type === PATH_TYPE) showTexture(findTexture(node.texture))
    if (node?.type !== EMITTER_TYPE || !Array.isArray(node.sprites)) return
    if (node.sprites.includes(Texture.selected?.uuid)) return
    const first = node.sprites.find((uuid: string) => Texture.all.some((texture) => texture.uuid === uuid))
    showTexture(findTexture(first))
}

export function registerMotionActions(types: MotionTypes): () => void {
    activeTypes = types
    setMotionFormHandlers({ newParticleTexture: promptParticleTexture, emitterPreset: promptEmitterPreset })

    const actions = [
        defineDesignAction(
            ACTION_ADD_PATH,
            {
                name: 'Add Path',
                description: "A small picture that walks along the nameplate's edges",
                icon: 'route',
                click: startAddPath,
            },
            'edit',
        ),
        defineDesignAction(
            ACTION_ADD_EMITTER,
            {
                name: 'Add Particles',
                description: 'Small pictures that float, fall or twinkle around the nameplate',
                icon: 'grain',
                click: startAddEmitter,
            },
            'edit',
        ),
    ]

    const listener = Blockbench.on('update_selection', openLayerPicture)

    return () => {
        listener.delete()
        setMotionFormHandlers(null)
        activeTypes = null
        for (const action of actions) action.delete()
    }
}
