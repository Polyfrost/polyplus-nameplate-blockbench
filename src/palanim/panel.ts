import { retainEvents, onLight } from '../design/events'
import { currentFps, secondsText } from '../format'
import { NameplateData, Slot } from '../model'
import { mainColorway } from '../palette/colorway'
import { onNameplateChanged, readNameplate } from '../palette/state'
import { onNewPreviewProject, onPreviewResult, previewUi, redraw } from '../preview'
import { injectStyle } from '../util/style'
import { disposeAll } from '../util/teardown'
import { plural } from '../util/text'
import { slotProblems } from './compile'
import { openKeyDialog } from './dialog'
import { onFocusSlot, removeKey, scopedMotion, setCycle, setKeyBase, setSlotMotion } from './edit'
import { reactionPaletteIssues } from './reaction'
import { ColorSpan, currentSpan, inAnimate } from './scope'
import { safeCycle } from './flash'
import { colorsAt } from './resolve'
import { hasProject } from '../util/project'
import { CYCLE_MODES, EASE_NAMES, MODE_NAMES, cyclePeriod, describeMotion, everyChoices, isBaseColor, isBaseKey } from './types'

const STYLE_ID = 'polyplus_nameplate_palanim_style'

const STYLE = `
ul.np-palanim-strip { display: flex; height: 14px; margin: 2px 0 0; padding: 0; list-style: none; border: 1px solid var(--color-border); }
ul.np-palanim-strip > li { flex: 1 1 0; list-style: none; }
.np-palanim-detail { padding: 4px 10px 8px; border-top: 1px solid var(--color-border); }
.np-palanim-detail p { margin: 4px 0; }
.np-palanim-buttons { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
.np-palanim-buttons button { display: inline-flex; align-items: center; gap: 4px; }
.np-palanim-timeline { display: flex; height: 22px; margin: 6px 0 2px; border: 1px solid var(--color-border); cursor: pointer; }
.np-palanim-timeline > div { flex: 1 1 0; min-width: 1px; position: relative; }
.np-palanim-timeline > div.np-key::after { content: ''; position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -4px 0 0 -4px; transform: rotate(45deg); background-color: var(--color-text); border: 1px solid var(--color-back); }
.np-palanim-timeline > div.np-now { box-shadow: inset 0 0 0 2px var(--color-accent); z-index: 1; }
.np-palanim-ruler { display: flex; justify-content: space-between; color: var(--color-subtle_text); font-size: 0.9em; }
ul.np-palanim-keys { margin: 4px 0 0; padding: 0; list-style: none; }
ul.np-palanim-keys > li { display: flex; align-items: center; gap: 6px; padding: 2px 0; list-style: none; }
ul.np-palanim-keys > li.np-now { color: var(--color-accent); }
ul.np-palanim-keys .np-palanim-strip { flex: 1; margin: 0; }
.np-palanim-keyframe { min-width: 5.5em; cursor: pointer; }
.np-palanim-ease { min-width: 6.5em; }
`

interface RowView {
    id: string
    name: string
    summary: string
    animated: boolean
    problem: boolean
    swatches: string[]
}

interface CellView {
    frame: number
    color: string
    key: boolean
    now: boolean
    title: string
}

interface KeyView {
    frame: number
    ease: string
    swatches: string[]
    first: boolean
    base: boolean
    title: string
}

interface DetailView {
    id: string
    name: string
    kind: 'cycle' | 'keys' | 'none'
    effectHelp: string
    cycleText: string
    canFaster: boolean
    canSlower: boolean
    modeName: string
    cells: CellView[]
    keys: KeyView[]
    hasKeyHere: boolean
}

interface PanelUi {
    hasProject: boolean
    scoped: boolean
    scopeName: string
    scopeNote: string
    loop: number
    fps: number
    frame: number
    loopText: string
    selected: string
    rows: RowView[]
    detail: DetailView | null
}

export const palanimUi: PanelUi = {
    hasProject: false,
    scoped: false,
    scopeName: '',
    scopeNote: '',
    loop: 20,
    fps: 10,
    frame: 0,
    loopText: '',
    selected: '',
    rows: [],
    detail: null,
}

let lastPlate: NameplateData | null = null
let lastSpan: ColorSpan | null = null
let lastVariant = ''

const handles: { style: (() => void) | null, removers: Array<() => void> } = { style: null, removers: [] }

