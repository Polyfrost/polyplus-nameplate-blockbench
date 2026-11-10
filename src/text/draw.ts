import type { NameplateBadgePose, NameplateLayer } from '../engine'
import { drawStyledText } from '../font'
import { currentLook } from '../preview/options'
import { badgeRect, Rect } from './backdrop'
import { drawBadgeArt as drawArt, PLAIN_BADGE } from '../badge/art'
import { rgbHex } from '../palette/color'
import { ResolvedBadge } from './contrast'
import { ResolvedStyle, shownStyle } from './style'

interface NameStyle {
    color?: string
    shadow?: string | null
    outline?: string | null
}

function styleOrNull(): ResolvedStyle | null {
    try {
        return shownStyle()
    } catch (error) {
        console.error('[polyplus_nameplate] could not resolve the text style', error)
        return null
    }
}

export function nameDrawStyle(dropShadow: boolean = currentLook().vanillaShadow): NameStyle {
    const style = styleOrNull()
    if (!style) return {}
    const text = style.resolvedText
    const result: NameStyle = {}
    if (text.color !== null) result.color = rgbHex(text.color)
    if (text.outline !== null) {
        result.outline = rgbHex(text.outline)
        result.shadow = null
        return result
    }
    switch (text.shadowUse) {
        case 'always':
            result.shadow = text.shadow === null ? null : rgbHex(text.shadow)
            break
        case 'with_drop_shadow':
            result.shadow = !dropShadow || text.shadow === null ? null : rgbHex(text.shadow)
            break
        case 'remove':
            result.shadow = null
            break
        default:
            if (!dropShadow) result.shadow = null
    }
    return result
}

export function drawStyledName(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, scale: number, fallback = '#FFFFFF') {
    const style = nameDrawStyle()
    drawStyledText(ctx, name, x, y, scale, {
        color: style.color ?? fallback,
        shadow: style.shadow ?? null,
        outline: style.outline ?? null,
    })
}

export function drawBadgeArt(ctx: CanvasRenderingContext2D, left: number, top: number, scale: number, badge: ResolvedBadge | null = styleOrNull()?.resolvedBadge ?? null) {
    drawArt(ctx, left, top, scale, badge ?? PLAIN_BADGE)
}

function posedRect(style: ResolvedStyle, pose?: NameplateBadgePose | null): Rect {
    const rect = badgeRect(style.badge)
    return pose ? { ...rect, x: rect.x + pose.dx, y: rect.y + pose.dy } : rect
}

export function drawBadge(ctx: CanvasRenderingContext2D, scale: number, originX: number, originY: number, pose?: NameplateBadgePose | null) {
    const style = styleOrNull()
    if (!style || (pose && (!pose.visible || pose.opacity <= 0))) return
    const rect = posedRect(style, pose)
    ctx.save()
    if (pose) ctx.globalAlpha = pose.opacity / 255
    drawBadgeArt(ctx, originX + rect.x * scale, originY + rect.y * scale, scale, style.resolvedBadge)
    ctx.restore()
}

export function badgeMarks(pose?: NameplateBadgePose | null): NameplateLayer[] {
    const style = styleOrNull()
    if (!style) return []
    const rect = posedRect(style, pose)
    return [{ left: 0, top: 0, x: rect.x, y: rect.y, width: rect.width, mirrorX: false, rasterWidth: rect.width, rasterHeight: rect.height } as NameplateLayer]
}
