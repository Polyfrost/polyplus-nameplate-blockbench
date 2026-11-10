import { isNameplateActive, onFormatActivation, onFormatDeactivation } from '../format'
import { tryUi } from '../leftside/live'
import { isPlaying, redraw } from '../preview'
import { liveUi, setReaction } from '../preview/live'
import { openChooser, runTour, showOffer, TourOffer, TourRun } from './engine'
import { clearTourMarks, FIRST_TOUR, TOUR_CHAPTERS } from './steps'
import { rememberFlag } from '../util/seenFlag'
import { defineAction } from '../util/actions'
import { injectStyle } from '../util/style'
import { disposeAllReversed } from '../util/teardown'
import { TOUR_STYLE, TOUR_STYLE_ID } from './style'

export const TOUR_ACTION = 'polyplus_nameplate_tour'

const SEEN_KEY = 'polyplus_nameplate_tour_seen'
const SETTLE_TIME = 1200
const QUIET_TIME = 700
const WAIT_POLL = 300
const PENDING_TIME = 120000

const handles: {
    style: (() => void) | null
    action: Action | null
    run: TourRun | null
    offer: TourOffer | null
    chooser: Dialog | null
    removers: Array<() => void>
    wait: number
    pendingUntil: number
} = { style: null, action: null, run: null, offer: null, chooser: null, removers: [], wait: 0, pendingUntil: 0 }

const { seen: tourSeen, mark: markTourSeen } = rememberFlag(SEEN_KEY, 'tour')

function cancelWait() {
    window.clearTimeout(handles.wait)
    handles.wait = 0
}

function closeOffer() {
    handles.offer?.close()
    handles.offer = null
}

function closeChooser() {
    const chooser = handles.chooser
    handles.chooser = null
    if (chooser && Dialog.stack.includes(chooser)) chooser.hide()
}

function uiBusy(): boolean {
    return !!Dialog.open || Dialog.stack.length > 0 || !!Menu.open || !!document.querySelector('dialog[open]')
}

function untickReactions(kept: string[]) {
    const added = liveUi.reactions.filter((id) => !kept.includes(id))
    if (added.length === 0) return
    try {
        for (const id of added) setReaction(id, false, !isPlaying())
        for (const entry of tryUi.reactions) if (added.includes(entry.id)) entry.on = false
        redraw(false)
    } catch (error) {
        console.error('[polyplus_nameplate] tour could not reset Try it', error)
    }
}

export function startTour(chapterIds?: string | string[]) {
    if (!handles.style) return
    const wanted = typeof chapterIds === 'string' ? [chapterIds] : chapterIds
    const chapters = wanted ? TOUR_CHAPTERS.filter((chapter) => wanted.includes(chapter.id)) : TOUR_CHAPTERS
    if (!chapters.some((chapter) => chapter.steps.length > 0)) return
    cancelWait()
    closeOffer()
    handles.pendingUntil = 0
    markTourSeen()
    handles.run?.end()
    handles.run = null
    const reactions = [...liveUi.reactions]
    let finished = false
    const run = runTour(chapters, (completed) => {
        finished = true
        clearTourMarks()
        if (completed) untickReactions(reactions)
        if (handles.run === run) handles.run = null
    })
    if (!finished) handles.run = run
}

function offerTour() {
    markTourSeen()
    handles.offer = showOffer({
        onAccept: () => {
            handles.offer = null
            startTour(FIRST_TOUR)
        },
        onDecline: () => {
            handles.offer = null
        },
    })
}

function armOffer() {
    cancelWait()
    const pending = handles.pendingUntil > Date.now()
    if (handles.run || handles.offer || (!pending && tourSeen())) return
    const settleUntil = Date.now() + SETTLE_TIME
    let quietSince = Date.now()
    const poll = () => {
        handles.wait = 0
        if (!handles.style || !isNameplateActive() || handles.run || handles.offer) return
        const now = Date.now()
        if (uiBusy()) quietSince = now
        if (now < settleUntil || now - quietSince < QUIET_TIME) {
            handles.wait = window.setTimeout(poll, WAIT_POLL)
            return
        }
        if (handles.pendingUntil > now) startTour()
        else if (!tourSeen()) offerTour()
    }
    handles.wait = window.setTimeout(poll, WAIT_POLL)
}

function createAndTour() {
    handles.pendingUntil = Date.now() + PENDING_TIME
    const create = (BarItems as any).polyplus_nameplate_new as Action | undefined
    if (create) create.trigger()
    else handles.pendingUntil = 0
}

export function openTourChooser() {
    closeChooser()
    const chooser = openChooser({
        chapters: TOUR_CHAPTERS,
        ready: isNameplateActive(),
        onPick: (chapterId) => {
            handles.chooser = null
            startTour(chapterId)
        },
        onCreate: () => {
            handles.chooser = null
            createAndTour()
        },
    })
    handles.chooser = chooser
}

export function registerTour() {
    if (handles.style) return
    handles.style = injectStyle(TOUR_STYLE_ID, TOUR_STYLE)
    handles.action = defineAction(
        TOUR_ACTION,
        {
            name: 'Nameplate Tour',
            description: 'A guided walk through the nameplate editor',
            icon: 'school',
            category: 'help',
            click: () => openTourChooser(),
        },
        'help',
    )
    handles.removers.push(
        onFormatActivation(armOffer),
        onFormatDeactivation(() => {
            cancelWait()
            closeOffer()
        }),
    )
    if (isNameplateActive()) armOffer()
}

export function unregisterTour() {
    if (!handles.style) return
    cancelWait()
    closeOffer()
    closeChooser()
    handles.run?.end()
    handles.run = null
    handles.pendingUntil = 0
    disposeAllReversed(handles.removers)
    try {
        MenuBar.removeAction(`help.${TOUR_ACTION}`)
    } catch (error) {
        console.error('[polyplus_nameplate] could not remove the tour menu entry', error)
    }
    handles.action?.delete()
    handles.action = null
    handles.style()
    handles.style = null
}