function shownColorway(plate: NameplateData): string | null {
    const variant = plate.variants[previewUi.variant]
    const names = Object.keys(plate.palette.colorways)
    const colorway = variant?.palette ?? names[0] ?? null
    return colorway && colorway !== mainColorway(plate.palette) ? colorway : null
}

function scoped(slot: Slot, span: ColorSpan | null): Slot {
    return span?.animation ? { ...slot, animation: scopedMotion(span.animation, slot) } : slot
}

function changeSummary(slot: Slot, span: ColorSpan | null): string {
    if (!span?.animation) return describeMotion(slot.animation)
    if (!slot.animation) return 'No change'
    if (slot.animation.kind === 'cycle') return describeMotion(slot.animation)
    const count = slot.animation.keys.length
    return count === 1 ? 'Changes for the whole time' : `${count} keyframes`
}

function cycleText(slot: Slot, loop: number, fps: number): string {
    if (slot.animation?.kind !== 'cycle') return ''
    const motion = slot.animation
    const round = cyclePeriod(motion.mode, slot.ramp.length, motion.every)
    const every = motion.every === 1 ? 'every frame' : `every ${plural(motion.every, 'frame')} (${secondsText(motion.every, fps)})`
    const per = lastSpan?.animation && lastSpan.oneShot ? 'while it plays' : 'per loop'
    const rounds = loop % round === 0 ? ` That is ${loop / round === 1 ? 'one round' : `${loop / round} rounds`} ${per}.` : ''
    return `The shades move ${MODE_NAMES[motion.mode].toLowerCase()} one step ${every}. One round takes ${plural(round, 'frame')}.${rounds}`
}

function keyTitle(colors: string[]): string {
    if (colors.every(isBaseColor)) return "Base: each colorway's own colors. Right-click to change"
    if (colors.some(isBaseColor)) return "Some shades are Base (each colorway's own color). Right-click to change"
    return "Fixed colors. Right-click to use each colorway's own colors instead"
}

function detailOf(slot: Slot, plate: NameplateData, loop: number, fps: number, frame: number): DetailView {
    const motion = slot.animation
    const colorway = shownColorway(plate)
    const middle = Math.max(0, (slot.ramp.length >> 1))
    const keyFrames = new Set(motion?.kind === 'keys' ? motion.keys.map((key) => key.frame) : [])
    const cells: CellView[] = []
    if (motion?.kind === 'keys') {
        for (let at = 0; at < loop; at++) {
            const colors = colorsAt(plate.palette, slot, motion, at, loop, colorway)
            cells.push({
                frame: at,
                color: colors[middle] ?? colors[0] ?? 'transparent',
                key: keyFrames.has(at),
                now: at === frame,
                title: keyFrames.has(at) ? `Keyframe at frame ${at}. Click to go there, double-click to edit` : `Frame ${at}. Click to go there, double-click to add a keyframe`,
            })
        }
    }
    const choices = motion?.kind === 'cycle' ? everyChoices(loop, motion.mode, slot.ramp.length) : []
    const every = motion?.kind === 'cycle' ? motion.every : 0
    return {
        id: slot.id,
        name: slot.name,
        kind: motion ? motion.kind : 'none',
        effectHelp: motion ? '' : lastSpan?.animation
            ? `This color doesn't change while '${lastSpan.name}' plays. Pick a style to change it.`
            : 'This color doesn\'t change yet. Pick a style to make it shimmer, pulse or run through a rainbow.',
        cycleText: cycleText(slot, loop, fps),
        canFaster: choices.some((value) => value < every),
        canSlower: choices.some((value) => value > every),
        modeName: motion?.kind === 'cycle' ? MODE_NAMES[motion.mode] : '',
        cells,
        keys: motion?.kind === 'keys'
            ? motion.keys.map((key, index) => ({
                frame: key.frame,
                ease: index === 0 ? 'Start' : EASE_NAMES[key.ease],
                swatches: colorsAt(plate.palette, slot, { kind: 'keys', keys: [key] }, 0, loop, colorway),
                first: key.frame === 0,
                base: isBaseKey(key),
                title: keyTitle(key.colors),
            }))
            : [],
        hasKeyHere: keyFrames.has(frame),
    }
}

