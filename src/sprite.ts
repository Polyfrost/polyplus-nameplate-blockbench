import { currentLoopFrames, frameDivisors, isNameplateActive } from './format'
import { joinList } from './util/text'
import { CREATE_AND_PAINT_BUTTONS } from './util/dialogs'
import { pictureStem, sanitizeId, uniqueId } from './palette/ids'
import { wholeFlooredClamped } from './util/num'
import { readNameplate } from './palette/state'
import { findLoopAnimation } from './util/animation'
import { canvasOf, setFrameCount, textureFromCanvas } from './util/texture'

export const DEFAULT_SPRITE_SIZE = 8
export const DEFAULT_SPRITE_FRAMES = 1
export const MAX_SPRITE_SIZE = 64
export const MAX_SPRITE_FRAMES = 120
const DIALOG_ID = 'polyplus_nameplate_sprite'

export interface SpriteSpec {
    name: string
    width: number
    height: number
    frames: number
}

export type Draw = (ctx: CanvasRenderingContext2D, spec: SpriteSpec) => void

interface PromptOptions {
    frames?: boolean
}

interface CreateOptions {
    select?: boolean
    draw?: Draw
}

export interface PictureShape {
    width: number
    height: number
    frames: number
}

export function freeTextureName(base: string): string {
    const taken = new Set(Texture.all.map((texture) => sanitizeId(pictureStem(texture.name))))
    return uniqueId(sanitizeId(base) || 'sprite', (candidate) => taken.has(candidate))
}

function fittingFrames(): number[] {
    return frameDivisors(currentLoopFrames(), MAX_SPRITE_FRAMES)
}

export function framesLabel(): string {
    return `Frames (${joinList(fittingFrames(), 'or')})`
}

export function framesDescription(keyed = false): string {
    if (keyed) return 'Animation frames, stacked top to bottom in the picture. Frame keyframes in the loop pick which frame shows, so any count works.'
    return `Animation frames, stacked top to bottom in the picture. The count must divide the loop's ${currentLoopFrames()} frames, unless Frame keyframes in the loop animation pick the frames.`
}

export function isFrameKeyed(uuid: unknown): boolean {
    if (typeof uuid !== 'string' || typeof Animator === 'undefined') return false
    const loop = findLoopAnimation()
    const keys = loop?.animators?.[uuid]?.frame
    return Array.isArray(keys) && keys.length > 0
}

function snapFrames(value: unknown): number {
    const wanted = wholeFlooredClamped(value, 1, MAX_SPRITE_FRAMES, DEFAULT_SPRITE_FRAMES)
    const fitting = fittingFrames()
    for (let index = fitting.length - 1; index >= 0; index--) if (fitting[index] <= wanted) return fitting[index]
    return 1
}

export function placeholderColors(): { main: string, light: string } {
    const slots = readNameplate().palette.slots
    const slot = slots[2] ?? slots[slots.length - 1]
    const ramp = slot?.ramp?.length ? slot.ramp : ['#FFFFFF']
    return { main: ramp[Math.min(1, ramp.length - 1)], light: ramp[ramp.length - 1] }
}

function insideDiamond(x: number, y: number, width: number, height: number): boolean {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const dx = Math.abs(x + 0.5 - width / 2) / (width / 2)
    const dy = Math.abs(y + 0.5 - height / 2) / (height / 2)
    return dx + dy <= 1
}

export const drawOrnament: Draw = (ctx, spec) => {
    const colors = placeholderColors()
    const { width, height, frames } = spec
    for (let frame = 0; frame < frames; frame++) {
        const top = frame * height
        if (width < 3 || height < 3) {
            ctx.fillStyle = colors.main
            ctx.fillRect(0, top, width, height)
            continue
        }
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (!insideDiamond(x, y, width, height)) continue
                const rim = !insideDiamond(x - 1, y, width, height) || !insideDiamond(x, y - 1, width, height)
                ctx.fillStyle = rim ? colors.light : colors.main
                ctx.fillRect(x, top + y, 1, 1)
            }
        }
    }
}

export function normalizeSpec(raw: Partial<SpriteSpec>): SpriteSpec {
    return {
        name: freeTextureName(String(raw.name ?? 'sprite')),
        width: wholeFlooredClamped(raw.width, 1, MAX_SPRITE_SIZE, DEFAULT_SPRITE_SIZE),
        height: wholeFlooredClamped(raw.height, 1, MAX_SPRITE_SIZE, DEFAULT_SPRITE_SIZE),
        frames: snapFrames(raw.frames),
    }
}

