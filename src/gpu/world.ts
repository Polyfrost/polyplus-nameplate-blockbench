import { rgbHex } from '../palette/color'
import { Backdrop, currentLook, previewOptions, WorldLight } from '../preview/options'
import { Light } from './renderer'

export const LIGHT_COLORS: Record<WorldLight, Light> = {
    day: { r: 1, g: 1, b: 1 },
    night: { r: 0.42, g: 0.44, b: 0.6 },
    cave: { r: 0.16, g: 0.16, b: 0.18 },
}

const LEGACY_COLORS = [
    0x000000, 0x0000aa, 0x00aa00, 0x00aaaa, 0xaa0000, 0xaa00aa, 0xffaa00, 0xaaaaaa,
    0x555555, 0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff,
]

export function currentLight(): Light {
    return LIGHT_COLORS[previewOptions.light] ?? LIGHT_COLORS.day
}

export function isLit(light: Light = currentLight()): boolean {
    return light.r < 1 || light.g < 1 || light.b < 1
}

function parseHex(color: string): number | null {
    const match = /^#?([0-9a-f]{6})$/i.exec(color.trim())
    return match ? parseInt(match[1], 16) : null
}

export function litColor(color: string, light: Light = currentLight()): string {
    const rgb = parseHex(color)
    if (rgb === null || !isLit(light)) return color
    const channel = (shift: number, factor: number) => Math.round(((rgb >> shift) & 0xff) * factor)
    return rgbHex((channel(16, light.r) << 16) | (channel(8, light.g) << 8) | channel(0, light.b))
}

export function legacyColor(color: string): string {
    const rgb = parseHex(color)
    if (rgb === null) return color
    let best = LEGACY_COLORS[15]
    let bestDistance = Infinity
    for (const candidate of LEGACY_COLORS) {
        const dr = ((rgb >> 16) & 0xff) - ((candidate >> 16) & 0xff)
        const dg = ((rgb >> 8) & 0xff) - ((candidate >> 8) & 0xff)
        const db = (rgb & 0xff) - (candidate & 0xff)
        const distance = dr * dr * 3 + dg * dg * 4 + db * db * 2
        if (distance < bestDistance) {
            bestDistance = distance
            best = candidate
        }
    }
    return rgbHex(best)
}

export function eraTextColor(color: string): string {
    return litColor(currentLook().legacy ? legacyColor(color) : color)
}

function hash(x: number, y: number, seed: number): number {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed, 0x5bd1e995)
    h ^= h >>> 15
    h = Math.imul(h, 0x2c1b3c6d)
    h ^= h >>> 13
    return (h >>> 8) / 16777216
}

function gradient(ctx: CanvasRenderingContext2D, width: number, height: number, top: string, bottom: string) {
    const fill = ctx.createLinearGradient(0, 0, 0, height)
    fill.addColorStop(0, top)
    fill.addColorStop(1, bottom)
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, width, height)
}

function cells(width: number, height: number, cell: number, each: (x: number, y: number) => void) {
    for (let y = 0; y * cell < height; y++) for (let x = 0; x * cell < width; x++) each(x, y)
}

export function drawBackdrop(ctx: CanvasRenderingContext2D, kind: Backdrop = previewOptions.backdrop, scale = 4) {
    const width = ctx.canvas.width
    const height = ctx.canvas.height
    const cell = Math.max(2, Math.round(scale))
    ctx.save()
    switch (kind) {
        case 'sky':
            gradient(ctx, width, height, '#7FA9F0', '#C3D8F7')
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
            cells(width, height, cell * 4, (x, y) => {
                if (hash(x >> 1, y, 3) > 0.82 && y % 3 === 1) ctx.fillRect(x * cell * 4, y * cell * 4, cell * 8, cell * 3)
            })
            break
        case 'night':
            gradient(ctx, width, height, '#060914', '#151B33')
            cells(width, height, cell, (x, y) => {
                const roll = hash(x, y, 7)
                if (roll > 0.994) {
                    ctx.fillStyle = roll > 0.998 ? '#FFFFFF' : '#9FA9C9'
                    ctx.fillRect(x * cell, y * cell, cell, cell)
                }
            })
            break
        case 'water':
            gradient(ctx, width, height, '#1F4F9A', '#0F2A5C')
            ctx.fillStyle = 'rgba(120, 180, 255, 0.18)'
            cells(width, height, cell * 2, (x, y) => {
                const wave = Math.round(Math.sin(x * 0.35 + y) * 1.5)
                if ((y + wave) % 5 === 0) ctx.fillRect(x * cell * 2, y * cell * 2, cell * 2, cell)
            })
            break
        case 'glass': {
            gradient(ctx, width, height, '#8DB7C9', '#6E97AB')
            const pane = cell * 16
            ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
            cells(width, height, pane, (x, y) => {
                ctx.fillRect(x * pane, y * pane, pane, cell)
                ctx.fillRect(x * pane, y * pane, cell, pane)
                ctx.fillRect(x * pane + cell * 3, y * pane + cell * 3, cell, cell * 4)
                ctx.fillRect(x * pane + cell * 4, y * pane + cell * 2, cell * 2, cell)
            })
            break
        }
        default:
            break
    }
    ctx.restore()
}

export function backdropShown(): boolean {
    return previewOptions.backdrop !== 'plain'
}
