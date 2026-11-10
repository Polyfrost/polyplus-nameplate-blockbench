import { BodyArtData } from '../model'
import { frameCountOf } from '../palette/sprites'
import { readNameplate } from '../palette/state'
import { ART_PROPERTY, artTexture, readArt } from './layout'
import { artProblems, cloneArt, COLUMN_HANDLES, cutsOf, defaultArt, fitsSize, Handle, handleValue, moveHandle, ROW_HANDLES, Size } from './cuts'
import { dialogButtons } from '../util/dialogs'
import { findTexture } from '../util/texture'
import { undoEdit } from '../util/undo'
import { CUT_COLORS, drawPreview, loadArtPreview, paintTiles, previewSize, shortBodyNote } from './preview'

const DIALOG_ID = 'polyplus_nameplate_body_art'
const RULER_ROW = 16
const RULER_TOP = RULER_ROW * 2 + 8
const RULER_LEFT = 24
const MARGIN = 10
const GRAB = 8
const PREVIEW_SCALE = 2
const PREVIEW_DELAY = 60
const CLAMP_PAUSE = 500
const CHECKER_A = '#5a5d66'
const CHECKER_B = '#4a4d55'
const SHADE = 'rgba(20, 20, 24, 0.55)'

const HANDLE_LABELS: Record<Handle, string> = {
    left: 'where the left end stops',
    right: 'where the right end starts',
    seg0: 'where the repeating middle starts',
    seg1: 'where the repeating middle stops',
    cen0: 'where the center piece starts',
    cen1: 'where the center piece stops',
    top: 'how many rows at the top never repeat',
    bottom: 'how many rows at the bottom never repeat',
}

const HANDLE_COLORS: Record<Handle, string> = {
    left: CUT_COLORS.ends,
    right: CUT_COLORS.ends,
    seg0: CUT_COLORS.middle,
    seg1: CUT_COLORS.middle,
    cen0: CUT_COLORS.center,
    cen1: CUT_COLORS.center,
    top: CUT_COLORS.rows,
    bottom: CUT_COLORS.rows,
}

interface Picture {
    size: Size
    frames: number
    canvas: HTMLCanvasElement | null
}

interface Field {
    key: Handle | 'leftWidth' | 'rightWidth' | 'topRows' | 'bottomRows'
    label: string
    value: number | null
    min: number
    max: number
}

function pictureOf(texture: Texture | null): Picture {
    if (!texture?.canvas) return { size: { width: 1, height: 1 }, frames: 1, canvas: null }
    const frames = frameCountOf(texture)
    const width = Math.max(1, texture.canvas.width)
    const height = Math.max(1, Math.floor(texture.canvas.height / frames))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')?.drawImage(texture.canvas, 0, 0, width, height, 0, 0, width, height)
    return { size: { width, height }, frames, canvas }
}

function textureChoices(current: string): Array<{ uuid: string, name: string }> {
    if (typeof Texture === 'undefined') return []
    return Texture.all
        .filter((texture) => frameCountOf(texture) === 1 || texture.uuid === current)
        .map((texture) => ({ uuid: texture.uuid, name: frameCountOf(texture) === 1 ? texture.name : `${texture.name} (${frameCountOf(texture)} frames)` }))
}

function zoomFor(size: Size): number {
    return Math.max(3, Math.min(32, Math.floor(Math.min(560 / size.width, 260 / size.height))))
}

export function hasArt(node: any): boolean {
    return !!readArt(node?.[ART_PROPERTY])
}

