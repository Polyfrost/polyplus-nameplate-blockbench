import type { BodyArtData } from '../model'
import { clampRounded } from '../util/num'

export type Handle = 'left' | 'right' | 'seg0' | 'seg1' | 'cen0' | 'cen1' | 'top' | 'bottom'

export interface Size {
    width: number
    height: number
}

interface Cuts {
    left: number
    rightStart: number
    rightWidth: number
    segment: [number, number] | null
    center: [number, number] | null
    top: number
    bottom: number
}

export const COLUMN_HANDLES: Handle[] = ['left', 'right', 'cen0', 'cen1', 'seg0', 'seg1']
export const ROW_HANDLES: Handle[] = ['top', 'bottom']

export function cloneArt(art: BodyArtData): BodyArtData {
    return { ...art, segment: art.segment ? [art.segment[0], art.segment[1]] : null, center: art.center ? [art.center[0], art.center[1]] : null }
}

function defaultTop(height: number): number {
    return Math.floor((height - 1) / 2)
}

export function cutsOf(art: BodyArtData, size: Size): Cuts {
    const right = art.mirror ? 0 : art.right
    const segment = art.segment ?? (art.center ? null : [art.left, size.width - right] as [number, number])
    const top = art.top ?? defaultTop(size.height)
    const bottom = art.bottom ?? (size.height - 1 - top)
    return {
        left: art.left,
        rightStart: size.width - right,
        rightWidth: art.mirror ? art.left : art.right,
        segment: segment && segment[1] > segment[0] ? segment : null,
        center: art.center,
        top,
        bottom,
    }
}

export function handleValue(art: BodyArtData, size: Size, handle: Handle): number | null {
    const cuts = cutsOf(art, size)
    switch (handle) {
        case 'left':
            return art.left
        case 'right':
            return art.mirror ? null : size.width - art.right
        case 'seg0':
            return cuts.segment ? cuts.segment[0] : null
        case 'seg1':
            return cuts.segment ? cuts.segment[1] : null
        case 'cen0':
            return art.center ? art.center[0] : null
        case 'cen1':
            return art.center ? art.center[1] : null
        case 'top':
            return cuts.top
        case 'bottom':
            return size.height - cuts.bottom
    }
}

export function moveHandle(art: BodyArtData, size: Size, handle: Handle, value: number): BodyArtData {
    const next = cloneArt(art)
    const { width, height } = size
    const cuts = cutsOf(art, size)
    switch (handle) {
        case 'left':
            next.left = clampRounded(value, art.mirror ? 1 : 0, art.mirror ? width : width - art.right)
            break
        case 'right':
            if (!art.mirror) next.right = width - clampRounded(value, art.left, width)
            break
        case 'seg0':
        case 'seg1': {
            const segment = cuts.segment ?? [art.left, Math.max(art.left + 1, width - (art.mirror ? 0 : art.right))] as [number, number]
            if (handle === 'seg0') segment[0] = clampRounded(value, 0, segment[1] - 1)
            else segment[1] = clampRounded(value, segment[0] + 1, width)
            next.segment = [Math.min(segment[0], width - 1), Math.min(Math.max(segment[1], segment[0] + 1), width)]
            break
        }
        case 'cen0':
        case 'cen1': {
            if (!art.center) break
            const center = [...art.center] as [number, number]
            if (handle === 'cen0') center[0] = clampRounded(value, 0, center[1] - 1)
            else center[1] = clampRounded(value, center[0] + 1, width)
            next.center = center
            break
        }
        case 'top':
            next.top = clampRounded(value, 0, height - 1 - cuts.bottom)
            if (next.bottom === null) next.bottom = cuts.bottom
            break
        case 'bottom':
            next.bottom = height - clampRounded(value, cuts.top + 1, height)
            if (next.top === null) next.top = cuts.top
            break
    }
    return next
}

export function defaultArt(texture: string, size: Size): BodyArtData {
    const left = Math.max(0, Math.floor((size.width - 1) / 2))
    return { texture, left, right: Math.max(0, size.width - left - 1), mirror: false, segment: null, center: null, top: null, bottom: null }
}

export function fitsSize(art: BodyArtData, size: Size): boolean {
    return artProblems(art, size, 1).length === 0
}

export function artProblems(art: BodyArtData, size: Size, frames: number): string[] {
    const problems: string[] = []
    const { width, height } = size
    if (frames !== 1) problems.push(`The picture has ${frames} frames. A body picture needs exactly one; pick another picture or set its Frames to 1.`)
    if (art.left < 0 || art.right < 0 || art.left + art.right > width) problems.push(`The left and right ends are wider than the picture (${width} px). Make them narrower.`)
    if (art.mirror && art.left < 1) problems.push('A flipped right end needs a left end at least 1 pixel wide.')
    const columns = (value: [number, number] | null, name: string) => {
        if (value && (value[0] < 0 || value[0] >= width || value[1] <= value[0] || value[1] > width)) problems.push(`The ${name} must cover at least one column inside the picture.`)
    }
    columns(art.segment, 'repeating middle')
    columns(art.center, 'center piece')
    const cuts = cutsOf(art, size)
    if (cuts.top < 0 || cuts.bottom < 0 || cuts.top + cuts.bottom > height - 1) problems.push(`The fixed top and bottom rows must leave at least one of the picture's ${height} rows to repeat.`)
    return problems
}
