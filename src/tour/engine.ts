import { dialogButtons } from '../util/dialogs'
import { clamp } from '../util/num'
import { isTypingTarget } from '../util/typing'
import type { TourChapter, TourPlacement, TourStep } from './types'

const TARGET_WAIT = 1500
const TARGET_POLL = 50
const DONE_POLL = 250
const MOVE_TIME = 300
const GAP = 14
const EDGE = 8
const RING_PAD = 4
const MIN_CARD_WIDTH = 260
const CHOOSER_ID = 'polyplus_nameplate_tour_chooser'
const SIDES: Exclude<TourPlacement, 'center'>[] = ['bottom', 'right', 'top', 'left']
const OPPOSITE: Record<Exclude<TourPlacement, 'center'>, Exclude<TourPlacement, 'center'>> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

interface Box {
    left: number
    top: number
    width: number
    height: number
}

interface PressKey {
    input_in_focus?: HTMLElement
    event: KeyboardEvent
    capture: () => void
}

interface ShownStep {
    chapter: TourChapter
    step: TourStep
}

export interface TourRun {
    end(): void
}

export interface TourOffer {
    close(): void
}

interface ChooserOptions {
    chapters: TourChapter[]
    ready: boolean
    onPick: (chapterId?: string) => void
    onCreate: () => void
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text) node.textContent = text
    return node
}

function setIcon(holder: HTMLElement, current: HTMLElement, name: string): HTMLElement {
    const next = Blockbench.getIconNode(name)
    holder.replaceChild(next, current)
    return next
}

function fillParagraphs(parent: HTMLElement, text: string) {
    parent.replaceChildren()
    for (const line of text.split('\n')) {
        if (line.trim()) parent.appendChild(make('p', '', line))
    }
}

function blockingUiOpen(): boolean {
    return !!Dialog.open || !!Menu.open
}

function safeTarget(step: TourStep): Element | null {
    if (!step.target) return null
    try {
        return step.target() ?? null
    } catch (error) {
        console.error('[polyplus_nameplate] tour target failed', error)
        return null
    }
}

function visibleBox(target: Element | null): Box | null {
    if (!target || !target.isConnected) return null
    const rect = target.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    const left = Math.max(0, rect.left)
    const top = Math.max(0, rect.top)
    const right = Math.min(window.innerWidth, rect.right)
    const bottom = Math.min(window.innerHeight, rect.bottom)
    if (right - left < 1 || bottom - top < 1) return null
    if (getComputedStyle(target).visibility === 'hidden') return null
    return { left, top, width: right - left, height: bottom - top }
}

function overlap(a: Box, b: Box): number {
    const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
    const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
    return width > 0 && height > 0 ? width * height : 0
}

function sideSpot(side: Exclude<TourPlacement, 'center'>, target: Box, width: number, height: number): Box {
    const viewWidth = window.innerWidth
    const viewHeight = window.innerHeight
    let left = target.left + target.width / 2 - width / 2
    let top = target.top + target.height / 2 - height / 2
    if (side === 'bottom') top = target.top + target.height + GAP
    else if (side === 'top') top = target.top - GAP - height
    else if (side === 'right') left = target.left + target.width + GAP
    else left = target.left - GAP - width
    left = clamp(left, EDGE, Math.max(EDGE, viewWidth - width - EDGE))
    top = clamp(top, EDGE, Math.max(EDGE, viewHeight - height - EDGE))
    return { left, top, width, height }
}

function centerSpot(width: number, height: number): Box {
    return {
        left: Math.max(EDGE, (window.innerWidth - width) / 2),
        top: Math.max(EDGE, (window.innerHeight - height) / 2),
        width,
        height,
    }
}

function sideRoom(target: Box): number {
    return Math.max(target.left - GAP - EDGE, window.innerWidth - target.left - target.width - GAP - EDGE)
}

