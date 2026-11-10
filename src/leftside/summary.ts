import type { CostReport, CostRow } from '../preview/cost'

const NEAR_PERCENT = 80

type CostState = 'ok' | 'near' | 'over' | 'unknown'

export interface CostSummary {
    state: CostState
    text: string
    icon: string
    open: boolean
}

export function isNear(row: CostRow): boolean {
    return !row.over && !row.info && row.measured && row.bar && row.percent >= NEAR_PERCENT
}

export function costSummary(report: CostReport): CostSummary {
    if (report.rows.length === 0) return { state: 'unknown', text: 'Open a nameplate to see its cost.', icon: 'help_outline', open: false }
    const over = report.rows.filter((row) => row.over)
    if (report.status === 'over' || over.length > 0) {
        const names = over.map((row) => row.label)
        const margin = over.length === 1 && over[0].id === 'margin' && over[0].layer
        const text = margin ? `Layer '${over[0].layer}' is too far outside the background, so export is blocked. Move it closer to the body, or delete it.` : names.length === 1 ? `Over the limit: ${names[0]}. Export is blocked.` : names.length > 1 ? `${names.length} things are over the limit. Export is blocked.` : report.headline
        return { state: 'over', text, icon: 'error', open: true }
    }
    if (report.status === 'unknown') return { state: 'unknown', text: report.headline, icon: 'help_outline', open: false }
    const near = report.rows.filter(isNear)
    if (near.length === 1 && near[0].id === 'margin' && near[0].layer) {
        return { state: 'near', text: `Layer '${near[0].layer}' sits far outside the background, at ${near[0].percent}% of the limit. You can still export. To bring it down, move that layer closer to the body.`, icon: 'warning', open: true }
    }
    if (near.length === 1) return { state: 'near', text: `Almost at the limit: ${near[0].label}, ${near[0].percent}% used.`, icon: 'warning', open: true }
    if (near.length > 1) return { state: 'near', text: `${near.length} things are almost at the limit.`, icon: 'warning', open: true }
    return { state: 'ok', text: 'Within the limits', icon: 'check_circle', open: false }
}
