import { MAX_SPRITE_FRAMES, MAX_SPRITE_SIZE } from '../sprite'

export type StripDirection = 'down' | 'across'
export type PictureLayout = 'one' | StripDirection

export interface PictureSize {
    width: number
    height: number
}

export function fitsOneFrame(size: PictureSize): boolean {
    return size.width <= MAX_SPRITE_SIZE && size.height <= MAX_SPRITE_SIZE
}

export function frameSizeOf(size: PictureSize, direction: StripDirection, frames: number): PictureSize {
    if (direction === 'down') return { width: size.width, height: size.height / frames }
    return { width: size.width / frames, height: size.height }
}

export function frameCounts(size: PictureSize, direction: StripDirection): number[] {
    const length = direction === 'down' ? size.height : size.width
    const across = direction === 'down' ? size.width : size.height
    if (across > MAX_SPRITE_SIZE) return []
    const counts: number[] = []
    for (let frames = 2; frames <= Math.min(length, MAX_SPRITE_FRAMES); frames++) {
        if (length % frames === 0 && length / frames <= MAX_SPRITE_SIZE) counts.push(frames)
    }
    return counts
}

function squareness(size: PictureSize, direction: StripDirection, frames: number): number {
    const frame = frameSizeOf(size, direction, frames)
    return Math.abs(Math.log(frame.width / frame.height))
}

export function suggestedFrames(size: PictureSize, direction: StripDirection): number {
    const counts = frameCounts(size, direction)
    let best = counts[0] ?? 1
    for (const frames of counts) if (squareness(size, direction, frames) < squareness(size, direction, best)) best = frames
    return best
}

export function canSplit(size: PictureSize): boolean {
    return frameCounts(size, 'down').length > 0 || frameCounts(size, 'across').length > 0
}

export function worthAsking(size: PictureSize): boolean {
    return size.width !== size.height && canSplit(size)
}

export function firstDirection(size: PictureSize): StripDirection {
    const natural: StripDirection = size.height >= size.width ? 'down' : 'across'
    const other: StripDirection = natural === 'down' ? 'across' : 'down'
    return frameCounts(size, natural).length > 0 ? natural : other
}

export function suggestedLayout(size: PictureSize, likelyStrip: boolean): PictureLayout {
    if (!canSplit(size)) return 'one'
    const long = Math.max(size.width, size.height)
    const short = Math.min(size.width, size.height)
    const evenSquares = long > short && long % short === 0
    return !fitsOneFrame(size) || (likelyStrip && evenSquares) ? firstDirection(size) : 'one'
}