function placeCard(target: Box | null, width: number, height: number, placement?: TourPlacement): Box & { covered: boolean } {
    if (!target || placement === 'center') return { ...centerSpot(width, height), covered: false }
    const order: Exclude<TourPlacement, 'center'>[] = []
    if (placement) order.push(placement, OPPOSITE[placement])
    for (const side of SIDES) if (!order.includes(side)) order.push(side)
    const guarded = { left: target.left - RING_PAD - 4, top: target.top - RING_PAD - 4, width: target.width + RING_PAD * 2 + 8, height: target.height + RING_PAD * 2 + 8 }
    let best: Box | null = null
    let bestOverlap = Infinity
    for (const side of order) {
        const spot = sideSpot(side, target, width, height)
        const covered = overlap(spot, guarded)
        if (covered === 0) return { ...spot, covered: false }
        if (covered < bestOverlap) {
            best = spot
            bestOverlap = covered
        }
    }
    return { ...(best ?? centerSpot(width, height)), covered: true }
}

class Card {
    readonly root = make('div', 'np-ntour-card np-ntour-hidden')
    readonly chapter = make('span', 'np-ntour-chapter')
    readonly close = make('div', 'np-ntour-close')
    readonly track = make('div', 'np-ntour-track')
    readonly fill = make('div')
    readonly main = make('div', 'np-ntour-main')
    readonly title = make('div', 'np-ntour-title')
    readonly body = make('div', 'np-ntour-body')
    readonly task = make('div', 'np-ntour-task')
    readonly taskText = make('div')
    readonly doneText = make('div', 'np-ntour-done-text')
    readonly foot = make('div', 'np-ntour-foot')
    readonly progress = make('span', 'np-ntour-progress')
    readonly back = make('button', 'np-ntour-quiet', 'Back')
    readonly next = make('button', 'np-ntour-next', 'Next')
    taskIcon: HTMLElement

    constructor(withTrack: boolean) {
        this.root.setAttribute('role', 'dialog')
        this.root.setAttribute('aria-live', 'polite')
        const head = make('div', 'np-ntour-head')
        head.append(Blockbench.getIconNode('school'), this.chapter, this.close)
        this.close.appendChild(Blockbench.getIconNode('clear'))
        this.close.title = 'End tour'
        this.root.appendChild(head)
        if (withTrack) {
            this.track.appendChild(this.fill)
            this.root.appendChild(this.track)
        }
        this.taskIcon = Blockbench.getIconNode('ads_click')
        const lines = make('div', 'np-ntour-task-lines')
        lines.append(this.taskText, this.doneText)
        this.task.append(this.taskIcon, lines)
        this.main.append(this.title, this.body, this.task)
        this.root.appendChild(this.main)
        this.back.type = 'button'
        this.next.type = 'button'
        this.foot.append(this.progress, this.back, this.next)
        this.root.appendChild(this.foot)
    }

    showTask(text: string | undefined) {
        this.task.style.display = text ? '' : 'none'
        this.task.classList.remove('np-ntour-done')
        this.taskIcon = setIcon(this.task, this.taskIcon, 'ads_click')
        this.taskText.textContent = text ?? ''
        this.doneText.textContent = ''
    }

    markDone(text: string) {
        if (this.task.classList.contains('np-ntour-done')) return
        this.taskIcon = setIcon(this.task, this.taskIcon, 'check_circle')
        this.doneText.textContent = text
        this.task.classList.add('np-ntour-done')
        this.next.classList.add('np-ntour-ready')
    }
}

class Tour implements TourRun {
    private readonly steps: ShownStep[]
    private readonly card = new Card(true)
    private readonly hole = make('div', 'np-ntour-hole')
    private readonly ring = make('div', 'np-ntour-ring')
    private readonly onEnd?: (finished: boolean) => void
    private index = -1
    private token = 0
    private ended = false
    private target: Element | null = null
    private done = false
    private frame = 0
    private poll = 0
    private wait = 0
    private moving = 0
    private lastKey = ''
    private keyHook: Deletable | null = null

    constructor(chapters: TourChapter[], onEnd?: (finished: boolean) => void) {
        this.onEnd = onEnd
        this.steps = chapters.flatMap((chapter) => chapter.steps.map((step) => ({ chapter, step })))
        this.card.close.addEventListener('click', () => this.end())
        this.card.back.addEventListener('click', () => this.back())
        this.card.next.addEventListener('click', () => this.next())
    }

