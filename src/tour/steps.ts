import { setStripFolded } from '../colors/strip'
import { layerNodes, nameTextNode, primarySelectedNode } from '../elements/nodes'
import { isNameplateActive, newBlankNameplate } from '../format'
import { selectInspectorTarget } from '../inspector/selection'
import { showChecks } from '../leftside/checks'
import { BODY_TYPE, FORMAT_ID, SPRITE_TYPE } from '../model'
import { goMode, showLayer, textureOf } from '../navigate'
import { plateNode } from '../plate'
import { lastResult, lineChoice } from '../preview'
import { currentPreset } from '../preview/menu'
import { TourChapter, TourPlacement } from './types'
import { PICTURES_PANEL } from '../pictures/panel'
import { readTexturePixels } from '../util/texture'

const INSPECTOR = 'polyplus_nameplate_inspector'
const CHECKS = 'polyplus_nameplate_checks'
const TRY_IT = 'polyplus_nameplate_try'
const VIEWPORT = '#polyplus_nameplate_viewport'
const FILL_SLOT = 'fill'
const ORNAMENT = 'ornament'
const FALLBACK_ACCENT = '#3e90ff'
const MARK_STYLE = 'position: fixed; pointer-events: none; z-index: 0;'

const baseline = { colors: '', pixels: '', picture: '' }

const marks: { ornament: HTMLElement | null } = { ornament: null }

export const FIRST_TOUR = ['around', 'yours', 'send']

function safely<T>(read: () => T, fallback: T): T {
    try {
        return read()
    } catch {
        return fallback
    }
}

function shown(node: Element | null | undefined): Element | null {
    if (!node || !node.isConnected) return null
    const box = node.getBoundingClientRect()
    return box.width > 0 && box.height > 0 ? node : null
}

function panel(id: string): Element | null {
    return shown(typeof Panels === 'undefined' ? null : Panels[id]?.node)
}

function barItem(id: string): Element | null {
    return shown(typeof BarItems === 'undefined' ? null : (BarItems as any)[id]?.node)
}

function barItemIn(id: string, panelId: string): Element | null {
    const item = typeof BarItems === 'undefined' ? null : (BarItems as any)[id]
    const holder = typeof Panels === 'undefined' ? null : Panels[panelId]?.node
    if (item && holder) {
        const nodes: Element[] = [item.node, ...(Array.isArray(item.nodes) ? item.nodes : [])]
        const inside = nodes.find((node) => holder.contains(node) && shown(node))
        if (inside) return inside
    }
    return barItem(id)
}

function fileMenu(): Element | null {
    return shown((MenuBar as any).menus?.file?.label ?? null)
}

function inViewport(selector: string): Element | null {
    return shown(document.querySelector(`${VIEWPORT} ${selector}`))
}

function layerRow(node: any): Element | null {
    const uuid = node?.uuid
    if (typeof uuid !== 'string' || !/^[\w-]+$/.test(uuid)) return null
    return shown(document.querySelector(`#panel_outliner li[id="${uuid}"] > .outliner_object`))
}

function modeTab(id: string): Element | null {
    const name = Modes.options[id]?.name
    if (!name) return null
    const label = (tab: Element) => Array.from(tab.childNodes).filter((part) => part.nodeType === Node.TEXT_NODE).map((part) => part.textContent ?? '').join('').trim()
    const tabs = Array.from(document.querySelectorAll('#mode_selector li'))
    return shown(tabs.find((tab) => label(tab) === name))
}

function lettersField(): Element | null {
    return shown(document.querySelector(`#panel_${INSPECTOR} .form_bar_ts_mode`))
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function revealLetters() {
    for (let tries = 0; tries < 10 && !lettersField(); tries++) await wait(50)
    const field = lettersField() as HTMLElement | null
    const scroller = field?.closest('.np-scroll') as HTMLElement | null
    if (!field || !scroller) return
    const top = field.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 3)
}

function firstOf(type: string): any | null {
    return layerNodes().find((node) => node.type === type) ?? null
}

function firstSprite(): any | null {
    return layerNodes().find((node) => node.type === SPRITE_TYPE && !!textureOf(node)) ?? null
}

function ornament(): any | null {
    return safely(() => layerNodes().find((node) => node.type === SPRITE_TYPE && node.name === ORNAMENT && !!textureOf(node)) ?? null, null)
}

function hasOrnament(): boolean {
    return !!ornament()
}

