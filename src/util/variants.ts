import { NameplateData, VariantData } from '../model'
import { sanitizeId, uniqueId } from '../palette/ids'

export function addVariantLike(plate: NameplateData, wanted: string, palette: (base: VariantData | undefined) => string): string {
    const base: VariantData | undefined = Object.values(plate.variants)[0]
    const key = uniqueId(sanitizeId(wanted) || 'variant', (candidate) => candidate in plate.variants)
    const variant: VariantData = { palette: palette(base), hide: [...(base?.hide ?? [])], swap: { ...(base?.swap ?? {}) } }
    if (base?.ownsBackground !== undefined) variant.ownsBackground = base.ownsBackground
    plate.variants[key] = variant
    return key
}