    start() {
        if (this.steps.length === 0) {
            this.end()
            return
        }
        document.body.append(this.hole, this.ring, this.card.root)
        this.keyHook = Blockbench.on('press_key', (data: PressKey) => this.pressKey(data)) as Deletable
        this.frame = requestAnimationFrame(this.tick)
        this.go(0)
    }

    end(finished = false) {
        if (this.ended) return
        this.ended = true
        this.token++
        cancelAnimationFrame(this.frame)
        window.clearInterval(this.poll)
        window.clearTimeout(this.wait)
        window.clearTimeout(this.moving)
        this.keyHook?.delete()
        this.keyHook = null
        this.hole.remove()
        this.ring.remove()
        this.card.root.remove()
        this.target = null
        this.onEnd?.(finished)
    }

    private next() {
        if (this.ended) return
        if (this.index >= this.steps.length - 1) this.end(true)
        else this.go(this.index + 1)
    }

    private back() {
        if (this.ended || this.index <= 0) return
        this.go(this.index - 1)
    }

    private async go(index: number) {
        const token = ++this.token
        window.clearInterval(this.poll)
        window.clearTimeout(this.wait)
        this.poll = 0
        this.index = index
        const { step } = this.steps[index]
        this.card.root.classList.add('np-ntour-busy')
        if (step.before) {
            try {
                await step.before()
            } catch (error) {
                console.error('[polyplus_nameplate] tour step setup failed', error)
            }
        }
        if (token !== this.token || this.ended) return
        const target = await this.waitForTarget(step, token)
        if (token !== this.token || this.ended) return
        this.target = target
        this.render(index)
        this.poll = window.setInterval(this.check, DONE_POLL)
        this.check()
    }

    private waitForTarget(step: TourStep, token: number): Promise<Element | null> {
        return new Promise((resolve) => {
            if (!step.target) {
                resolve(null)
                return
            }
            const started = performance.now()
            const attempt = () => {
                this.wait = 0
                if (token !== this.token || this.ended) return
                const found = safeTarget(step)
                if (visibleBox(found) || performance.now() - started >= TARGET_WAIT) {
                    resolve(found)
                    return
                }
                this.wait = window.setTimeout(attempt, TARGET_POLL)
            }
            attempt()
        })
    }

    private render(index: number) {
        const { chapter, step } = this.steps[index]
        const card = this.card
        const first = card.root.classList.contains('np-ntour-hidden')
        const last = index === this.steps.length - 1
        card.chapter.textContent = chapter.title
        card.title.textContent = step.title
        fillParagraphs(card.body, step.body)
        card.showTask(step.task)
        card.progress.textContent = `${index + 1} of ${this.steps.length}`
        card.fill.style.width = `${((index + 1) / this.steps.length) * 100}%`
        card.back.classList.toggle('np-ntour-gone', index === 0)
        card.next.textContent = last ? 'Finish' : 'Next'
        card.next.classList.remove('np-ntour-ready')
        this.done = false
        card.root.classList.remove('np-ntour-busy', 'np-ntour-hidden')
        card.main.classList.remove('np-ntour-swap')
        card.root.classList.remove('np-ntour-enter')
        void card.root.offsetWidth
        if (first) card.root.classList.add('np-ntour-enter')
        else card.main.classList.add('np-ntour-swap')
        this.startMoving(!first)
        this.layout()
    }

    private startMoving(animate: boolean) {
        window.clearTimeout(this.moving)
        const nodes = [this.hole, this.ring, this.card.root]
        for (const node of nodes) node.classList.toggle('np-ntour-moving', animate)
        this.lastKey = ''
        if (!animate) return
        this.moving = window.setTimeout(() => {
            for (const node of nodes) node.classList.remove('np-ntour-moving')
        }, MOVE_TIME)
    }

