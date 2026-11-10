import { readSettings } from './props'
import { ScheduleTiming, scheduleEvents, scheduleTimings } from './events'

const LATEST_END_MARKER = 'Latest end (window minus delay)'
const WINDOW_MARKER = 'Window end'
const AUTO_MARKERS = new Set([LATEST_END_MARKER, WINDOW_MARKER])
const EVENT_MARKER = / \(seed \d+\)$/
const LATEST_END_COLOR = 3
const WINDOW_COLOR = 9
const OWN_EVENT_COLOR = 6
const OTHER_EVENT_COLOR = 1
const MAX_EVENT_MARKERS = 48
const MIN_WINDOWS_SHOWN = 4
const FIT_PADDING = 48
const MIN_TIMELINE_SIZE = 10

const fitted: { key: string, size: number, before: number } = { key: '', size: 0, before: 0 }

const source: {
    seed: number
    files: Record<string, string> | null
    parsed: Record<string, string> | null
    timings: Map<string, ScheduleTiming>
    shown: string
} = { seed: 0, files: null, parsed: null, timings: new Map(), shown: '' }

function markerClass(): any {
    return (globalThis as any).TimelineMarker
}

function timings(): Map<string, ScheduleTiming> {
    if (source.files && source.parsed !== source.files) {
        source.timings = scheduleTimings(source.files)
        source.parsed = source.files
    }
    return source.timings
}

function visibleFrames(fps: number, timing: ScheduleTiming): number {
    const period = Math.max(1, timing.window * timing.step)
    let seconds = 0
    try {
        const timeline = (globalThis as any).Timeline
        seconds = typeof timeline?.getMaxLength === 'function' ? Number(timeline.getMaxLength()) : 0
    } catch {
        seconds = 0
    }
    const frames = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * fps) : 0
    return Math.max(MIN_WINDOWS_SHOWN, Math.ceil(frames / period)) * period
}

function timingOf(animation: any): ScheduleTiming | null {
    const settings = readSettings(animation)
    if (settings.plays !== 'schedule') return null
    const timing = timings().get(settings.schedule || String(animation.name ?? ''))
    return timing && timing.members.some((member) => member.name === animation.name) ? timing : null
}

function eventMarkers(animation: any, fps: number): Array<{ time: number, color: number, name: string }> {
    const timing = timingOf(animation)
    if (!timing) return []
    return scheduleEvents(timing, source.seed, visibleFrames(fps, timing), MAX_EVENT_MARKERS).map((event) => {
        const own = event.name === animation.name
        return {
            time: event.frame / fps,
            color: own ? OWN_EVENT_COLOR : OTHER_EVENT_COLOR,
            name: own ? `Plays here (seed ${source.seed})` : `'${event.name}' plays here (seed ${source.seed})`,
        }
    })
}

function isAutoMarker(marker: any): boolean {
    const name = String(marker?.name ?? '')
    return AUTO_MARKERS.has(name) || EVENT_MARKER.test(name)
}

export function syncScheduleMarkers(animation: any, fps: number) {
    if (!animation || !Array.isArray(animation.markers)) return
    const markers: any[] = animation.markers
    for (let index = markers.length - 1; index >= 0; index--) {
        if (isAutoMarker(markers[index])) markers.splice(index, 1)
    }
    const settings = readSettings(animation)
    const Marker = markerClass()
    if (settings.plays !== 'schedule' || settings.window < 1 || !Marker || !(fps > 0)) return
    const latest = Math.max(0, settings.window - settings.jitter)
    markers.push(new Marker({ time: latest / fps, color: LATEST_END_COLOR, name: LATEST_END_MARKER }))
    if (settings.jitter > 0) markers.push(new Marker({ time: settings.window / fps, color: WINDOW_COLOR, name: WINDOW_MARKER }))
    for (const marker of eventMarkers(animation, fps)) markers.push(new Marker(marker))
}

function timelineData(): any {
    return (globalThis as any).Timeline?.vue?._data ?? null
}

function resizeTimeline(size: number) {
    const timeline = (globalThis as any).Timeline
    const data = timelineData()
    if (!data) return
    data.size = size
    timeline?.updateSize?.()
}

function fitScheduleView(animation: any, fps: number) {
    const data = timelineData()
    if (!data) return
    const settings = animation ? readSettings(animation) : null
    if (!settings || settings.plays !== 'schedule' || settings.window < 1 || !(fps > 0)) {
        if (fitted.key && Number(data.size) === fitted.size) resizeTimeline(fitted.before)
        fitted.key = ''
        return
    }
    const timing = timingOf(animation)
    const period = timing ? Math.max(1, timing.window * timing.step) : settings.window
    const key = JSON.stringify([animation.uuid, period, fps])
    if (key === fitted.key) return
    const body = typeof document === 'undefined' ? null : document.getElementById('timeline_body')
    const width = (body?.clientWidth ?? 0) - Number(data.head_width ?? 0) - FIT_PADDING
    if (!(width > 0)) return
    const seconds = Math.max(Number(animation.length) || 0, (MIN_WINDOWS_SHOWN * period) / fps)
    const current = Number(data.size) || 0
    if (!fitted.key) fitted.before = current
    const size = Math.max(MIN_TIMELINE_SIZE, Math.min(current, width / seconds))
    fitted.key = key
    fitted.size = size
    if (size !== current) resizeTimeline(size)
}

export function updateEventMarkers(seed: number, files: Record<string, string> | null, animation: any, fps: number) {
    source.seed = Math.max(0, Math.floor(Number(seed) || 0))
    source.files = files
    if (!animation || !(fps > 0)) return
    fitScheduleView(animation, fps)
    const timing = timingOf(animation)
    const key = JSON.stringify([animation.uuid, source.seed, fps, timing, timing ? visibleFrames(fps, timing) : 0])
    if (key === source.shown) return
    source.shown = key
    syncScheduleMarkers(animation, fps)
}

export function refreshEventMarkers(animation: any, fps: number) {
    updateEventMarkers(source.seed, source.files, animation, fps)
}
