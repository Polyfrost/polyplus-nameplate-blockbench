import { previewUi } from '../preview'
import { pauseLive } from '../preview/live'

const PLAY_ITEM = 'polyplus_nameplate_play'

let timer: ReturnType<typeof setInterval> | null = null

function playItem(): Action | undefined {
    return typeof BarItems === 'undefined' ? undefined : (BarItems as any)[PLAY_ITEM] as Action | undefined
}

export function stopPlayback() {
    if (timer !== null) {
        clearInterval(timer)
        timer = null
    }
    if (previewUi.playing) pauseLive()
    previewUi.playing = false
    playItem()?.setIcon?.('play_arrow')
}

export function startPlayback(tick: () => void) {
    stopPlayback()
    previewUi.playing = true
    playItem()?.setIcon?.('pause')
    const interval = Math.max(20, Math.round(1000 / Math.max(1, previewUi.fps)))
    timer = setInterval(tick, interval)
}

export function togglePlayback(tick: () => void) {
    if (previewUi.playing) stopPlayback()
    else startPlayback(tick)
}
