import { currentFps, isNameplateActive, openLoopDialog } from '../format'
import { LOOP_ANIMATION } from '../model'
import { onPreviewResult, previewUi } from '../preview'
import { openAnimationDialog } from './dialog'
import { patchTimelineFrames } from './frames'
import { refreshEventMarkers, updateEventMarkers } from './markers'
import { disposeAll } from '../util/teardown'
import { suggestedId } from './props'
import { undoEdit } from '../util/undo'

function renameNameplateAnimation(animation: any) {
    Blockbench.textPrompt('generic.rename', animation.name, (text: string) => {
        const typed = String(text ?? '').trim()
        if (!typed) return
        const name = suggestedId(typed)
        if (name === animation.name) return
        undoEdit({ animations: [animation] }, 'Rename animation', () => {
            animation.name = name
            if (typeof animation.createUniqueName === 'function') animation.createUniqueName()
        })
    }, { description: 'Use lowercase letters, digits and _. Anything else becomes _.' })
    return animation
}

function selectedAnimatorNode(): any | null {
    const selected: any[] = (typeof Outliner !== 'undefined' && Outliner ? (Outliner.selected as any[]) : null) ?? []
    for (const node of selected) if (node && (node.constructor as any)?.animator) return node
    return typeof Group !== 'undefined' ? (Group as any).first_selected ?? null : null
}

function showSelectedInTimeline() {
    if (!isNameplateActive() || typeof Modes === 'undefined' || !Modes.animate) return
    const animation = BBAnimation.selected as any
    if (!animation) return
    const node = selectedAnimatorNode()
    if (node) {
        animation.getBoneAnimator(node)?.select?.(true)
        return
    }
    for (const key in animation.animators ?? {}) animation.animators[key].selected = false
    ;(Timeline as any).selected_animator = null
}

function deferred(run: () => void): { queue: () => void, cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | null = null
    const cancel = () => {
        if (timer) clearTimeout(timer)
        timer = null
    }
    return {
        queue() {
            cancel()
            timer = setTimeout(() => {
                timer = null
                run()
            }, 0)
        },
        cancel,
    }
}

function refreshScheduleView() {
    if (!isNameplateActive() || typeof Modes === 'undefined' || !Modes.animate) return
    try {
        refreshEventMarkers(BBAnimation.selected, currentFps())
    } catch (error) {
        console.error('[polyplus_nameplate] could not fit the timeline to the schedule', error)
    }
}

const scheduleView = deferred(refreshScheduleView)
const timelineSelection = deferred(() => {
    try {
        showSelectedInTimeline()
    } catch (error) {
        console.error('[polyplus_nameplate] could not show the selected layer in the timeline', error)
    }
    refreshScheduleView()
})

function whenActive(original: (...args: unknown[]) => unknown, failure: string, handler: (self: any, ...args: unknown[]) => unknown) {
    return function (this: any, ...args: unknown[]) {
        if (isNameplateActive()) {
            try {
                return handler(this, ...args)
            } catch (error) {
                console.error(`[polyplus_nameplate] ${failure}`, error)
            }
        }
        return original.apply(this, args)
    }
}

const OWN_MENU_PREFIX = 'polyplus_nameplate'
const HIDDEN_KEY_ITEMS = new Set(['resolve_keyframe_expressions', 'round_keyframe_values', 'save_animation_preset'])
const MARKER_COLOR_ITEM = 'menu.cube.color'

function menuItemId(item: any): string {
    return typeof item === 'string' ? item : String(item?.id ?? '')
}

function isOwnMenuItem(item: any): boolean {
    return menuItemId(item).startsWith(OWN_MENU_PREFIX)
}

function isHiddenKeyItem(item: any): boolean {
    return HIDDEN_KEY_ITEMS.has(menuItemId(item)) || (typeof item === 'object' && item?.name === MARKER_COLOR_ITEM)
}

