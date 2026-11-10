import { ART_PROPERTY, artTexture, readArt } from '../art/layout'
import { readLayers } from '../elements/read'
import { layerNodes } from '../elements/nodes'
import { currentLoopFrames, isNameplateActive } from '../format'
import { frameCountOf } from '../palette/sprites'
import { isFrameKeyed, MAX_SPRITE_FRAMES, MAX_SPRITE_SIZE, PictureShape } from '../sprite'
import { pictureName } from '../elements/pictures'
import { checkPictureColors } from './fit'
import { dialogButtons } from '../util/dialogs'
import { registerPicturesPanel } from './panel'
import { addToMenu, defineAction } from '../util/actions'
import { disposeAll } from '../util/teardown'
import { setFrameCount } from '../util/texture'
import { undoEdit } from '../util/undo'
import { canSplit, firstDirection, fitsOneFrame, frameCounts, frameSizeOf, PictureLayout, PictureSize, StripDirection, suggestedFrames, suggestedLayout, worthAsking } from './layout'

const ACTION_ID = 'polyplus_nameplate_split_frames'
const DIALOG_ID = 'polyplus_nameplate_split_frames_dialog'
const BLOCKBENCH_ADD_MESSAGE = 'Add texture'
const PREVIEW_WIDTH = 420
const PREVIEW_HEIGHT = 180
const PREVIEW_GAP = 3
const MESSAGE_MS = 5000
const RESIZE_HINT = 'Use Picture options (three dots) > Resize Texture, and set the mode to Scale.'
const LAYER_PICTURE: StripQuestion = { layout: (size) => suggestedLayout(size, true), note: '' }
const LOOSE_PICTURE: StripQuestion = { layout: (size) => suggestedLayout(size, false), note: ' A picture for a body stays one picture.' }
const SPLIT_REQUEST: StripQuestion = { layout: (size) => firstDirection(size), note: '' }

interface StripChoice {
    layout: PictureLayout
    frames: number
}

interface StripQuestion {
    layout: (size: PictureSize) => PictureLayout
    frames?: (size: PictureSize, direction: StripDirection) => number
    note: string
}

let action: Action | null = null
let removeFromMenu: (() => void) | null = null
let hooks: Deletable[] = []
let removePanel: (() => void) | null = null
let waiting: Promise<void> = Promise.resolve()
const pendingLoads = new WeakMap<Texture, Array<() => void>>()

function sizeOf(texture: Texture): PictureSize | null {
    const { width, height } = texture
    return width > 0 && height > 0 && !texture.error ? { width, height } : null
}

function sizeText(size: PictureSize): string {
    return `${size.width} x ${size.height} px`
}

function afterLoad(texture: Texture, run: () => void) {
    const queued = pendingLoads.get(texture)
    if (queued) {
        queued.push(run)
        return
    }
    const runs = [run]
    const previous = texture.load_callback
    pendingLoads.set(texture, runs)
    texture.load_callback = (loaded: Texture) => {
        texture.load_callback = previous
        pendingLoads.delete(texture)
        if (typeof previous === 'function') previous(loaded)
        for (const queuedRun of runs) window.setTimeout(queuedRun, 0)
    }
}

function inTurn(task: () => Promise<string>): Promise<string> {
    const turn = waiting.then(task).catch((error) => {
        console.error('[polyplus_nameplate] could not set up the picture', error)
        return ''
    })
    waiting = turn.then(() => {})
    return turn
}

function isBodyArt(texture: Texture): boolean {
    return layerNodes().some((node) => artTexture(readArt(node[ART_PROPERTY]))?.uuid === texture.uuid)
}

function refreshPicture(texture: Texture) {
    if (texture.selected) Project.texture_height = texture.uv_height
    if (typeof UVEditor !== 'undefined' && (UVEditor as any).vue?.updateTexture) (UVEditor as any).vue.updateTexture()
    Blockbench.dispatchEvent('update_selection', {} as any)
}

function showWholePicture(texture: Texture) {
    texture.uv_width = texture.width
    texture.uv_height = texture.height
    ;(texture as any).keep_size = true
}

function restack(texture: Texture, size: PictureSize, frames: number) {
    const canvas = texture.canvas
    const frame = frameSizeOf(size, 'across', frames)
    texture.edit(() => {
        const copy = document.createElement('canvas')
        copy.width = size.width
        copy.height = size.height
        copy.getContext('2d')!.drawImage(canvas, 0, 0)
        canvas.width = frame.width
        canvas.height = frame.height * frames
        const ctx = texture.ctx
        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        for (let index = 0; index < frames; index++) {
            ctx.drawImage(copy, index * frame.width, 0, frame.width, frame.height, 0, index * frame.height, frame.width, frame.height)
        }
        texture.width = canvas.width
        texture.height = canvas.height
    }, { no_undo: true })
}

