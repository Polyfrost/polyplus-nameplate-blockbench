import { readSettings } from '../animate/props'
import { currentFps, currentLoopFrames } from '../format'
import { LOOP_ANIMATION } from '../model'
import { animationFrames } from '../util/animation'

export interface ColorSpan {
    animation: any | null
    name: string
    length: number
    oneShot: boolean
    note: string
}

export function inAnimate(): boolean {
    return typeof Modes !== 'undefined' && !!Modes && !!(Modes as any).animate
}

function loopSpan(note = ''): ColorSpan {
    return { animation: null, name: LOOP_ANIMATION, length: currentLoopFrames(), oneShot: false, note }
}

function spanOf(animation: any): ColorSpan | null {
    if (!animation || animation.name === LOOP_ANIMATION) return null
    const settings = readSettings(animation)
    if (settings.plays === '' || settings.plays === 'schedule') return null
    const whileReaction = settings.plays === 'reaction' && settings.on === 'while'
    const length = whileReaction ? currentLoopFrames() : animationFrames(animation, currentFps())
    return { animation, name: String(animation.name ?? ''), length, oneShot: !whileReaction, note: '' }
}

export function currentSpan(): ColorSpan {
    if (!inAnimate() || typeof BBAnimation === 'undefined') return loopSpan()
    const animation = (BBAnimation as any).selected
    if (!animation || animation.name === LOOP_ANIMATION) return loopSpan()
    const span = spanOf(animation)
    if (span) return span
    const settings = readSettings(animation)
    return loopSpan(settings.plays === 'schedule'
        ? `'${animation.name}' is a random animation, and those can't change colors. Showing the loop's colors.`
        : `'${animation.name}' doesn't say when it plays yet. Showing the loop's colors.`)
}