function accentColor(): [number, number, number] | null {
    return safely(() => {
        const probe = document.createElement('canvas')
        probe.width = 1
        probe.height = 1
        const context = probe.getContext('2d')
        if (!context) return null
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim()
        context.fillStyle = FALLBACK_ACCENT
        context.fillStyle = accent || FALLBACK_ACCENT
        context.fillRect(0, 0, 1, 1)
        const pixel = context.getImageData(0, 0, 1, 1).data
        return [pixel[0], pixel[1], pixel[2]] as [number, number, number]
    }, null)
}

function outlineOn(canvas: HTMLCanvasElement, columns: number, rows: number): { x: number, y: number, width: number, height: number } | null {
    const accent = accentColor()
    const context = canvas.getContext('2d')
    const width = canvas.width
    const height = canvas.height
    if (!accent || !context || columns < 1 || rows < 1 || width < 2 || height < 2) return null
    const data = context.getImageData(0, 0, width, height).data
    const lit = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return false
        const at = (y * width + x) * 4
        return data[at] === accent[0] && data[at + 1] === accent[1] && data[at + 2] === accent[2] && data[at + 3] === 255
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!lit(x, y) || lit(x - 1, y) || lit(x, y - 1) || !lit(x + 1, y) || !lit(x, y + 1)) continue
            for (let scale = 1; x + columns * scale <= width && y + rows * scale <= height; scale++) {
                const right = x + columns * scale - 1
                const bottom = y + rows * scale - 1
                if (right - x < 2 || bottom - y < 2) continue
                if (lit(right, y) && lit(x, bottom) && lit(right, bottom) && lit(right, y + 1) && lit(x + 1, bottom)) {
                    return { x, y, width: columns * scale, height: rows * scale }
                }
            }
        }
    }
    return null
}

export function clearTourMarks() {
    marks.ornament?.remove()
    marks.ornament = null
}

function ornamentInPreview(): Element | null {
    const node = ornament()
    const found = node && node.selected ? safely(() => {
        const canvas = document.querySelector(`${VIEWPORT} canvas.np-stage-canvas`) as HTMLCanvasElement | null
        const result = lastResult()
        const entry = result?.layers.find((layer) => result.order[layer.index] === node.uuid)
        if (!canvas || !shown(canvas) || !entry) return null
        const box = outlineOn(canvas, entry.rasterWidth, entry.rasterHeight)
        if (!box) return null
        const rect = canvas.getBoundingClientRect()
        const across = rect.width / canvas.width
        const down = rect.height / canvas.height
        return { left: rect.left + box.x * across, top: rect.top + box.y * down, width: box.width * across, height: box.height * down }
    }, null) : null
    if (!found) {
        clearTourMarks()
        return null
    }
    let mark = marks.ornament
    if (!mark || !mark.isConnected) {
        mark = document.createElement('div')
        mark.setAttribute('style', MARK_STYLE)
        document.body.appendChild(mark)
        marks.ornament = mark
    }
    mark.style.left = `${Math.round(found.left)}px`
    mark.style.top = `${Math.round(found.top)}px`
    mark.style.width = `${Math.round(found.width)}px`
    mark.style.height = `${Math.round(found.height)}px`
    return mark
}

function nameplateProject(): ModelProject | undefined {
    if (typeof ModelProject === 'undefined') return undefined
    return ModelProject.all.find((project) => project.format?.id === FORMAT_ID)
}

function ensureNameplate() {
    if (isNameplateActive()) return
    const open = nameplateProject()
    if (open) open.select()
    else newBlankNameplate()
}

function ready(mode: 'design' | 'animate') {
    try {
        ensureNameplate()
        if (isNameplateActive()) goMode(mode)
    } catch (error) {
        console.error('[polyplus_nameplate] tour could not set up this step', error)
    }
}

function select(node: any | null) {
    if (node && primarySelectedNode() !== node) showLayer(node)
}

function colorsText(): string {
    return safely(() => JSON.stringify((Project as any)?.nameplate?.palette ?? null), '')
}

function fillRow(): Element | null {
    return inViewport(`.np-strip-row[data-slot="${FILL_SLOT}"]`) ?? inViewport('.np-strip-row') ?? inViewport('.np-strip-host')
}

function selectedPicture(): Texture | undefined {
    return safely(() => textureOf(primarySelectedNode()), undefined)
}

function pixelsOf(texture: Texture | undefined): string {
    return safely(() => {
        const pixels = readTexturePixels(texture)
        if (!pixels) return ''
        const { width, height, data } = pixels
        let hash = 0
        for (let at = 0; at < data.length; at++) hash = (Math.imul(hash, 31) + data[at]) | 0
        return `${width}x${height}:${hash}`
    }, '')
}