function applyChoice(texture: Texture, size: PictureSize, choice: StripChoice, label: string) {
    undoEdit({ textures: [texture], bitmap: true }, label, () => {
        setFrameCount(texture, choice.frames)
        if (choice.layout === 'across') restack(texture, size, choice.frames)
        showWholePicture(texture)
    })
    refreshPicture(texture)
}

function keepOnePicture(texture: Texture, size: PictureSize): string {
    const frames = frameCountOf(texture)
    if (frames > 1) {
        applyChoice(texture, size, { layout: 'one', frames: 1 }, 'Set picture to one frame')
        return `'${pictureName(texture)}' now has 1 frame instead of ${frames}, because the new picture is ${sizeText(size)}.`
    }
    if (texture.uv_width === size.width && texture.uv_height === size.height) return ''
    showWholePicture(texture)
    refreshPicture(texture)
    return ''
}

function clashesWithLoop(texture: Texture, frames: number): boolean {
    if (currentLoopFrames() % frames === 0) return false
    return readLayers().some((layer: any) => {
        if (layer.kind !== 'sprite' && layer.kind !== 'path') return false
        if (layer.texture !== texture.uuid || isFrameKeyed(layer.uuid)) return false
        return layer.kind === 'sprite' || Object.keys(layer.facings ?? {}).length === 0
    })
}

function splitMessage(texture: Texture, size: PictureSize, direction: StripDirection, frames: number): string {
    const frame = frameSizeOf(size, direction, frames)
    const parts = [`'${pictureName(texture)}' is now ${frames} frames, ${frame.width} x ${frame.height} px each.`]
    if (clashesWithLoop(texture, frames)) parts.push(`The ${currentLoopFrames()} frame loop doesn't divide by ${frames}, so Checks will ask you to change one of them.`)
    return parts.join(' ')
}

function oversizeMessage(texture: Texture, size: PictureSize): string {
    return `'${pictureName(texture)}' stays one picture. At ${sizeText(size)} it is over the ${MAX_SPRITE_SIZE} px limit for one frame, so it can't export yet. ${RESIZE_HINT}`
}

function frameOptions(size: PictureSize, direction: StripDirection): Record<string, string> {
    const options: Record<string, string> = {}
    for (const frames of frameCounts(size, direction)) {
        const frame = frameSizeOf(size, direction, frames)
        options[String(frames)] = `${frames} frames, ${frame.width} x ${frame.height} px each`
    }
    return options
}

function layoutOptions(size: PictureSize): Record<string, string> {
    const options: Record<string, string> = { one: 'One picture' }
    if (frameCounts(size, 'down').length > 0) options.down = 'A strip, with frames top to bottom'
    if (frameCounts(size, 'across').length > 0) options.across = 'A strip, with frames left to right'
    return options
}

function caption(size: PictureSize, choice: StripChoice): string {
    if (choice.layout === 'one') {
        if (fitsOneFrame(size)) return `One picture, ${sizeText(size)}.`
        return `A frame can be at most ${MAX_SPRITE_SIZE} px each way, so this can't export as one picture. Split it, or make it smaller first.`
    }
    const frame = frameSizeOf(size, choice.layout, choice.frames)
    const counted = `${choice.frames} frames, ${frame.width} x ${frame.height} px each.`
    if (choice.layout === 'down') return `${counted} They play from top to bottom.`
    return `${counted} They play from left to right.`
}

function previewScale(size: PictureSize): number {
    const fit = Math.min(PREVIEW_WIDTH / size.width, PREVIEW_HEIGHT / size.height)
    return fit >= 1 ? Math.floor(fit) : fit
}

function previewCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.style.imageRendering = 'pixelated'
    canvas.style.display = 'block'
    canvas.style.margin = '8px auto'
    canvas.style.maxWidth = '100%'
    canvas.style.maxHeight = `${PREVIEW_HEIGHT + PREVIEW_GAP * 8}px`
    return canvas
}