function refreshColorAnimation() {
    try {
        lastVariant = previewUi.variant
        palanimUi.hasProject = hasProject()
        if (!palanimUi.hasProject) {
            lastPlate = null
            lastSpan = null
            palanimUi.rows = []
            palanimUi.detail = null
            return
        }
        const plate = readNameplate()
        const span = currentSpan()
        lastPlate = plate
        lastSpan = span
        const loop = span.length
        const fps = currentFps()
        palanimUi.scoped = !!span.animation
        palanimUi.scopeName = span.name
        palanimUi.scopeNote = span.note
        palanimUi.loop = loop
        palanimUi.fps = fps
        palanimUi.loopText = `${plural(loop, 'frame')}, ${secondsText(loop, fps)}`
        if (palanimUi.frame >= loop) palanimUi.frame = 0
        const colorway = shownColorway(plate)
        const slots = plate.palette.slots.map((slot) => scoped(slot, span))
        palanimUi.rows = slots.map((slot) => ({
            id: slot.id,
            name: slot.name,
            summary: changeSummary(slot, span),
            animated: !!slot.animation,
            problem: span.animation
                ? reactionPaletteIssues(slot.animation ? [{ slot: slot.id, motion: slot.animation }] : [], plate.palette, span, '').length > 0
                : slotProblems(slot, plate.palette, loop).length > 0,
            swatches: colorsAt(plate.palette, slot, slot.animation, palanimUi.frame, loop, colorway),
        }))
        const chosen = slots.find((slot) => slot.id === palanimUi.selected)
        palanimUi.selected = chosen?.id ?? ''
        palanimUi.detail = chosen ? detailOf(chosen, plate, loop, fps, palanimUi.frame) : null
    } catch (error) {
        console.error('[polyplus_nameplate] color animation refresh failed', error)
    }
}

function wrapFrame(frame: number): number {
    const loop = Math.max(1, palanimUi.loop)
    return ((frame % loop) + loop) % loop
}

export function goToFrame(frame: number) {
    const target = wrapFrame(Math.round(frame))
    palanimUi.frame = target
    const timeline = (globalThis as any).Timeline
    if (inAnimate() && timeline) {
        try {
            if (timeline.playing) timeline.pause?.()
            timeline.setTime?.(target / Math.max(1, palanimUi.fps))
            ;(globalThis as any).Animator?.preview?.()
        } catch (error) {
            console.error('[polyplus_nameplate] could not move the playhead', error)
        }
    } else {
        previewUi.playing = false
        previewUi.frame = target
        redraw(false)
    }
    refreshColorAnimation()
}

function spanAnimation(): any | null {
    return lastSpan?.animation ?? null
}

function shownSlot(slotId: string): Slot | undefined {
    const slot = readNameplate().palette.slots.find((entry) => entry.id === slotId)
    return slot ? scoped(slot, lastSpan) : undefined
}

function stepEvery(slotId: string, direction: 1 | -1) {
    const slot = shownSlot(slotId)
    if (slot?.animation?.kind !== 'cycle') return
    const motion = slot.animation
    const choices = everyChoices(palanimUi.loop, motion.mode, slot.ramp.length)
    const next = direction > 0 ? choices.find((value) => value > motion.every) : choices.filter((value) => value < motion.every).pop()
    if (next !== undefined) setCycle(slotId, (target) => { target.every = next }, spanAnimation())
}

export function safeEffect(slotId: string) {
    if (spanAnimation()) return
    const slot = readNameplate().palette.slots.find((entry) => entry.id === slotId)
    if (slot?.animation?.kind !== 'cycle') return
    const checked = safeCycle(slotId, slot.animation, null, palanimUi.loop)
    if (checked.motion.every !== slot.animation.every) {
        setCycle(slotId, (target) => { target.every = checked.motion.every })
        Blockbench.showQuickMessage(`One shade every ${plural(checked.motion.every, 'frame')} is safe`, 2200)
    } else if (checked.safe) {
        Blockbench.showQuickMessage('This speed is already safe', 1800)
    } else {
        Blockbench.showQuickMessage('No speed is safe with these shades. Use shades closer in brightness.', 3000)
    }
}

function directionMenu(slotId: string): Menu {
    return new Menu(CYCLE_MODES.map((mode) => ({
        name: MODE_NAMES[mode],
        icon: mode === 'pingpong' ? 'swap_horiz' : mode === 'forward' ? 'arrow_forward' : 'arrow_back',
        click: () => {
            const slot = shownSlot(slotId)
            if (slot?.animation?.kind !== 'cycle') return
            const current = slot.animation.every
            const choices = everyChoices(palanimUi.loop, mode, slot.ramp.length)
            const every = choices.includes(current) ? current : choices.find((value) => value >= current) ?? choices[0] ?? current
            setCycle(slotId, (target) => {
                target.mode = mode
                target.every = every
            }, spanAnimation())
        },
    })) as any)
}