export function openArtDialog(node: any): Dialog | null {
    if (!node) return null
    const stored = readArt(node[ART_PROPERTY])
    const startTexture = artTexture(stored)
    const firstChoice = textureChoices('')[0]
    const shown = startTexture ?? (firstChoice ? findTexture(firstChoice.uuid) ?? null : null)
    let picture = pictureOf(shown)
    const start: BodyArtData = stored && startTexture ? { ...cloneArt(stored), texture: startTexture.uuid } : defaultArt(shown?.uuid ?? '', picture.size)
    const state = {
        draft: start,
        textures: textureChoices(start.texture),
        showCuts: true,
        hover: '',
        previewIssues: [] as string[],
        note: '',
        fieldNote: '',
        revision: 0,
    }
    const view: { editor: HTMLCanvasElement | null, preview: HTMLCanvasElement | null, drag: Handle | null, timer: number | null, clampedAt: number } = { editor: null, preview: null, drag: null, timer: null, clampedAt: 0 }

    const zoom = () => zoomFor(picture.size)
    const origin = () => ({ x: RULER_LEFT, y: RULER_TOP })

    const drawEditor = () => {
        const canvas = view.editor
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return
        const { width, height } = picture.size
        const scale = zoom()
        canvas.width = RULER_LEFT + width * scale + MARGIN
        canvas.height = RULER_TOP + height * scale + MARGIN
        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        const { x: ox, y: oy } = origin()
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                ctx.fillStyle = (x + y) % 2 === 0 ? CHECKER_A : CHECKER_B
                ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale)
            }
        }
        if (picture.canvas) ctx.drawImage(picture.canvas, ox, oy, width * scale, height * scale)
        const art = state.draft
        const cuts = cutsOf(art, picture.size)
        const used = new Uint8Array(width)
        for (let x = 0; x < Math.min(cuts.left, width); x++) used[x] = 1
        if (!art.mirror) for (let x = Math.max(0, cuts.rightStart); x < width; x++) used[x] = 1
        if (cuts.segment) for (let x = cuts.segment[0]; x < cuts.segment[1]; x++) used[x] = 1
        if (cuts.center) for (let x = cuts.center[0]; x < cuts.center[1]; x++) used[x] = 1
        ctx.fillStyle = SHADE
        for (let x = 0; x < width; x++) if (!used[x]) ctx.fillRect(ox + x * scale, oy, scale, height * scale)

        const bar = (row: number, from: number, to: number, color: string) => {
            if (to <= from) return
            ctx.fillStyle = color
            ctx.fillRect(ox + from * scale, 4 + row * (RULER_ROW + 4), (to - from) * scale, RULER_ROW - 4)
        }
        ctx.globalAlpha = 0.55
        bar(0, 0, cuts.left, CUT_COLORS.ends)
        if (!art.mirror) bar(0, cuts.rightStart, width, CUT_COLORS.ends)
        if (cuts.segment) bar(1, cuts.segment[0], cuts.segment[1], CUT_COLORS.middle)
        if (cuts.center) bar(1, cuts.center[0], cuts.center[1], CUT_COLORS.center)
        ctx.fillStyle = CUT_COLORS.rows
        ctx.fillRect(4, oy + cuts.top * scale, RULER_LEFT - 10, Math.max(0, height - cuts.top - cuts.bottom) * scale)
        ctx.globalAlpha = 1

        ctx.lineWidth = 2
        for (const handle of [...COLUMN_HANDLES, ...ROW_HANDLES]) {
            const value = handleValue(art, picture.size, handle)
            if (value === null) continue
            const strong = view.drag === handle || state.hover === handle
            ctx.strokeStyle = HANDLE_COLORS[handle]
            ctx.setLineDash?.(strong ? [] : [4, 3])
            const horizontal = ROW_HANDLES.includes(handle)
            const rulerTop = 2 + (handle === 'left' || handle === 'right' ? 0 : 1) * (RULER_ROW + 4)
            ctx.beginPath()
            if (horizontal) {
                const y = oy + value * scale
                ctx.moveTo(2, y)
                ctx.lineTo(ox + width * scale, y)
            } else {
                const x = ox + value * scale
                ctx.moveTo(x, rulerTop)
                ctx.lineTo(x, oy + height * scale)
            }
            ctx.stroke()
            ctx.setLineDash?.([])
            ctx.fillStyle = HANDLE_COLORS[handle]
            if (horizontal) ctx.fillRect(2, oy + value * scale - 4, RULER_LEFT - 6, 8)
            else ctx.fillRect(ox + value * scale - 4, rulerTop, 8, RULER_ROW)
        }
    }

    const refreshPreview = () => {
        view.timer = null
        const canvas = view.preview
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return
        const texture = findTexture(state.draft.texture) ?? null
        const loaded = loadArtPreview({ node, palette: readNameplate().palette, texture, size: picture.size }, state.draft)
        state.previewIssues = loaded.issues
        if (!loaded.preview) {
            canvas.width = 1
            canvas.height = 1
            state.note = ''
            return
        }
        try {
            const layout = paintTiles(loaded.preview)
            const size = previewSize(layout, PREVIEW_SCALE)
            canvas.width = size.width
            canvas.height = size.height
            drawPreview(ctx, layout, PREVIEW_SCALE, state.draft, picture.size, state.showCuts)
            state.note = shortBodyNote(layout, state.draft, picture.size) ?? ''
        } catch (error) {
            console.error('[polyplus_nameplate] body picture preview failed', error)
            state.previewIssues = ["The preview couldn't be drawn. Close this and open it again."]
        }
    }

    const redraw = () => {
        drawEditor()
        if (view.timer !== null) window.clearTimeout(view.timer)
        view.timer = window.setTimeout(refreshPreview, PREVIEW_DELAY)
    }

    const update = (next: BodyArtData) => {
        state.draft = next
        state.revision++
        state.fieldNote = ''
        redraw()
    }

    const pointerAt = (event: PointerEvent): { x: number, y: number } => {
        const canvas = view.editor!
        const box = canvas.getBoundingClientRect()
        return {
            x: (event.clientX - box.left) * (canvas.width / Math.max(1, box.width)),
            y: (event.clientY - box.top) * (canvas.height / Math.max(1, box.height)),
        }
    }

    const handleAt = (point: { x: number, y: number }): Handle | null => {
        const scale = zoom()
        const { x: ox, y: oy } = origin()
        const art = state.draft
        let best: Handle | null = null
        let bestDistance = GRAB
        const consider = (handles: Handle[], axis: 'x' | 'y') => {
            for (const handle of handles) {
                const value = handleValue(art, picture.size, handle)
                if (value === null) continue
                const distance = axis === 'x' ? Math.abs(point.x - (ox + value * scale)) : Math.abs(point.y - (oy + value * scale))
                if (distance < bestDistance) {
                    best = handle
                    bestDistance = distance
                }
            }
        }
        if (point.y < RULER_TOP) consider(point.y < RULER_ROW + 4 ? ['left', 'right'] : ['cen0', 'cen1', 'seg0', 'seg1'], 'x')
        else if (point.x < RULER_LEFT) consider(ROW_HANDLES, 'y')
        else {
            consider(COLUMN_HANDLES, 'x')
            consider(ROW_HANDLES, 'y')
        }
        return best
    }

    const dragTo = (point: { x: number, y: number }) => {
        const handle = view.drag
        if (!handle) return
        const scale = zoom()
        const { x: ox, y: oy } = origin()
        const value = ROW_HANDLES.includes(handle) ? Math.round((point.y - oy) / scale) : Math.round((point.x - ox) / scale)
        if (handleValue(state.draft, picture.size, handle) === value) return
        update(moveHandle(state.draft, picture.size, handle, value))
    }

    const component = {
        data: () => state,
        computed: {
            fields(this: any): Field[] {
                void this.revision
                const art: BodyArtData = this.draft
                const size = picture.size
                const cuts = cutsOf(art, size)
                const list: Field[] = [
                    { key: 'leftWidth', label: 'Left end width (px)', value: art.left, min: art.mirror ? 1 : 0, max: size.width },
                ]
                if (!art.mirror) list.push({ key: 'rightWidth', label: 'Right end width (px)', value: art.right, min: 0, max: size.width })
                if (cuts.segment) {
                    list.push({ key: 'seg0', label: 'Repeat from column', value: cuts.segment[0], min: 0, max: size.width - 1 })
                    list.push({ key: 'seg1', label: 'Repeat up to column', value: cuts.segment[1], min: 1, max: size.width })
                }
                if (art.center) {
                    list.push({ key: 'cen0', label: 'Center piece from column', value: art.center[0], min: 0, max: size.width - 1 })
                    list.push({ key: 'cen1', label: 'Center piece up to column', value: art.center[1], min: 1, max: size.width })
                }
                list.push({ key: 'topRows', label: 'Fixed rows at the top', value: cuts.top, min: 0, max: size.height - 1 })
                list.push({ key: 'bottomRows', label: 'Fixed rows at the bottom', value: cuts.bottom, min: 0, max: size.height - 1 })
                return list
            },
            problems(this: any): string[] {
                void this.revision
                if (!this.draft.texture) return ['Pick a picture first.']
                return artProblems(this.draft, picture.size, picture.frames)
            },
            sizeText(this: any): string {
                void this.revision
                return this.draft.texture ? `${picture.size.width} x ${picture.size.height} px` : ''
            },
            hoverText(this: any): string {
                const handle = this.hover as Handle | ''
                if (!handle) return 'Drag a colored line to move it.'
                const value = handleValue(this.draft, picture.size, handle)
                return `Drag to set ${HANDLE_LABELS[handle]} (${ROW_HANDLES.includes(handle) ? 'row' : 'column'} ${value}).`
            },
            repeating(this: any): boolean {
                void this.revision
                return !!cutsOf(this.draft, picture.size).segment
            },
        },
        methods: {
            setTexture(this: any, uuid: string) {
                const texture = findTexture(uuid) ?? null
                picture = pictureOf(texture)
                const keep = { ...cloneArt(state.draft), texture: uuid }
                update(fitsSize(keep, picture.size) ? keep : defaultArt(uuid, picture.size))
                state.textures = textureChoices(uuid)
            },
            setField(this: any, key: Field['key'], input: HTMLInputElement) {
                const fieldOf = (): Field | undefined => (this.fields as Field[]).find((field) => field.key === key)
                const value = Math.round(Number(input.value))
                if (input.value.trim() === '' || !isFinite(value)) {
                    input.value = String(fieldOf()?.value ?? '')
                    return
                }
                const size = picture.size
                const art = state.draft
                if (key === 'rightWidth') update(moveHandle(art, size, 'right', size.width - value))
                else if (key === 'bottomRows') update(moveHandle(art, size, 'bottom', size.height - value))
                else if (key === 'leftWidth') update(moveHandle(art, size, 'left', value))
                else if (key === 'topRows') update(moveHandle(art, size, 'top', value))
                else update(moveHandle(art, size, key, value))
                const field = fieldOf()
                if (!field) return
                input.value = String(field.value ?? '')
                if (field.value === value) return
                state.fieldNote = `${field.label} can't be ${value}, because it has to fit inside the ${size.width} x ${size.height} px picture next to the other parts. It is ${field.value} now.`
                view.clampedAt = Date.now()
            },
            setMirror(this: any, on: boolean) {
                const art = cloneArt(state.draft)
                if (on) {
                    art.mirror = true
                    art.right = 0
                    art.left = Math.max(1, art.left)
                } else {
                    art.mirror = false
                    art.right = Math.min(art.left, Math.max(0, picture.size.width - art.left))
                }
                update(art)
            },
            setCenter(this: any, on: boolean) {
                const art = cloneArt(state.draft)
                const size = picture.size
                if (on) {
                    const cuts = cutsOf(art, size)
                    if (!art.segment && cuts.segment) art.segment = cuts.segment
                    const middle = Math.floor(size.width / 2)
                    art.center = [Math.max(0, middle - 1), Math.min(size.width, middle + 1)]
                } else {
                    art.center = null
                }
                update(art)
            },
            setRepeat(this: any, on: boolean) {
                const art = cloneArt(state.draft)
                if (on) art.segment = [art.left, Math.max(art.left + 1, picture.size.width - (art.mirror ? 0 : art.right))]
                else art.segment = null
                update(art)
            },
            resetMiddle(this: any) {
                update({ ...cloneArt(state.draft), segment: null })
            },
            resetRows(this: any) {
                update({ ...cloneArt(state.draft), top: null, bottom: null })
            },
            toggleCuts(this: any) {
                state.showCuts = !state.showCuts
                redraw()
            },
            down(this: any, event: PointerEvent) {
                const handle = handleAt(pointerAt(event))
                if (!handle) return
                view.drag = handle
                ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
                event.preventDefault()
                drawEditor()
            },
            move(this: any, event: PointerEvent) {
                const point = pointerAt(event)
                if (view.drag) {
                    dragTo(point)
                    return
                }
                const handle = handleAt(point) ?? ''
                if (handle !== state.hover) {
                    state.hover = handle
                    if (view.editor) view.editor.style.cursor = !handle ? 'default' : ROW_HANDLES.includes(handle) ? 'ns-resize' : 'ew-resize'
                    drawEditor()
                }
            },
            up(this: any, event: PointerEvent) {
                if (!view.drag) return
                view.drag = null
                ;(event.target as HTMLElement).releasePointerCapture?.(event.pointerId)
                drawEditor()
            },
            leave(this: any) {
                if (view.drag || !state.hover) return
                state.hover = ''
                drawEditor()
            },
        },
        mounted(this: any) {
            view.editor = this.$refs.editor as HTMLCanvasElement
            view.preview = this.$refs.preview as HTMLCanvasElement
            redraw()
        },
        beforeDestroy() {
            if (view.timer !== null) window.clearTimeout(view.timer)
            view.editor = null
            view.preview = null
        },
        template: `
            <div class="np-art" style="display: flex; flex-direction: column; gap: 8px;">
                <p style="margin: 0;">The ends stay as painted. The middle repeats to fit any name. Drag the colored lines, or type numbers on the right.</p>
                <div style="display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 300px;">
                        <div style="overflow: auto; max-height: 360px;">
                            <canvas ref="editor" style="image-rendering: pixelated; touch-action: none;" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @pointerleave="leave"></canvas>
                        </div>
                        <p class="np-subtle" style="margin: 4px 0;">{{ hoverText }}</p>
                        <div style="display: flex; flex-wrap: wrap; gap: 10px; font-size: 0.9em;">
                            <span><span style="display: inline-block; width: 10px; height: 10px; background: ${CUT_COLORS.ends};"></span> Ends (never stretch)</span>
                            <span><span style="display: inline-block; width: 10px; height: 10px; background: ${CUT_COLORS.middle};"></span> Repeats to fill the width</span>
                            <span><span style="display: inline-block; width: 10px; height: 10px; background: ${CUT_COLORS.center};"></span> Center piece (drawn once, in the middle)</span>
                            <span><span style="display: inline-block; width: 10px; height: 10px; background: ${CUT_COLORS.rows};"></span> Rows that repeat on taller tags</span>
                            <span class="np-subtle">Dark columns are not used.</span>
                        </div>
                    </div>
                    <div style="width: 290px; flex: none;">
                        <div class="dialog_bar form_bar" style="display: flex; align-items: center; gap: 6px;">
                            <label class="name_space_left" style="flex: none;">Picture</label>
                            <select class="dark_bordered" style="flex: 1; min-width: 0;" :value="draft.texture" @change="setTexture($event.target.value)">
                                <option v-if="!draft.texture" value="">Pick a picture</option>
                                <option v-for="texture in textures" :key="texture.uuid" :value="texture.uuid">{{ texture.name }}</option>
                            </select>
                        </div>
                        <p v-if="!textures.length" class="np-subtle">There is no one-frame picture yet. Close this, then use "Make a new picture" under Body picture in the Inspector.</p>
                        <p v-if="sizeText" class="np-subtle" style="margin: 2px 0 6px;">{{ sizeText }}</p>
                        <label style="display: flex; align-items: center; gap: 6px; margin: 4px 0;">
                            <input type="checkbox" :checked="draft.mirror" @change="setMirror($event.target.checked)">
                            Right end is the left end, flipped
                        </label>
                        <label style="display: flex; align-items: center; gap: 6px; margin: 4px 0;">
                            <input type="checkbox" :checked="!!draft.center" @change="setCenter($event.target.checked)">
                            Center piece (drawn once in the middle)
                        </label>
                        <label v-if="draft.center" style="display: flex; align-items: center; gap: 6px; margin: 4px 0;">
                            <input type="checkbox" :checked="repeating" @change="setRepeat($event.target.checked)">
                            Repeat columns either side of it
                        </label>
                        <div v-for="field in fields" :key="field.key" class="dialog_bar form_bar" style="display: flex; align-items: center; gap: 6px;">
                            <label class="name_space_left" style="flex: 1;">{{ field.label }}</label>
                            <input type="number" class="dark_bordered" style="width: 70px; flex: none;" :value="field.value" :min="field.min" :max="field.max" step="1" @change="setField(field.key, $event.target)">
                        </div>
                        <p v-if="fieldNote" style="margin: 6px 0 0; color: var(--color-warning, #e8a33d);">{{ fieldNote }}</p>
                        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px;">
                            <button type="button" v-if="!draft.center && draft.segment" @click="resetMiddle()" title="Repeat every column between the two ends">Middle: automatic</button>
                            <button type="button" v-if="draft.top !== null || draft.bottom !== null" @click="resetRows()" title="Keep all rows but one fixed, and repeat the middle row">Rows: automatic</button>
                        </div>
                        <ul v-if="problems.length || previewIssues.length" style="margin: 8px 0 0; padding-left: 16px; color: var(--color-error, #e85050);">
                            <li v-for="problem in problems" :key="'p' + problem">{{ problem }}</li>
                            <li v-for="issue in previewIssues" :key="'i' + issue">{{ issue }}</li>
                        </ul>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <strong>Preview</strong>
                    <label style="display: flex; align-items: center; gap: 4px; margin-left: auto;">
                        <input type="checkbox" :checked="showCuts" @change="toggleCuts()"> Show the cuts
                    </label>
                </div>
                <p v-if="note" class="np-subtle" style="margin: 0;">{{ note }}</p>
                <div style="overflow: auto; max-height: 320px;">
                    <canvas ref="preview" style="image-rendering: pixelated;"></canvas>
                </div>
            </div>
        `,
    }

    const dialog: any = new Dialog({
        id: DIALOG_ID,
        title: `Body Picture: ${String(node.name ?? 'body')}`,
        width: Math.max(760, Math.min(window.innerWidth - 60, 1000)),
        ...dialogButtons('Done', 'Cancel'),
        component: component as any,
        onConfirm() {
            const focused = document.activeElement
            if (focused instanceof HTMLInputElement && dialog.object?.contains(focused)) focused.blur()
            if (Date.now() - view.clampedAt < CLAMP_PAUSE) return false
            const art = state.draft
            if (!art.texture) return
            const value = cloneArt(art)
            undoEdit({ elements: [node] }, 'Edit body picture', () => {
                node[ART_PROPERTY] = value
            })
            Blockbench.dispatchEvent('update_selection', {} as any)
        },
    } as any)
    dialog.show()
    return dialog
}
