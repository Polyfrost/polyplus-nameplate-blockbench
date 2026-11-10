import type { NameplatePreview } from '../engine'
import type { CrowdLayout } from '../preview/crowd'
import { previewCostOf } from '../preview/cost'
import { hardLines } from './backdrop'

const VARIANT_PATH = /#variants\.(.+)$/
const flagged = new WeakMap<NameplatePreview, Set<string>>()
const lineChecks = new WeakMap<NameplatePreview, Map<string, boolean>>()

export function hardToRead(preview: NameplatePreview | null): Set<string> | null {
    if (!preview) return null
    const known = flagged.get(preview)
    if (known) return known
    const variants = new Set<string>()
    try {
        for (const warning of previewCostOf(preview).warnings) {
            if (warning.code !== 'readability') continue
            const variant = VARIANT_PATH.exec(warning.path)?.[1]
            if (variant !== undefined) variants.add(variant)
        }
    } catch (error) {
        console.error('[polyplus_nameplate] readability check failed', error)
        return null
    }
    flagged.set(preview, variants)
    return variants
}

export function linesHardToRead(preview: NameplatePreview, variant: string, layout: CrowdLayout, rgb: number): boolean {
    let known = lineChecks.get(preview)
    if (!known) {
        known = new Map()
        lineChecks.set(preview, known)
    }
    const key = `${variant}\u0000${layout.block.width}\u0000${layout.block.height}\u0000${rgb}`
    const cached = known.get(key)
    if (cached !== undefined) return cached
    let hard = false
    try {
        hard = hardLines(preview, variant, layout, rgb)
    } catch (error) {
        console.error('[polyplus_nameplate] line contrast check failed', error)
    }
    known.set(key, hard)
    return hard
}