function drawPreview(canvas: HTMLCanvasElement, source: HTMLCanvasElement, size: PictureSize, choice: StripChoice) {
    const scale = previewScale(size)
    const direction: StripDirection = choice.layout === 'across' ? 'across' : 'down'
    const frame = frameSizeOf(size, direction, choice.frames)
    const shownWidth = Math.max(1, Math.round(frame.width * scale))
    const shownHeight = Math.max(1, Math.round(frame.height * scale))
    const gaps = PREVIEW_GAP * (choice.frames - 1)
    canvas.width = direction === 'across' ? shownWidth * choice.frames + gaps : shownWidth
    canvas.height = direction === 'down' ? shownHeight * choice.frames + gaps : shownHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    for (let index = 0; index < choice.frames; index++) {
        const sourceX = direction === 'across' ? index * frame.width : 0
        const sourceY = direction === 'down' ? index * frame.height : 0
        const x = direction === 'across' ? index * (shownWidth + PREVIEW_GAP) : 0
        const y = direction === 'down' ? index * (shownHeight + PREVIEW_GAP) : 0
        ctx.drawImage(source, sourceX, sourceY, frame.width, frame.height, x, y, shownWidth, shownHeight)
    }
}

function choiceFrom(result: any): StripChoice {
    const layout: PictureLayout = result?.layout === 'down' || result?.layout === 'across' ? result.layout : 'one'
    if (layout === 'one') return { layout, frames: 1 }
    return { layout, frames: Number(layout === 'down' ? result.down_frames : result.across_frames) }
}

function askLayout(texture: Texture, size: PictureSize, question: StripQuestion, onPick: (choice: StripChoice) => void, onCancel: () => void) {
    const layout = question.layout(size)
    const canvas = previewCanvas()
    const text = document.createElement('p')
    const box = document.createElement('div')
    box.append(canvas, text)
    const show = (choice: StripChoice) => {
        drawPreview(canvas, texture.canvas, size, choice)
        text.textContent = caption(size, choice)
    }
    const startCount = (direction: StripDirection) => question.frames?.(size, direction) ?? suggestedFrames(size, direction)
    const startFrames = (direction: StripDirection) => frameCounts(size, direction).length > 0 ? String(startCount(direction)) : ''
    const form = {
        intro: { type: 'info', text: `'${pictureName(texture)}' is ${sizeText(size)}. Is it one picture, or a strip of frames?${question.note}` },
        layout: { type: 'select', label: 'This picture is', options: layoutOptions(size), value: layout },
        down_frames: { type: 'select', label: 'Frames', options: frameOptions(size, 'down'), value: startFrames('down'), condition: (result: any) => result?.layout === 'down' },
        across_frames: { type: 'select', label: 'Frames', options: frameOptions(size, 'across'), value: startFrames('across'), condition: (result: any) => result?.layout === 'across' },
    }
    let finished = false
    const finish = (settleWith: () => void) => {
        if (finished) return
        finished = true
        settleWith()
    }
    const dialog: Dialog = new Dialog({
        id: DIALOG_ID,
        title: 'One Picture or a Strip?',
        width: 500,
        form,
        form_first: true,
        lines: [box],
        cancel_on_click_outside: false,
        ...dialogButtons('Done', 'Cancel'),
        onFormChange(result: any) {
            show(choiceFrom(result))
        },
        onConfirm(result: any) {
            finish(() => onPick(choiceFrom(result)))
        },
        onCancel() {
            finish(onCancel)
        },
        onClose() {
            window.setTimeout(() => finish(onCancel), 0)
        },
    } as any)
    show(layout === 'one' ? { layout, frames: 1 } : { layout, frames: startCount(layout) })
    dialog.show()
}

function settle(texture: Texture, size: PictureSize, choice: StripChoice): string {
    if (choice.layout === 'one') {
        const kept = keepOnePicture(texture, size)
        return kept || (fitsOneFrame(size) ? '' : oversizeMessage(texture, size))
    }
    applyChoice(texture, size, choice, 'Split picture into frames')
    return splitMessage(texture, size, choice.layout, choice.frames)
}

function askAboutArrival(texture: Texture, question: StripQuestion, warnIfLarge: boolean): Promise<string> {
    return new Promise((resolve) => {
        const size = sizeOf(texture)
        if (!size) {
            resolve('')
            return
        }
        if (!worthAsking(size)) {
            const kept = keepOnePicture(texture, size)
            resolve(kept || (warnIfLarge && !fitsOneFrame(size) ? oversizeMessage(texture, size) : ''))
            return
        }
        askLayout(texture, size, question, (choice) => resolve(settle(texture, size, choice)), () => {
            const kept = keepOnePicture(texture, size)
            resolve(kept || `'${pictureName(texture)}' stays one picture. To split it later, use Picture options (three dots) > Split into Frames.`)
        })
    })
}

