import type { NameplatePreview } from '../engine'
import type { NameplateData } from '../model'
import { readNameplate } from '../palette/state'
import { currentLoad, previewUi } from '../preview'
import { badgeRect, loopPixels, nameRect } from './backdrop'
import { ColorResolver, colorResolver, ResolvedBadge, resolveBadge, ResolvedText, resolveText } from './contrast'
import { hasProject } from '../util/project'
import { BadgeSettings, TextSettings, variantBadge, variantText } from './types'

export interface VariantStyle {
    key: string
    text: TextSettings
    badge: BadgeSettings
    resolve: ColorResolver
}

export interface ResolvedStyle extends VariantStyle {
    resolvedText: ResolvedText
    resolvedBadge: ResolvedBadge
    namePixels: number
    badgePixels: number
}

export function styleOf(plate: NameplateData, key: string): VariantStyle {
    const variant = plate.variants[key] ?? Object.values(plate.variants)[0] ?? null
    const colorway = variant?.palette ?? Object.keys(plate.palette.colorways)[0] ?? null
    return {
        key,
        text: variantText(plate as any, variant as any),
        badge: variantBadge(plate as any, variant as any),
        resolve: colorResolver(plate, colorway),
    }
}

export function shownVariant(plate: NameplateData): string {
    const keys = Object.keys(plate.variants)
    return keys.includes(previewUi.variant) ? previewUi.variant : keys[0] ?? ''
}

export function shownPreview(): NameplatePreview | null {
    return currentLoad()?.preview ?? null
}

export function resolveStyle(plate: NameplateData, key: string, preview: NameplatePreview | null = shownPreview()): ResolvedStyle {
    const style = styleOf(plate, key)
    const hint = style.text.backdropHint.map(style.resolve).filter((value): value is number => value !== null)
    const textPixels = loopPixels(preview, key, nameRect(), hint)
    const badgePixels = loopPixels(preview, key, badgeRect(style.badge, undefined, { preview, variant: key }))
    return {
        ...style,
        resolvedText: resolveText(style.text, textPixels, style.resolve),
        resolvedBadge: resolveBadge(style.badge, badgePixels, style.resolve),
        namePixels: textPixels.length,
        badgePixels: badgePixels.length,
    }
}

export function shownStyle(): ResolvedStyle | null {
    if (!hasProject()) return null
    const plate = readNameplate()
    return resolveStyle(plate, shownVariant(plate))
}
