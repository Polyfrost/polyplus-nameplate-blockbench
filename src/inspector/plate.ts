import { numberLabel, openSettingsDialog, openVariantDialog, removeVariant } from '../design/nameplate'
import { currentFps, currentLoopFrames, ensureLoopAnimation, openLoopDialog, secondsText } from '../format'
import { NameplateData, PER_PLAYER_PHASE } from '../model'
import { openParamsDialog } from '../params/dialog'
import { projectParamValues } from '../params/store'
import { readNameplate } from '../palette/state'
import { goMode } from '../navigate'
import { previewUi, redraw } from '../preview'
import { element } from '../util/dom'
import { round3Text } from '../util/num'
import { sectionElement } from './sections'

function button(parent: HTMLElement, icon: string, label: string, title: string, click: () => void): HTMLButtonElement {
    const node = element('button', '', parent)
    node.type = 'button'
    node.title = title
    element('i', 'material-icons notranslate icon', node, icon)
    node.appendChild(document.createTextNode(` ${label}`))
    node.addEventListener('click', click)
    return node
}

function iconButton(parent: HTMLElement, icon: string, title: string, click: () => void): HTMLElement {
    const node = element('i', 'material-icons notranslate icon np-icon-button', parent, icon)
    node.title = title
    node.addEventListener('click', (event) => {
        event.stopPropagation()
        click()
    })
    return node
}

function fact(parent: HTMLElement, label: string, value: string, title?: string) {
    const row = element('div', 'np-fact', parent)
    if (title) row.title = title
    element('span', 'np-subtle', row, label)
    element('span', '', row, value)
}

function backgroundFact(plate: NameplateData): string {
    const own = Object.entries(plate.variants)
        .filter(([, variant]) => variant.ownsBackground !== undefined && variant.ownsBackground !== plate.ownsBackground)
        .map(([key, variant]) => `${key}: ${variant.ownsBackground ? 'draws its own' : 'keeps the game background'}`)
    const base = plate.ownsBackground ? 'Draws its own' : 'Keeps the game background'
    return own.length > 0 ? `${base} (${own.join(', ')})` : base
}

function numberFact(plate: NameplateData, name: string, value: number): string {
    const own = Object.entries(plate.variants)
        .filter(([, variant]) => variant.params?.[name] !== undefined)
        .map(([key, variant]) => `${key}: ${round3Text(variant.params![name])}`)
    return own.length > 0 ? `${round3Text(value)} (${own.join(', ')})` : round3Text(value)
}

function settingsSection(parent: HTMLElement) {
    const plate = readNameplate()
    const view = sectionElement('plate.settings', 'Nameplate')
    const body = element('div', 'np-section-pad', view.extra)
    const fps = currentFps()
    const frames = currentLoopFrames()
    fact(body, 'Speed', `${fps} frames per second`)
    fact(body, 'Loop', `${frames} frames, ${secondsText(frames, fps)}`)
    fact(body, 'Each player', plate.phase === PER_PLAYER_PHASE ? 'Starts at their own point of the loop' : 'Moves in step with everyone')
    fact(body, 'Background', backgroundFact(plate))
    fact(body, 'Example name', plate.referenceName)
    const actions = element('div', 'np-empty-actions', body)
    button(actions, 'settings', 'Settings...', 'ID, example name, speed, background and per-player start', () => openSettingsDialog())
    button(actions, 'loop', 'Loop length...', 'How many frames the loop animation lasts', () => {
        const loop = ensureLoopAnimation(false)
        if (loop) openLoopDialog(loop)
    })
    parent.appendChild(view.node)
}

function showVariant(key: string) {
    previewUi.variant = key
    redraw(false)
}

function variantsSection(parent: HTMLElement) {
    const plate = readNameplate()
    const view = sectionElement('plate.variants', 'Variants')
    const list = element('ul', 'np-inspector-list', view.extra)
    const keys = Object.keys(plate.variants)
    for (const key of keys) {
        const variant = plate.variants[key]
        const row = element('li', previewUi.variant === key ? 'selected' : '', list)
        row.title = 'Click to show this variant on the preview'
        row.addEventListener('click', () => {
            showVariant(key)
            for (const other of Array.from(list.children)) other.classList.toggle('selected', other === row)
        })
        row.addEventListener('dblclick', () => openVariantDialog(key))
        const text = element('div', 'np-inspector-text', row)
        element('span', '', text, key)
        element('span', 'np-subtle', text, `Colorway ${variant.palette}${variant.hide.length ? `, hides ${variant.hide.length}` : ''}`)
        const tools = element('div', 'np-library-tools', row)
        iconButton(tools, 'edit', 'Edit this variant', () => openVariantDialog(key))
        if (keys.length > 1) iconButton(tools, 'delete', 'Remove this variant', () => removeVariant(key))
    }
    const actions = element('div', 'np-empty-actions np-section-pad', view.extra)
    button(actions, 'add', 'New variant...', 'Add a variant with its own colorway, hidden layers and text', () => openVariantDialog(null))
    parent.appendChild(view.node)
}

function numbersSection(parent: HTMLElement) {
    const view = sectionElement('plate.numbers', 'Shared numbers')
    const body = element('div', 'np-section-pad', view.extra)
    const params = Object.entries(projectParamValues())
    const plate = readNameplate()
    if (!params.length) element('p', 'np-subtle np-flush', body, 'No shared numbers yet.')
    for (const [name, value] of params) fact(body, numberLabel(name), numberFact(plate, name, value), `ID: ${name}`)
    const actions = element('div', 'np-empty-actions', body)
    button(actions, 'tune', 'Edit shared numbers...', 'Add, rename or change the numbers effects and formulas share', () => openParamsDialog())
    parent.appendChild(view.node)
}

function plateRowIntro(parent: HTMLElement) {
    const intro = element('div', 'np-panel-empty', parent)
    element('p', 'np-flush', intro, 'Moves the whole nameplate as one piece. Extra lines of text stay still.')
    element('p', 'np-flush', intro, 'Add Position keyframes to it in Animate, for example a shake on a reaction.')
    if (Modes.animate) return
    const actions = element('div', 'np-empty-actions', intro)
    button(actions, 'movie', 'Go to Animate', 'Switch to Animate with this row selected', () => goMode('animate'))
}

export function buildPlateView(parent: HTMLElement, plateRow: boolean) {
    if (plateRow) {
        plateRowIntro(parent)
    } else {
        const intro = element('div', 'np-panel-empty', parent)
        element('p', 'np-flush', intro, 'Click a layer in Layers or on the preview.')
    }
    settingsSection(parent)
    variantsSection(parent)
    numbersSection(parent)
}
