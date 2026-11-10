import { defineAnimationProperties, readSettings } from './animate/props'
import { nameplateLimits } from './engine'
import { FORMAT_ID, LOOP_ANIMATION, NameplateData } from './model'
import { goMode } from './navigate'
import { animationFrames, findLoopAnimation } from './util/animation'
import { hasProject } from './util/project'
import { messageBox } from './util/dialogs'
import { createListenerSet } from './util/events'
import { disposeAll } from './util/teardown'
import { htmlList } from './util/text'
import { undoEdit } from './util/undo'

export const DEFAULT_FPS = 10
export const DEFAULT_LOOP_FRAMES = 20
const FALLBACK_MAX_LOOP_FRAMES = 120
const MIN_SNAPPING = 10
const MAX_SNAPPING = 500
const LOOP_DIALOG = 'polyplus_nameplate_loop'
const LOOP_COPY = /^loop\d+$/
const PROJECT_SAVES = ['save_project', 'save_project_as', 'save_project_incremental', 'export_legacy_project']

type Hook = () => void
type LoadRepair = () => string[]

const activationHooks = createListenerSet('format hook failed')
const deactivationHooks = createListenerSet('format hook failed')

const starterBuilders = createListenerSet('format hook failed')
const loadRepairs = new Set<LoadRepair>()

let startChoice: Hook | null = null
let format: ModelFormat | null = null
let properties: Property[] = []
let formatListeners: Deletable[] = []
let saveOverrides: Array<{ action: any, click: unknown }> = []
let loading = false

export function defaultNameplate(): NameplateData {
    return {
        id: 'new_nameplate',
        fps: DEFAULT_FPS,
        ownsBackground: true,
        referenceName: 'Steve',
        palette: {
            slots: [
                { id: 'fill', name: 'Fill', ramp: ['#232B3D', '#2F3A52', '#3E4C69'] },
                { id: 'border', name: 'Border', ramp: ['#6B7FA8', '#93A6CC', '#C3D0EA'] },
                { id: 'accent', name: 'Accent', ramp: ['#B0742E', '#D99A45', '#F2C46E'] },
            ],
            colorways: { default: {} },
        },
        variants: {
            default: { palette: 'default', hide: [], swap: {} },
        },
    }
}

export function maxLoopFrames(): number {
    const states = nameplateLimits().states
    return Number.isFinite(states) && states >= 1 ? states : FALLBACK_MAX_LOOP_FRAMES
}

function loopLimitText(max: number): string {
    return `A loop can be at most ${max} frames long.`
}

export function snappingFor(fps: number): number {
    const safe = Math.max(1, fps)
    return Math.min(MAX_SNAPPING, safe * Math.ceil(MIN_SNAPPING / safe))
}

export function currentFps(): number {
    const fps = Number(typeof Project !== 'undefined' && Project ? (Project as any).nameplate?.fps : 0)
    return isFinite(fps) && fps > 0 ? fps : DEFAULT_FPS
}

export function createNameplateAnimation(options: { name: string, frames: number, fps: number, loop: 'loop' | 'once' }): any {
    return new BBAnimation({
        name: options.name,
        loop: options.loop,
        length: options.frames / options.fps,
        snapping: snappingFor(options.fps),
        nameplate_fps: options.fps,
    } as AnimationOptions)
}

export function currentLoopFrames(): number {
    const loop = findLoopAnimation()
    const frames = loop ? Math.round(Number(loop.length) * currentFps()) : NaN
    return isFinite(frames) && frames >= 1 ? frames : DEFAULT_LOOP_FRAMES
}

export function frameDivisors(frames: number, max = frames): number[] {
    const result: number[] = []
    for (let count = 1; count <= Math.min(frames, max); count++) if (frames % count === 0) result.push(count)
    return result.length > 0 ? result : [1]
}

export function secondsText(frames: number, fps: number): string {
    return `${Math.round((frames / Math.max(1, fps)) * 100) / 100} s`
}

export function isNameplateActive(): boolean {
    return typeof Format !== 'undefined' && !!Format && Format.id === FORMAT_ID
}

export function onFormatActivation(hook: Hook): () => void {
    return activationHooks.on(hook)
}

export function onFormatDeactivation(hook: Hook): () => void {
    return deactivationHooks.on(hook)
}

function addTo<T>(set: Set<T>, item: T): () => void {
    set.add(item)
    return () => {
        set.delete(item)
    }
}

export function onNewNameplate(hook: Hook): () => void {
    return starterBuilders.on(hook)
}