    private readonly check = () => {
        if (this.ended || this.index < 0) return
        const { step } = this.steps[this.index]
        if (step.target) {
            this.target = safeTarget(step)
            this.layout()
        }
        if (this.done || !step.task || !step.done) return
        let finished = false
        try {
            finished = !!step.done()
        } catch (error) {
            console.error('[polyplus_nameplate] tour task check failed', error)
        }
        if (!finished) return
        this.done = true
        this.card.markDone(step.doneText || 'Done')
        this.lastKey = ''
    }

    private readonly tick = () => {
        if (this.ended) return
        this.frame = requestAnimationFrame(this.tick)
        this.layer()
        this.layout()
    }

    private layer() {
        const open = Dialog.open as (Dialog & { object?: HTMLElement }) | null
        const under = !!open && !(this.target && open.object?.contains(this.target))
        if (under === this.card.root.classList.contains('np-ntour-under')) return
        for (const node of [this.ring, this.card.root]) node.classList.toggle('np-ntour-under', under)
    }

    private layout() {
        if (this.index < 0 || this.card.root.classList.contains('np-ntour-hidden')) return
        const { step } = this.steps[this.index]
        const box = visibleBox(this.target)
        const key = [box ? [box.left, box.top, box.width, box.height].map(Math.round).join(',') : 'none', window.innerWidth, window.innerHeight].join('|')
        if (key === this.lastKey) return
        this.lastKey = key
        const card = this.card.root
        const shownWidth = card.offsetWidth
        card.style.width = ''
        let spot = placeCard(box, card.offsetWidth, card.offsetHeight, step.placement)
        if (spot.covered && box) {
            const room = Math.floor(sideRoom(box))
            if (room >= MIN_CARD_WIDTH && room < card.offsetWidth) {
                card.style.width = `${room}px`
                spot = placeCard(box, card.offsetWidth, card.offsetHeight, step.placement)
            }
        }
        if (card.offsetWidth !== shownWidth) card.classList.remove('np-ntour-moving')
        card.style.left = `${Math.round(spot.left)}px`
        card.style.top = `${Math.round(spot.top)}px`
        if (box) {
            const left = Math.max(1, box.left - RING_PAD)
            const top = Math.max(1, box.top - RING_PAD)
            const right = Math.min(window.innerWidth - 1, box.left + box.width + RING_PAD)
            const bottom = Math.min(window.innerHeight - 1, box.top + box.height + RING_PAD)
            for (const node of [this.hole, this.ring]) {
                node.style.left = `${Math.round(left)}px`
                node.style.top = `${Math.round(top)}px`
                node.style.width = `${Math.round(right - left)}px`
                node.style.height = `${Math.round(bottom - top)}px`
            }
            this.ring.classList.add('np-ntour-on')
        } else {
            for (const node of [this.hole, this.ring]) {
                node.style.left = `${Math.round(window.innerWidth / 2)}px`
                node.style.top = `${Math.round(window.innerHeight / 2)}px`
                node.style.width = '0px'
                node.style.height = '0px'
            }
            this.ring.classList.remove('np-ntour-on')
        }
    }

    private pressKey(data: PressKey) {
        const event = data.event
        if (this.ended || event.type !== 'keydown' || blockingUiOpen()) return
        if (event.ctrlKey || event.metaKey || event.altKey) return
        const typing = !!data.input_in_focus || isTypingTarget(event.target) || isTypingTarget(document.activeElement)
        if (event.key === 'Escape') {
            if (typing) return
            data.capture()
            this.end()
            return
        }
        if (typing) return
        if (event.key === 'Enter' && this.card.root.contains(document.activeElement)) return
        if (event.key === 'ArrowRight' || event.key === 'Enter') {
            data.capture()
            this.next()
        } else if (event.key === 'ArrowLeft') {
            data.capture()
            this.back()
        }
    }
}

export function runTour(chapters: TourChapter[], onEnd?: (finished: boolean) => void): TourRun {
    const tour = new Tour(chapters, onEnd)
    tour.start()
    return tour
}

