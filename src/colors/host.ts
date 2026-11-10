import { createListenerSet } from '../util/events'

type Listener = () => void

export const stripParts: { host: HTMLElement | null, toolbar: Toolbar | null } = { host: null, toolbar: null }

const listeners = createListenerSet('color strip placement failed')

export function setStripHost(host: HTMLElement | null) {
    stripParts.host = host
    listeners.notify()
}

export function setStripToolbar(toolbar: Toolbar | null) {
    stripParts.toolbar = toolbar
    listeners.notify()
}

export function onStripParts(listener: Listener): () => void {
    return listeners.on(listener)
}
