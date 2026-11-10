import { frameCountOf } from '../palette/sprites'
import { onNameplateChanged } from '../palette/state'
import { pictureChanged } from '../pictures/strip'
import { adoptChangedPicture } from '../sprite'
import { createListenerSet } from '../util/events'
import { disposeAll } from '../util/teardown'

const HEAVY_DELAY_MS = 120
const EVENTS = [
    'select_project',
    'unselect_project',
    'new_project',
    'setup_project',
    'load_project',
    'add_texture',
    'select_texture',
    'update_texture_selection',
    'update_selection',
    'select_animation',
    'select_mode',
    'finished_edit',
    'undo',
    'redo',
] as const

const TEXTURE_EVENTS = ['add_texture', 'finished_edit', 'undo', 'redo'] as const

type Listener = () => void

const light = createListenerSet('refresh listener failed')
const heavy = createListenerSet('refresh listener failed')

let holders = 0
let pictureEpoch = 0
let subscriptions: Deletable[] = []
let removeChange: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null

export function refreshLight() {
    light.notify()
}

function scheduleHeavy() {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
        timer = null
        heavy.notify()
    }, HEAVY_DELAY_MS)
}

function onEvent() {
    light.notify()
    scheduleHeavy()
}

export function onLight(listener: Listener): () => void {
    return light.on(listener)
}

export function onHeavy(listener: Listener): () => void {
    return heavy.on(listener)
}

function onPictureChange(event: any) {
    const texture = event?.texture
    if (!texture) return
    const before = { width: texture.width, height: texture.height, frames: frameCountOf(texture) }
    texture.load_callback = () => {
        texture.load_callback = null
        pictureEpoch++
        adoptChangedPicture(texture, before)
        Blockbench.dispatchEvent('update_selection', {} as any)
        pictureChanged(texture, before)
    }
}

export function pictureVersion(): number {
    return pictureEpoch
}

function start() {
    subscriptions = TEXTURE_EVENTS.map((name) => Blockbench.on(name, () => {
        pictureEpoch++
    }))
    subscriptions.push(...EVENTS.map((name) => Blockbench.on(name, onEvent)))
    subscriptions.push(Blockbench.on('change_texture_path' as any, onPictureChange))
    removeChange = onNameplateChanged(onEvent)
}

function stop() {
    disposeAll(subscriptions)
    removeChange?.()
    removeChange = null
    if (timer !== null) {
        clearTimeout(timer)
        timer = null
    }
}

export function retainEvents(): () => void {
    holders++
    if (holders === 1) start()
    let released = false
    return () => {
        if (released) return
        released = true
        holders--
        if (holders === 0) stop()
    }
}