function shapeMessage(texture: Texture, size: PictureSize): string {
    const frames = frameCountOf(texture)
    const shape = frames === 1 ? `1 frame of ${size.width} x ${size.height}` : `${frames} frames of ${size.width} x ${size.height / frames}`
    return `The new picture is ${size.width} x ${size.height}, so '${pictureName(texture)}' now has ${shape}.`
}

function changedPicture(frames: number): StripQuestion {
    const keeps = (size: PictureSize) => frames > 1 && frameCounts(size, 'down').includes(frames)
    return {
        layout: (size) => (keeps(size) ? 'down' : suggestedLayout(size, true)),
        frames: (size, direction) => (direction === 'down' && keeps(size) ? frames : suggestedFrames(size, direction)),
        note: '',
    }
}

function settleChange(texture: Texture, size: PictureSize, choice: StripChoice): string {
    const message = settle(texture, size, choice)
    if (choice.layout !== 'one') return message
    return fitsOneFrame(size) ? `'${pictureName(texture)}' is now one picture, ${sizeText(size)}.` : oversizeMessage(texture, size)
}

function askAboutChange(texture: Texture): Promise<string> {
    return new Promise((resolve) => {
        const size = sizeOf(texture)
        if (!size) {
            resolve('')
            return
        }
        const kept = shapeMessage(texture, size)
        if (!worthAsking(size)) {
            resolve(kept)
            return
        }
        askLayout(texture, size, changedPicture(frameCountOf(texture)), (choice) => resolve(settleChange(texture, size, choice)), () => resolve(kept))
    })
}

function bodyPictureChanged(texture: Texture) {
    setFrameCount(texture, 1)
    const size = sizeOf(texture)
    if (size) say(`The new picture is ${size.width} x ${size.height}. A body picture stays one picture.`)
}

function say(message: string) {
    if (message) Blockbench.showQuickMessage(message, MESSAGE_MS)
}

export function offerPictureSetup(texture: Texture) {
    afterLoad(texture, () => {
        inTurn(() => askAboutArrival(texture, LAYER_PICTURE, true)).then((message) => {
            if (!checkPictureColors(texture, message)) say(message)
        })
    })
}

function onFinishedEdit(event: any) {
    if (event?.message !== BLOCKBENCH_ADD_MESSAGE || !isNameplateActive()) return
    const textures: Texture[] = Array.isArray(event.aspects?.textures) ? event.aspects.textures : []
    for (const texture of textures) afterLoad(texture, () => inTurn(() => askAboutArrival(texture, LOOSE_PICTURE, false)).then(say))
}

export function pictureChanged(texture: Texture, before: PictureShape) {
    if (!isNameplateActive() || (texture.width === before.width && texture.height === before.height)) return
    if (isBodyArt(texture)) bodyPictureChanged(texture)
    else inTurn(() => askAboutChange(texture)).then(say)
}

function refusal(texture: Texture, size: PictureSize): string {
    const name = pictureName(texture)
    if (frameCountOf(texture) > 1) return `'${name}' already has ${frameCountOf(texture)} frames.`
    if (isBodyArt(texture)) return `'${name}' is a body picture, and a body picture has one frame, so it can't be split.`
    if ((texture as any).layers_enabled) return `'${name}' has paint layers, which can't be split. Use Disable Layers in Picture options first.`
    if (!canSplit(size)) return `'${name}' is ${sizeText(size)}, which doesn't split into frames of at most ${MAX_SPRITE_SIZE} px each way with up to ${MAX_SPRITE_FRAMES} frames.`
    return ''
}

function splitSelected() {
    const texture = Texture.selected
    const size = texture ? sizeOf(texture) : null
    if (!texture || !size) return
    const refused = refusal(texture, size)
    if (refused) {
        say(refused)
        return
    }
    askLayout(texture, size, SPLIT_REQUEST, (choice) => {
        if (choice.layout !== 'one') say(settle(texture, size, choice))
    }, () => {})
}

export function registerPictures() {
    if (action) return
    action = defineAction(ACTION_ID, {
        name: 'Split into Frames',
        description: 'Cut one picture into frames',
        icon: 'view_week',
        category: 'textures',
        condition: () => isNameplateActive() && !!Texture.selected,
        click: splitSelected,
    })
    removeFromMenu = addToMenu((Texture.prototype as any).menu, action, '#settings')
    hooks = [Blockbench.on('finished_edit', onFinishedEdit)]
    removePanel = registerPicturesPanel()
}

export function unregisterPictures() {
    disposeAll(hooks)
    removePanel?.()
    removePanel = null
    if (!action) return
    removeFromMenu?.()
    removeFromMenu = null
    action.delete()
    action = null
}