function openSlotEffect(slotId: string) {
    palanimUi.selected = slotId
    refreshColorAnimation()
}

export function toggleSlotEffect(slotId: string) {
    palanimUi.selected = palanimUi.selected === slotId ? '' : slotId
    refreshColorAnimation()
}

export function stopEffect(slotId: string) {
    setSlotMotion(slotId, undefined, spanAnimation() ? 'Remove color change' : 'Stop color animation', spanAnimation())
}

export function fasterEffect(slotId: string) {
    stepEvery(slotId, -1)
}

export function slowerEffect(slotId: string) {
    stepEvery(slotId, 1)
}

export function openDirectionMenu(slotId: string, event: Event) {
    directionMenu(slotId).open(event as MouseEvent)
}

export function editKeyAt(slotId: string, frame: number) {
    goToFrame(frame)
    openKeyDialog(slotId, frame)
}

export function addKeyHere(slotId: string) {
    openKeyDialog(slotId, palanimUi.frame)
}

export function dropKey(slotId: string, frame: number) {
    removeKey(slotId, frame, spanAnimation())
}

function keyMenu(slotId: string, frame: number): Menu {
    const key = palanimUi.detail?.id === slotId ? palanimUi.detail.keys.find((entry) => entry.frame === frame) : undefined
    const base = !!key?.base
    return new Menu([
        {
            name: "Base: each colorway's own colors",
            icon: base ? 'radio_button_checked' : 'radio_button_unchecked',
            description: 'Each colorway keeps its own colors at this keyframe, so a tint fades back to the right color in every colorway',
            click: () => setKeyBase(slotId, frame, true, spanAnimation()),
        },
        {
            name: 'Fixed colors: the main colors as shown',
            icon: base ? 'radio_button_unchecked' : 'radio_button_checked',
            description: 'Every colorway shows the same colors at this keyframe. Edit the keyframe to pick other colors',
            click: () => setKeyBase(slotId, frame, false, spanAnimation()),
        },
        { name: 'Edit keyframe...', icon: 'edit', click: () => editKeyAt(slotId, frame) },
        { name: 'Remove keyframe', icon: 'delete', condition: () => frame !== 0, click: () => dropKey(slotId, frame) },
    ] as any)
}

export function openKeyMenu(slotId: string, frame: number, event: Event) {
    if (!palanimUi.detail?.keys.some((entry) => entry.frame === frame)) return
    keyMenu(slotId, frame).open(event as MouseEvent)
}

function refreshFrame() {
    const plate = lastPlate
    if (!plate) return
    const loop = palanimUi.loop
    const colorway = shownColorway(plate)
    for (const row of palanimUi.rows) {
        const found = plate.palette.slots.find((entry) => entry.id === row.id)
        const slot = found ? scoped(found, lastSpan) : undefined
        if (slot) row.swatches = colorsAt(plate.palette, slot, slot.animation, palanimUi.frame, loop, colorway)
    }
    const detail = palanimUi.detail
    if (!detail) return
    for (const cell of detail.cells) cell.now = cell.frame === palanimUi.frame
    detail.hasKeyHere = detail.keys.some((key) => key.frame === palanimUi.frame)
}

function onResult(result: { frame: number }) {
    if (previewUi.variant !== lastVariant) refreshColorAnimation()
    const frame = wrapFrame(Math.floor(Number(result?.frame) || 0))
    if (frame === palanimUi.frame) return
    palanimUi.frame = frame
    try {
        refreshFrame()
    } catch (error) {
        console.error('[polyplus_nameplate] color animation frame refresh failed', error)
    }
}

export function registerColorAnimationPanel(): () => void {
    handles.style = injectStyle(STYLE_ID, STYLE)
    handles.removers.push(
        onNewPreviewProject(() => {
            palanimUi.selected = ''
        }),
        retainEvents(),
        onLight(refreshColorAnimation),
        onNameplateChanged(refreshColorAnimation),
        onPreviewResult(onResult as any),
        onFocusSlot(openSlotEffect),
    )
    refreshColorAnimation()
    return () => {
        disposeAll(handles.removers)
        handles.style?.()
        handles.style = null
        palanimUi.hasProject = false
        palanimUi.rows = []
        palanimUi.detail = null
        lastPlate = null
        lastSpan = null
    }
}
