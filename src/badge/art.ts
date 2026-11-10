export type BadgeDecoration = 'none' | 'shadow' | 'outline'

export interface BadgeLook {
    tint: number | null
    decoration: BadgeDecoration
    decorationRgb: number
}

interface BadgeTexels {
    size: number
    origin: number
    rgba: Uint8ClampedArray
}

const ROWS = [
    '.........oooo..**..oooo.........',
    '.......oooooo..**..oooooo.......',
    '......ooooooo..**..ooooooo......',
    '.....oooooooo..**..oooooooo.....',
    '.....oooooooo..**..oooooooo.....',
    '....oooooooo...**...oooooooo....',
    '....oooooooo...**...oooooooo....',
    '...ooooooooo...**...ooooooooo...',
    '...oooooooo....**....oooooooo...',
    '..ooooooooo...****...ooooooooo..',
    '..oooooooo....****....oooooooo..',
    '.ooooooo.....******.....ooooooo.',
    'oooo........********........oooo',
    '...........**********...........',
    '.........**************.........',
    '********************************',
    '********************************',
    '.........**************.........',
    '...........**********...........',
    'oooo........********........oooo',
    '.ooooooo.....******.....ooooooo.',
    '..oooooooo....****....oooooooo..',
    '..ooooooooo...****...ooooooooo..',
    '...oooooooo....**....oooooooo...',
    '...ooooooooo...**...ooooooooo...',
    '....oooooooo...**...oooooooo....',
    '....oooooooo...**...oooooooo....',
    '.....oooooooo..**..oooooooo.....',
    '.....oooooooo..**..oooooooo.....',
    '......ooooooo..**..ooooooo......',
    '.......oooooo..**..oooooo.......',
    '.........oooo..**..oooo.........',
]

const ART_TEXELS = 32
const TEXELS_PER_PIXEL = 4
const OUTLINE_TEXELS = 3
const OUTLINE_SIZE = ART_TEXELS + 2 * OUTLINE_TEXELS
const OUTLINE_REACH = 3.5
const SHADOW_TEXELS = TEXELS_PER_PIXEL
const GRID = OUTLINE_TEXELS + SHADOW_TEXELS + ART_TEXELS
const ART_TONE = 0xd6
const CHANNEL_MAX = 255
const CANVAS_LIMIT = 24

function artTone(char: string): number {
    if (char === 'o') return ART_TONE
    if (char === '*') return CHANNEL_MAX
    return 0
}

const ART: Uint8Array = Uint8Array.from(ROWS.join(''), artTone)

function dilate(): Uint8Array {
    const mask = new Uint8Array(OUTLINE_SIZE * OUTLINE_SIZE)
    const reach = Math.floor(OUTLINE_REACH)
    for (let y = 0; y < OUTLINE_SIZE; y++) {
        for (let x = 0; x < OUTLINE_SIZE; x++) {
            let hit = false
            for (let dy = -reach; dy <= reach && !hit; dy++) {
                for (let dx = -reach; dx <= reach && !hit; dx++) {
                    if (dx * dx + dy * dy > OUTLINE_REACH * OUTLINE_REACH) continue
                    const ax = x - OUTLINE_TEXELS + dx
                    const ay = y - OUTLINE_TEXELS + dy
                    hit = ax >= 0 && ay >= 0 && ax < ART_TEXELS && ay < ART_TEXELS && ART[ay * ART_TEXELS + ax] > 0
                }
            }
            if (hit) mask[y * OUTLINE_SIZE + x] = 1
        }
    }
    return mask
}

const OUTLINE_MASK: Uint8Array = dilate()

function brighten(channel: number): number {
    return Math.min(CHANNEL_MAX, Math.floor((channel * CHANNEL_MAX + (ART_TONE >> 1)) / ART_TONE))
}

function vertexRgb(rgb: number): number {
    return (brighten((rgb >> 16) & 0xff) << 16) | (brighten((rgb >> 8) & 0xff) << 8) | brighten(rgb & 0xff)
}

function put(rgba: Uint8ClampedArray, x: number, y: number, rgb: number) {
    const index = (y * GRID + x) * 4
    rgba[index] = (rgb >> 16) & 0xff
    rgba[index + 1] = (rgb >> 8) & 0xff
    rgba[index + 2] = rgb & 0xff
    rgba[index + 3] = CHANNEL_MAX
}

function multiply(tone: number, vertex: number): number {
    const channel = (shift: number) => Math.round((tone * ((vertex >> shift) & 0xff)) / CHANNEL_MAX)
    return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

function stampArt(rgba: Uint8ClampedArray, left: number, top: number, vertex: number) {
    for (let y = 0; y < ART_TEXELS; y++) {
        for (let x = 0; x < ART_TEXELS; x++) {
            const tone = ART[y * ART_TEXELS + x]
            if (tone > 0) put(rgba, left + x, top + y, multiply(tone, vertex))
        }
    }
}

function badgeTexels(look: BadgeLook): BadgeTexels {
    const rgba = new Uint8ClampedArray(GRID * GRID * 4)
    if (look.decoration === 'outline') {
        for (let y = 0; y < OUTLINE_SIZE; y++) {
            for (let x = 0; x < OUTLINE_SIZE; x++) {
                if (OUTLINE_MASK[y * OUTLINE_SIZE + x]) put(rgba, x, y, look.decorationRgb & 0xffffff)
            }
        }
    } else if (look.decoration === 'shadow') {
        stampArt(rgba, OUTLINE_TEXELS + SHADOW_TEXELS, OUTLINE_TEXELS + SHADOW_TEXELS, vertexRgb(look.decorationRgb))
    }
    stampArt(rgba, OUTLINE_TEXELS, OUTLINE_TEXELS, look.tint === null ? 0xffffff : vertexRgb(look.tint))
    return { size: GRID, origin: OUTLINE_TEXELS, rgba }
}

const canvases = new Map<string, HTMLCanvasElement>()

function lookKey(look: BadgeLook): string {
    return `${look.tint ?? 'none'}|${look.decoration}|${look.decoration === 'none' ? 0 : look.decorationRgb & 0xffffff}`
}

function badgeCanvas(look: BadgeLook): HTMLCanvasElement | null {
    const key = lookKey(look)
    const cached = canvases.get(key)
    if (cached) return cached
    if (typeof document === 'undefined') return null
    const texels = badgeTexels(look)
    const canvas = document.createElement('canvas')
    canvas.width = texels.size
    canvas.height = texels.size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const image = ctx.createImageData(texels.size, texels.size)
    image.data.set(texels.rgba)
    ctx.putImageData(image, 0, 0)
    canvases.set(key, canvas)
    while (canvases.size > CANVAS_LIMIT) canvases.delete(canvases.keys().next().value as string)
    return canvas
}

export const PLAIN_BADGE: Readonly<BadgeLook> = Object.freeze({ tint: null, decoration: 'none', decorationRgb: 0 })

export function drawBadgeArt(ctx: CanvasRenderingContext2D, left: number, top: number, scale: number, look: BadgeLook = PLAIN_BADGE) {
    const image = badgeCanvas(look)
    if (!image) return
    const texel = scale / TEXELS_PER_PIXEL
    const smoothing = ctx.imageSmoothingEnabled
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(image, left - OUTLINE_TEXELS * texel, top - OUTLINE_TEXELS * texel, GRID * texel, GRID * texel)
    ctx.imageSmoothingEnabled = smoothing
}