export function createBlankTexture(spec: SpriteSpec, options: CreateOptions = {}): Texture {
    const { draw } = options
    const canvas = canvasOf(spec.width, spec.height * spec.frames, draw ? (context) => draw(context, spec) : undefined)
    const texture = textureFromCanvas(canvas, { name: spec.name, frames: spec.frames })
    if (options.select !== false) texture.select()
    return texture
}

function isSize(value: unknown): boolean {
    return Number(value) >= 1
}

function sizeField(label: string): Record<string, unknown> {
    return { label: `${label} (pixels, at most ${MAX_SPRITE_SIZE})`, type: 'number', value: DEFAULT_SPRITE_SIZE, step: 1 }
}

function framesOfChangedPicture(width: number, height: number, before: PictureShape): number {
    const frameHeight = before.height / before.frames
    const sameStrip = width === before.width && Number.isInteger(height / frameHeight)
    const frames = sameStrip ? height / frameHeight : Number.isInteger(height / width) ? height / width : 1
    return frames >= 1 && frames <= MAX_SPRITE_FRAMES ? frames : 1
}

export function adoptChangedPicture(texture: Texture, before: PictureShape) {
    if (!isNameplateActive()) return
    Project.saved = false
    const { width, height } = texture
    if (width === before.width && height === before.height) return
    const frames = framesOfChangedPicture(width, height, before)
    setFrameCount(texture, frames)
    texture.uv_width = width
    texture.uv_height = height
    if (texture.selected) {
        Project.texture_width = width
        Project.texture_height = height
    }
}

export function createdNotes(raw: Partial<SpriteSpec>, spec: SpriteSpec): string[] {
    const notes: string[] = []
    if (raw.width !== undefined && Number(raw.width) !== spec.width) notes.push(`A picture can be 1 to ${MAX_SPRITE_SIZE} px wide, so this one is ${spec.width}.`)
    if (raw.height !== undefined && Number(raw.height) !== spec.height) notes.push(`A frame can be 1 to ${MAX_SPRITE_SIZE} px tall, so this one is ${spec.height}.`)
    const wanted = sanitizeId(String(raw.name ?? ''))
    if (wanted && wanted !== spec.name) notes.push(`'${wanted}' is taken, so this one is '${spec.name}'.`)
    if (raw.frames !== undefined && Number(raw.frames) !== spec.frames) notes.push(`${raw.frames} frames don't fit the loop, so it has ${spec.frames}.`)
    return notes
}

export function promptSprite(title: string, onCreate: (spec: SpriteSpec, paintNow: boolean) => void, suggestedName = 'sprite', options: PromptOptions = {}) {
    const form: Record<string, unknown> = {
        name: { label: 'Name', type: 'text', value: freeTextureName(suggestedName) },
        width: sizeField('Width'),
        height: sizeField('Height of one frame'),
    }
    if (options.frames !== false) {
        form.frames = {
            label: framesLabel(),
            type: 'number',
            value: DEFAULT_SPRITE_FRAMES,
            min: 1,
            max: MAX_SPRITE_FRAMES,
            step: 1,
            description: `${framesDescription()} Other counts are rounded down to one that fits.`,
        }
    }
    const dialog: Dialog = new Dialog({
        id: DIALOG_ID,
        title,
        form,
        ...CREATE_AND_PAINT_BUTTONS,
        onButton(index: number) {
            if (index > 1) return
            const raw = dialog.getFormResult() as Partial<SpriteSpec>
            if (!isSize(raw.width) || !isSize(raw.height)) {
                Blockbench.showQuickMessage('A picture needs a width and a height of at least 1 px. Fill in both.', 3000)
                return false
            }
            if (Number(raw.width) > MAX_SPRITE_SIZE || Number(raw.height) > MAX_SPRITE_SIZE) {
                Blockbench.showQuickMessage(`A picture can be at most ${MAX_SPRITE_SIZE} px wide and ${MAX_SPRITE_SIZE} px tall per frame. Use a smaller size.`, 3000)
                return false
            }
            const spec = normalizeSpec(raw)
            onCreate(spec, index === 1)
            const notes = createdNotes(raw, spec)
            if (notes.length) Blockbench.showQuickMessage(notes.join(' '), 3000)
        },
    } as any)
    dialog.show()
}