function patchKeyMenu(): () => void {
    const menu = (globalThis as any).Keyframe?.prototype?.menu
    if (!menu || typeof menu.open !== 'function') return () => {}
    const hadOwn = Object.prototype.hasOwnProperty.call(menu, 'open')
    const original = menu.open
    const patched = function (this: any, ...args: unknown[]) {
        const structure = this.structure
        if (!isNameplateActive() || !Array.isArray(structure)) return original.apply(this, args)
        this.structure = [...structure.filter(isOwnMenuItem), ...structure.filter((item: any) => !isOwnMenuItem(item) && !isHiddenKeyItem(item))]
        try {
            return original.apply(this, args)
        } finally {
            this.structure = structure
        }
    }
    menu.open = patched
    return () => {
        if (menu.open !== patched) return
        if (hadOwn) menu.open = original
        else delete menu.open
    }
}

const UNSUPPORTED_TOOLS = ['rotate_tool', 'resize_tool']
const UNSUPPORTED_CHANNELS = new Set(['rotation', 'scale'])
const UNSUPPORTED_MESSAGE = "Layers can't be rotated or scaled. To turn or resize something, paint each step as a sprite frame and show it with Frame keyframes."

function patchUnsupportedTools(): () => void {
    const restores: Array<() => void> = []
    for (const id of UNSUPPORTED_TOOLS) {
        const tool = typeof BarItems === 'undefined' ? undefined : (BarItems as any)[id]
        if (!tool || typeof tool.select !== 'function') continue
        const original = tool.select
        const patched = function (this: any, ...args: unknown[]) {
            if (!isNameplateActive()) return original.apply(this, args)
            ;(BarItems as any).move_tool?.select?.()
            Blockbench.showQuickMessage(UNSUPPORTED_MESSAGE, 4000)
            return this
        }
        tool.select = patched
        restores.push(() => {
            if (tool.select === patched) tool.select = original
        })
    }
    return () => {
        disposeAll(restores)
    }
}

function patchChannelFilter(): () => void {
    const action = typeof BarItems === 'undefined' ? undefined : (BarItems as any).timeline_focus
    if (!action || typeof action.children !== 'function') return () => {}
    const original = action.children
    const patched = function (this: unknown, ...args: unknown[]) {
        const items: any[] = original.apply(this, args)
        return isNameplateActive() ? items.filter((item) => !UNSUPPORTED_CHANNELS.has(item?.id)) : items
    }
    action.children = patched
    return () => {
        if (action.children === patched) action.children = original
    }
}

function addNameplateAnimation() {
    const animation = new BBAnimation({ name: 'animation', saved: false } as any)
    openAnimationDialog(animation)
}

function patchAddAction(): () => void {
    const action = typeof BarItems === 'undefined' ? undefined : (BarItems as any).add_animation
    if (!action || typeof action.click !== 'function') return () => {}
    const original = action.click
    const patched = whenActive(original, 'new animation failed', addNameplateAnimation)
    action.click = patched
    return () => {
        if (action.click === patched) action.click = original
    }
}

export function registerAnimate(): () => void {
    const prototype = (BBAnimation as any).prototype
    const originalRename = prototype.rename
    const patchedRename = whenActive(originalRename, 'animation rename failed', renameNameplateAnimation)
    prototype.rename = patchedRename
    const original = prototype.propertiesDialog
    const patched = whenActive(original, 'animation dialog failed', (animation) =>
        animation?.name === LOOP_ANIMATION ? openLoopDialog(animation) : openAnimationDialog(animation),
    )
    prototype.propertiesDialog = patched
    const restoreAdd = patchAddAction()
    const restoreKeyMenu = patchKeyMenu()
    const restoreTools = patchUnsupportedTools()
    const restoreFilter = patchChannelFilter()
    const restoreFrames = patchTimelineFrames()
    const modeListener = Blockbench.on('select_mode', timelineSelection.queue)
    const animationListener = Blockbench.on('select_animation', scheduleView.queue)
    const stopMarkers = onPreviewResult((result) => {
        if (!isNameplateActive()) return
        try {
            updateEventMarkers(previewUi.seed, result.files, BBAnimation.selected, currentFps())
        } catch (error) {
            console.error('[polyplus_nameplate] could not place schedule markers', error)
        }
    })
    return () => {
        restoreAdd()
        restoreKeyMenu()
        restoreTools()
        restoreFilter()
        restoreFrames()
        modeListener.delete()
        animationListener.delete()
        scheduleView.cancel()
        timelineSelection.cancel()
        stopMarkers()
        if (prototype.propertiesDialog === patched) prototype.propertiesDialog = original
        if (prototype.rename === patchedRename) prototype.rename = originalRename
    }
}