function rememberPixels() {
    const texture = selectedPicture()
    baseline.picture = texture?.uuid ?? ''
    baseline.pixels = pixelsOf(texture)
}

function hasReaction(): boolean {
    return Animator.animations.some((animation: any) => animation.nameplate_plays === 'reaction')
}

export const TOUR_CHAPTERS: TourChapter[] = [
    {
        id: 'around',
        title: 'Getting around',
        steps: [
            {
                id: 'start',
                title: 'Your first nameplate',
                get body() {
                    return hasOrnament()
                        ? 'This is your new nameplate, drawn the way it looks above a player in the game. It has a body, the name and a small ornament. Drag things here to move them, scroll to zoom, and press Ctrl+Z to undo.'
                        : 'This is your nameplate, drawn the way it looks above a player in the game. Drag things here to move them, scroll to zoom, and press Ctrl+Z to undo.'
                },
                target: () => inViewport('.np-stage-canvas') ?? inViewport('.np-stage-area'),
                placement: 'bottom',
            },
            {
                id: 'long-name',
                title: 'Long names',
                body: 'Player names can be up to 16 letters long, and the body stretches to fit. Whenever you move or add something, look at it on a long name too.',
                target: () => barItem('polyplus_nameplate_preview_options'),
                placement: 'left',
                task: 'Open Preview Options (the sliders icon) and click Long name',
                done: () => currentPreset() === 'long',
                doneText: 'The preview now shows a 16-letter name.',
            },
            {
                id: 'lines',
                title: 'Extra lines',
                body: 'Some servers put a rank or team line above or below the name. The list that says One line shows the nameplate with those extra lines.',
                target: () => barItem('polyplus_nameplate_lines'),
                placement: 'left',
                task: 'Pick a two-line option in the list that says One line',
                done: () => lineChoice() !== '1',
                doneText: 'Now there are two lines of text.',
            },
            {
                id: 'layers',
                title: 'Layers',
                body: 'Each row is one part of the nameplate. Name text, PolyPlus badge and Whole nameplate are always there, and everything you add shows up here too.',
                target: () => panel('outliner'),
                placement: 'left',
            },
            {
                id: 'ornament',
                get title() {
                    return hasOrnament() ? 'The ornament' : 'Sprites'
                },
                get body() {
                    return hasOrnament()
                        ? 'The ornament next to the name is an example sprite. A sprite is a small picture you paint and place on the nameplate. Keep this one, repaint it or delete it.'
                        : 'A sprite is a small picture you paint and place on the nameplate. Each sprite has a row in Layers, and selecting it opens its picture in Paint.'
                },
                before: () => select(ornament()),
                target: () => ornamentInPreview() ?? layerRow(ornament()) ?? panel('outliner'),
                get placement(): TourPlacement {
                    return marks.ornament ? 'left' : 'bottom'
                },
            },
            {
                id: 'pictures',
                title: 'Pictures',
                body: 'Pictures lists every picture in your nameplate and which layer uses it. Click one to paint it, or delete the ones no layer uses.',
                before: () => (Panels[PICTURES_PANEL] as any)?.fold?.(false),
                target: () => panel(PICTURES_PANEL),
                placement: 'right',
            },
            {
                id: 'inspector',
                title: 'Inspector',
                body: 'The Inspector holds the options of whatever you select in Layers. With nothing selected, it shows settings for the whole nameplate.',
                target: () => panel(INSPECTOR),
                placement: 'left',
            },
            {
                id: 'colors',
                title: 'Colors',
                body: 'Everything on the nameplate is drawn with these colors. Each color has a few shades, and when you change a shade, everything that uses it changes too.',
                before: () => setStripFolded(false),
                target: () => inViewport('.np-strip-host'),
                placement: 'left',
            },
            {
                id: 'checks',
                title: 'Checks',
                body: 'Checks looks for problems while you work. Click one to jump to the layer it\'s about, and if it has a button, that button fixes it.\nCost, further down, shows how close you are to the limits. Yellow is a heads-up and you can still export. Red blocks the export.',
                target: () => panel(CHECKS),
                placement: 'right',
            },
        ],
    },
    {
        id: 'yours',
        title: 'Make it yours',
        steps: [
            {
                id: 'select-body',
                title: 'Select the body',
                body: 'The body is the shape behind the name. Select it to see what you can change about it.',
                target: () => layerRow(firstOf(BODY_TYPE)) ?? panel('outliner'),
                placement: 'left',
                task: 'Click body in Layers',
                done: () => primarySelectedNode()?.type === BODY_TYPE,
                doneText: 'The body is selected.',
            },
            {
                id: 'body-options',
                title: 'Body options',
                body: 'The body starts out drawn from colors, not a picture, so you change it here. Shape and corners sets its size and corners. Fill and Outlines, further down, pick its colors.\nFor texture, Body picture at the bottom lets you paint the whole body as one picture. An Effect can also lay a pattern over it.',
                before: () => {
                    if (primarySelectedNode()?.type !== BODY_TYPE) select(firstOf(BODY_TYPE))
                },
                target: () => panel(INSPECTOR),
                placement: 'left',
            },
            {
                id: 'body-color',
                title: 'Recolor it',
                body: 'Shades with a small dot are in use. Double-click one under Fill, pick a new color and confirm. The body changes with it.',
                before: () => {
                    setStripFolded(false)
                    baseline.colors = colorsText()
                },
                target: () => fillRow(),
                placement: 'left',
                task: 'Change one shade under Fill',
                done: () => {
                    const now = colorsText()
                    if (!baseline.colors) baseline.colors = now
                    return !!now && now !== baseline.colors
                },
                doneText: 'New color saved.',
            },
            {
                id: 'paint',
                title: 'Paint a sprite',
                body: 'Select a sprite and its picture opens in Paint. With the brush tool on, click a shade in Colors to paint with it, then draw. A double-click opens the shade to change its color instead. Pictures can only use the shades in Colors.',
                before: () => {
                    if (!selectedPicture()) select(ornament() ?? firstSprite())
                    rememberPixels()
                },
                target: () => panel('uv'),
                placement: 'right',
                get task() {
                    return hasOrnament() ? 'Paint a few pixels on the ornament' : 'Paint a few pixels on a sprite'
                },
                done: () => {
                    const texture = selectedPicture()
                    if (!texture) return false
                    if (texture.uuid !== baseline.picture) {
                        baseline.picture = texture.uuid
                        baseline.pixels = pixelsOf(texture)
                        return false
                    }
                    const now = pixelsOf(texture)
                    return !!now && !!baseline.pixels && now !== baseline.pixels
                },
                get doneText() {
                    return hasOrnament() ? 'Your pixels are on the ornament.' : 'Your pixels are on the sprite.'
                },
            },
        ],
    },
    {
        id: 'add',
        title: 'Add things',
        steps: [
            {
                id: 'add-bar',
                title: 'Add layers',
                body: 'These buttons add a new layer to the nameplate. The next cards say what the main ones make.',
                target: () => shown(document.querySelector('#panel_outliner .toolbar[toolbar_id="polyplus_nameplate_layers"]')) ?? panel('outliner'),
                placement: 'left',
            },
            {
                id: 'add-sprite',
                title: 'Sprite',
                body: 'A small picture you paint, stuck to a spot on the body or beside the name. After you drag one into place, switch to Long name and make sure it stayed there.',
                target: () => barItem('polyplus_nameplate_add_sprite'),
                placement: 'left',
            },
            {
                id: 'add-effect',
                title: 'Effect',
                body: 'Light or a pattern over the body, like a glow or a shine. You start from a ready-made one and adjust it in the Inspector.',
                target: () => barItem('polyplus_nameplate_add_effect'),
                placement: 'left',
            },
            {
                id: 'add-path',
                title: 'Path',
                body: 'A sprite that walks along the edges of the body. If you want something to travel around the nameplate, like a snail, use a path instead of a sprite.',
                target: () => barItem('polyplus_nameplate_add_path'),
                placement: 'left',
            },
            {
                id: 'add-particles',
                title: 'Particles',
                body: 'Lots of tiny pictures that rise, fall or twinkle around the nameplate. Pick a style in the window that opens, and they move as soon as you press Create.',
                target: () => barItem('polyplus_nameplate_add_emitter'),
                placement: 'left',
            },
            {
                id: 'letters',
                title: 'Name letters',
                body: 'Name text is selected, so the Inspector shows the name\'s color, outline and letters. Set Letters to "Letters move" for a wave, or to "Letters move and change color" for a rainbow.',
                before: async () => {
                    if (!(nameTextNode() as any)?.selected) selectInspectorTarget('name')
                    await revealLetters()
                },
                target: () => lettersField() ?? panel(INSPECTOR),
                placement: 'left',
            },
            {
                id: 'library',
                title: 'Library',
                body: 'The Library keeps sprites, colors and animations you saved, ready to add to any nameplate. Open it here and use its buttons to save the selected sprite or the current colors.',
                target: () => barItem('polyplus_nameplate_library_open'),
                placement: 'left',
            },
        ],
    },
    {
        id: 'move',
        title: 'Make it move',
        steps: [
            {
                id: 'animate-tab',
                title: 'Animate mode',
                body: 'Design is where you draw and place things. Animate is where they move, with a timeline under the preview.',
                mode: 'none',
                before: ensureNameplate,
                target: () => modeTab('animate'),
                placement: 'bottom',
                task: 'Click Animate at the top right',
                done: () => isNameplateActive() && Modes.id === 'animate',
                doneText: 'You\'re in Animate.',
            },
            {
                id: 'keyframes',
                title: 'Keyframes',
                body: 'Move the blue marker to a frame, then drag a layer in the preview. That adds a Position keyframe on that frame, and dragging again on the same frame changes it. For Opacity and the rest, click + on the layer\'s row here. The preview moves between your keyframes.',
                mode: 'animate',
                before: () => {
                    if (!primarySelectedNode()) select(firstSprite())
                },
                target: () => panel('timeline'),
                placement: 'top',
            },
            {
                id: 'reaction',
                title: 'Reactions',
                body: 'The loop plays all the time. A reaction plays when something happens to the player, and a new one starts out as Hurt, the red damage flash.',
                mode: 'animate',
                target: () => barItem('add_animation') ?? panel('animations'),
                placement: 'right',
                task: 'Click this + button, then Shake the whole nameplate',
                done: () => hasReaction(),
                doneText: 'You made a Hurt reaction.',
            },
            {
                id: 'shake',
                title: 'Whole nameplate',
                body: 'Keyframes on Whole nameplate move every layer at once, so this row is where a shake goes. Select it to see its keyframes in the timeline.',
                mode: 'animate',
                target: () => layerRow(plateNode()) ?? panel('outliner'),
                placement: 'left',
            },
            {
                id: 'try-it',
                title: 'Try it',
                body: 'Tick a box under Pretend the player is..., or click a button under Play a one-shot, and watch it play in the preview.',
                mode: 'animate',
                target: () => panel(TRY_IT),
                placement: 'right',
            },
        ],
    },
    {
        id: 'versions',
        title: 'Versions',
        steps: [
            {
                id: 'colorway',
                title: 'Colorways',
                body: 'A colorway swaps the colors and keeps your pixels as they are. Pick New colorway... from this list to make a light or dark version.',
                before: () => setStripFolded(false),
                target: () => barItem('polyplus_nameplate_colorway') ?? inViewport('.np-strip-host'),
            },
            {
                id: 'variant',
                title: 'Variants',
                body: 'Players choose between variants, and each variant uses one colorway. It can also hide layers. Make one with this Variants button, then pick it in the Variant list above the preview to see it.',
                target: () => barItemIn('polyplus_nameplate_variants', CHECKS),
                placement: 'right',
            },
        ],
    },
    {
        id: 'send',
        title: 'Send it',
        steps: [
            {
                id: 'before-send',
                title: 'Before you send it',
                body: 'Look at your nameplate as Short name, Long name and Server tag, 2 lines in Preview Options. Sprites you moved by hand are the usual thing to end up in the wrong place.\nThen look at Checks. Red problems block the export, and warnings only point at things worth a look. When the top line says Ready to export, it\'s ready.',
                before: showChecks,
                target: () => panel(CHECKS),
                placement: 'top',
            },
            {
                id: 'save',
                title: 'Save your project',
                body: 'Use File > Save Project (Ctrl+Alt+S) to save your work as a project file. Open that file later to keep working on it. The zip in the next step is only for your reviewer.',
                target: () => fileMenu(),
                placement: 'bottom',
            },
            {
                id: 'export',
                title: 'Export the zip',
                body: 'The box icon on the Checks panel saves the nameplate as a zip. Send that zip to your reviewer, who looks it over and uploads it.',
                target: () => barItemIn('polyplus_nameplate_export', CHECKS) ?? panel(CHECKS),
                placement: 'right',
            },
            {
                id: 'again',
                title: 'Find this again',
                body: 'Open the tour any time from Help > Nameplate Tour, or with the cap button at the top of the Checks panel. From there you can also run the chapters on adding things, making it move and versions.',
                target: () => barItemIn('polyplus_nameplate_tour', CHECKS),
                placement: 'right',
            },
        ],
    },
]

for (const chapter of TOUR_CHAPTERS) {
    for (const step of chapter.steps) {
        if (step.mode === 'none') continue
        const mode = step.mode ?? 'design'
        const setup = step.before
        step.before = () => {
            ready(mode)
            return setup?.()
        }
    }
}