export function showOffer(options: { onAccept: () => void, onDecline: () => void }): TourOffer {
    const card = new Card(false)
    let closed = false
    let keyHook: Deletable | null = null
    const close = () => {
        if (closed) return
        closed = true
        keyHook?.delete()
        keyHook = null
        card.root.remove()
    }
    const answer = (accepted: boolean) => {
        if (closed) return
        close()
        if (accepted) options.onAccept()
        else options.onDecline()
    }
    card.root.classList.remove('np-ntour-hidden')
    card.root.classList.add('np-ntour-offer', 'np-ntour-enter')
    card.chapter.textContent = 'Nameplate Tour'
    card.close.title = 'Not now'
    card.title.textContent = 'New to nameplates?'
    fillParagraphs(card.body, 'The tour points out where to paint, how to try your nameplate at different name lengths, and how to export it when you\'re done.')
    card.task.style.display = 'none'
    card.main.appendChild(make('p', 'np-ntour-hint', 'It\'s also in Help > Nameplate Tour.'))
    card.progress.remove()
    card.foot.style.justifyContent = 'flex-end'
    card.back.textContent = 'Not now'
    card.next.textContent = 'Show me around'
    card.next.classList.add('np-ntour-ready')
    card.close.addEventListener('click', () => answer(false))
    card.back.addEventListener('click', () => answer(false))
    card.next.addEventListener('click', () => answer(true))
    keyHook = Blockbench.on('press_key', (data: PressKey) => {
        if (data.event.type !== 'keydown' || data.event.key !== 'Escape' || blockingUiOpen() || data.input_in_focus) return
        data.capture()
        answer(false)
    }) as Deletable
    document.body.appendChild(card.root)
    return { close }
}

function chooserRow(icon: HTMLElement, name: string, sub: string, pick: () => void): HTMLLIElement {
    const row = make('li')
    row.tabIndex = 0
    const text = make('div', 'np-ntour-row-text')
    text.append(make('div', 'np-ntour-row-name', name), make('div', 'np-ntour-row-sub', sub))
    row.append(icon, text)
    row.addEventListener('click', pick)
    row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        pick()
    })
    return row
}

function stepCount(count: number): string {
    return count === 1 ? '1 step' : `${count} steps`
}

export function openChooser(options: ChooserOptions): Dialog {
    const { chapters } = options
    const dialog = new Dialog({
        id: CHOOSER_ID,
        title: 'Nameplate Tour',
        width: 420,
        lines: [],
        ...dialogButtons('Close'),
    } as any)
    const pick = (chapterId?: string) => {
        dialog.close(0)
        options.onPick(chapterId)
    }
    dialog.show()
    const content = dialog.object?.querySelector('.dialog_content')
    if (!content) return dialog
    if (!options.ready) {
        const note = make('div', 'np-ntour-note')
        const lines = make('div')
        lines.appendChild(make('div', '', 'The tour points at parts of the nameplate editor, so open or create a nameplate first.'))
        const create = make('button')
        create.type = 'button'
        create.append(Blockbench.getIconNode('badge'), document.createTextNode('New Nameplate'))
        create.addEventListener('click', () => {
            dialog.close(0)
            options.onCreate()
        })
        lines.appendChild(create)
        note.append(Blockbench.getIconNode('info'), lines)
        content.appendChild(note)
    }
    if (chapters.length === 0) {
        content.appendChild(make('p', 'np-ntour-row-sub', 'There are no tour chapters yet.'))
        return dialog
    }
    const list = make('ul', 'np-ntour-list')
    const total = chapters.reduce((sum, chapter) => sum + chapter.steps.length, 0)
    const chapterWord = chapters.length === 1 ? '1 chapter' : `${chapters.length} chapters`
    list.appendChild(chooserRow(Blockbench.getIconNode('school'), 'Full tour', `${chapterWord}, ${stepCount(total)}`, () => pick()))
    list.appendChild(make('li', 'np-ntour-sep'))
    chapters.forEach((chapter, index) => {
        const number = make('span', 'np-ntour-num', String(index + 1))
        list.appendChild(chooserRow(number, chapter.title, stepCount(chapter.steps.length), () => pick(chapter.id)))
    })
    content.appendChild(list)
    return dialog
}