export function onStartChoice(hook: Hook): () => void {
    startChoice = hook
    return () => {
        if (startChoice === hook) startChoice = null
    }
}

export function onProjectLoaded(repair: LoadRepair): () => void {
    return addTo(loadRepairs, repair)
}

export function ensureNameplateData(project: ModelProject | null | undefined) {
    if (!project) return
    const current = project.nameplate
    if (!current || typeof current !== 'object' || Array.isArray(current)) project.nameplate = defaultNameplate()
}

export function ensureLoopAnimation(select: boolean): BBAnimation | null {
    if (!hasProject()) return null
    const existing = findLoopAnimation()
    if (existing) return existing
    const fps: number = Project.nameplate?.fps || DEFAULT_FPS
    const animation = createNameplateAnimation({ name: LOOP_ANIMATION, frames: DEFAULT_LOOP_FRAMES, fps, loop: 'loop' })
    animation.add(false)
    if (select) animation.select()
    return animation
}

export function openLoopDialog(animation: BBAnimation): Dialog {
    const fps = currentFps()
    const max = maxLoopFrames()
    const frames = animationFrames(animation, fps)
    const shown = Math.min(max, frames)
    const dialog: Dialog = new Dialog({
        id: LOOP_DIALOG,
        title: 'Loop',
        width: 420,
        form: {
            tooLong: {
                type: 'info',
                text: `This loop is ${frames} frames long. ${loopLimitText(max)} Saving here shortens it to ${max} frames.`,
                condition: () => frames > max,
            },
            length: {
                label: 'Length (frames)',
                type: 'number',
                value: shown,
                min: 1,
                max,
                step: 1,
                force_step: true,
                description: `At ${fps} fps, ${fps} frames is 1 second. Sprite frame counts must divide it. ${loopLimitText(max)}`,
            },
            atLimit: {
                type: 'info',
                text: loopLimitText(max),
                condition: (form: { length?: number }) => frames <= max && Number(form.length) >= max,
            },
            duration: { label: 'Lasts', type: 'text', value: secondsText(shown, fps), readonly: true },
            fps: {
                label: 'Frames per second',
                type: 'text',
                value: String(fps),
                readonly: true,
                description: 'Set it in Nameplate Settings',
            },
        } as any,
        onFormChange(this: any, form: any) {
            const duration = secondsText(Math.min(max, Math.max(1, Math.round(Number(form.length) || 1))), fps)
            if (form.duration !== duration) this.setFormValues({ duration }, false)
        },
        onConfirm(form: any) {
            const length = Math.min(max, Math.max(1, Math.round(Number(form.length) || shown)))
            undoEdit({ animations: [animation] }, 'Edit loop', () => {
                if (typeof (animation as any).setLength === 'function') (animation as any).setLength(length / fps)
                else animation.length = length / fps
                animation.loop = 'loop'
                animation.snapping = snappingFor(fps)
                ;(animation as any).nameplate_fps = fps
                Blockbench.dispatchEvent('edit_animation_properties', { animation } as any)
            })
            if (typeof Animator.preview === 'function' && BBAnimation.selected === animation) Animator.preview()
        },
    } as any)
    dialog.show()
    return dialog
}

function saveNameplateProject(): boolean {
    if (!isNameplateActive()) return false
    const save = (BarItems as any).save_project
    if (!save || typeof save.click !== 'function') return false
    save.click()
    return true
}

function markPicturesSaved() {
    if (!isNameplateActive() || !Settings.get('embed_textures')) return
    for (const texture of Texture.all) texture.saved = true
}

function overrideClick(id: string, run: (original: () => unknown) => unknown) {
    const action = typeof BarItems === 'undefined' ? undefined : (BarItems as any)[id]
    if (!action || typeof action.click !== 'function') return
    const original = action.click
    saveOverrides.push({ action, click: original })
    action.click = function (this: unknown, ...args: unknown[]) {
        return run(() => original.apply(this, args))
    }
}

function overrideSave() {
    if (saveOverrides.length > 0) return
    overrideClick('export_over', (original) => (saveNameplateProject() ? undefined : original()))
    for (const id of PROJECT_SAVES) {
        overrideClick(id, (original) => {
            markPicturesSaved()
            return original()
        })
    }
}

function restoreSave() {
    for (const { action, click } of saveOverrides.splice(0)) action.click = click
}

function prepareNewProject() {
    ensureNameplateData(Project)
    Project.name = Project.nameplate?.id ?? ''
    ensureLoopAnimation(true)
    starterBuilders.notify()
}

export function newBlankNameplate(): boolean {
    const target = Formats[FORMAT_ID]
    if (!target || !newProject(target)) return false
    prepareNewProject()
    return true
}

function hasKeys(animation: BBAnimation): boolean {
    return Object.values<any>(animation.animators ?? {}).some((animator) => Array.isArray(animator?.keyframes) && animator.keyframes.length > 0)
}

function repairSplitLoop(): string[] {
    const loop = findLoopAnimation()
    if (!loop || hasKeys(loop)) return []
    const copies = Animator.animations.filter((animation) => LOOP_COPY.test(animation.name) && !readSettings(animation).plays)
    if (copies.length === 0) return []
    const keyed = copies.filter(hasKeys)
    if (keyed.length > 1) {
        return [`'loop' is empty, and ${keyed.map((animation) => `'${animation.name}'`).join(' and ')} have keyframes. Delete the empty 'loop' and the copies you don't want, then rename the one you keep to 'loop'.`]
    }
    const kept = keyed[0] ?? copies[copies.length - 1]
    const name = kept.name
    for (const animation of [loop, ...copies]) if (animation !== kept) animation.remove(false)
    kept.name = LOOP_ANIMATION
    kept.loop = 'loop'
    return [keyed.length > 0
        ? `'${name}' is the loop again. The empty copy is gone.`
        : 'The project held empty copies of the loop animation. They were removed.']
}

function finishLoad() {
    ensureNameplateData(Project)
    const notes = repairSplitLoop()
    ensureLoopAnimation(false)
    for (const repair of Array.from(loadRepairs)) {
        try {
            notes.push(...repair())
        } catch (error) {
            console.error('[polyplus_nameplate] project repair failed', error)
        }
    }
    if (notes.length === 0) return
    messageBox({
        title: 'Project Repaired',
        icon: 'build',
        message: `This project needed repairs when it opened:${htmlList(notes)}Save the project to keep them.`,
        buttons: ['OK'],
        width: 560,
    })
}

export function registerFormat() {
    if (format) return

    properties = [
        new Property(ModelProject, 'object', 'nameplate', {
            exposed: false,
            default: () => defaultNameplate(),
        }),
        new Property(BBAnimation, 'number', 'nameplate_fps', {
            default: DEFAULT_FPS,
        }),
        ...defineAnimationProperties(),
    ]

    format = new ModelFormat(FORMAT_ID, {
        name: 'PolyPlus Nameplate',
        description:
            'Design an animated nameplate for PolyPlus: a colored body, small pixel sprites and a looping animation. No 3D modeling needed.',
        icon: 'badge',
        category: 'other',
        target: 'PolyPlus',
        show_on_start_screen: true,
        show_in_new_list: true,
        format_page: {
            button_text: 'Create nameplate',
            content: [
                { type: 'h3', text: 'PolyPlus Nameplate' },
                {
                    text: 'Start blank or from a sample. Paint your sprites, pick your colors, add a keyframe or two, then export the zip.',
                },
            ],
        },
        animation_mode: true,
        molang: true,
        edit_mode: false,
        paint_mode: true,
        box_uv: false,
        bone_rig: true,
        centered_grid: true,
        single_texture: true,
        animated_textures: true,
        per_texture_uv_size: true,
        model_identifier: false,
        can_convert_to: false,
        new() {
            if (!startChoice) return newBlankNameplate()
            startChoice()
            return true
        },
        onSetup(project) {
            ensureNameplateData(project)
            goMode('design')
        },
        onActivation() {
            activationHooks.notify()
        },
        onDeactivation() {
            deactivationHooks.notify()
        },
    })

    formatListeners = [
        Blockbench.on('load_project', () => {
            if (!isNameplateActive()) return
            loading = true
            goMode('design')
        }),
        Codecs.project.on('parsed', () => {
            if (!loading) return
            loading = false
            finishLoad()
        }),
    ]
    overrideSave()
}

export function unregisterFormat() {
    restoreSave()
    disposeAll(formatListeners)
    starterBuilders.clear()
    loadRepairs.clear()
    activationHooks.clear()
    deactivationHooks.clear()
    startChoice = null
    loading = false
    if (format) {
        format.delete()
        format = null
    }
    disposeAll(properties)
}

export function newNameplateProject(): boolean {
    const target = Formats[FORMAT_ID]
    return !!target && target.new()
}
