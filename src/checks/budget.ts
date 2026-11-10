import type { IssueValues } from '../engine'
import type { IssueFacts } from './codes'

interface CpuPart {
    key: string
    label: string
    units: number
}

const CPU_PARTS: Array<[string, string]> = [
    ['molang', 'Formulas'],
    ['paths', 'Paths'],
    ['particles', 'Particles'],
    ['repeats', 'Repeats'],
    ['palette', 'Color animation'],
    ['materials', 'Effects'],
    ['text', 'Letter formulas'],
]

function value(values: IssueValues, name: string): number | null {
    const found = values[name]
    return typeof found === 'number' && Number.isFinite(found) ? found : null
}

export function count(amount: number): string {
    return Math.round(amount).toLocaleString('en-US')
}

export function kilobytes(bytes: number): string {
    const kb = bytes / 1024
    return `${kb < 10 ? kb.toFixed(1) : count(kb)} KB`
}

export function cpuParts(values: IssueValues): CpuPart[] {
    const parts: CpuPart[] = []
    for (const [key, label] of CPU_PARTS) {
        const units = value(values, key)
        if (units !== null && units > 0) parts.push({ key, label, units })
    }
    return parts
}

export function isLetterCpu(values: IssueValues): boolean {
    return value(values, 'perLetter') !== null
}

export const FLASH_HOLD_HINT = "Or raise 'Hold each frame for' in the Inspector."

export function flashText(values: IssueValues): string {
    const flashes = value(values, 'flashes')
    const pixels = value(values, 'px')
    const limit = value(values, 'limit') ?? 3
    const area = value(values, 'area') ?? 64
    const rule = `More than ${count(area)} pixels flashing together more than ${count(limit)} times a second can trigger seizures.`
    if (flashes !== null && pixels !== null) return `${count(pixels)} pixels flash together ${count(flashes)} times a second. ${rule}`
    return `More than ${count(area)} pixels flash together more than ${count(limit)} times a second. ${rule}`
}

function cpuText(values: IssueValues): string {
    const units = value(values, 'units') ?? 0
    const limit = value(values, 'limit') ?? 0
    if (isLetterCpu(values)) {
        const letters = value(values, 'letters') ?? 0
        return `The letter formula does ${count(units)} work every frame for ${count(letters)} letters. The limit is ${count(limit)}. Make it simpler.`
    }
    const parts = cpuParts(values).map((part) => `${part.label.toLowerCase()} ${count(part.units)}`)
    const split = parts.length ? ` (${parts.join(', ')})` : ''
    return `The nameplate does up to ${count(units)} work every frame${split}. The limit is ${count(limit)}. Simplify the formulas, or use fewer paths, particles, repeats or effects.`
}

function statesText(values: IssueValues): string {
    const frames = value(values, 'frames')
    const limit = value(values, 'limit') ?? 0
    if (frames !== null) return `Shows ${count(frames)} different frames. The limit is ${count(limit)} per layer. Use fewer frames, or slow it down.`
    return `Shows more than ${count(limit)} different pictures. Raise 'Hold each frame for', or use fewer keyframes on its settings.`
}

export function budgetText(facts: IssueFacts): string | null {
    const values = facts.values
    const limit = value(values, 'limit') ?? 0
    switch (facts.code) {
        case 'over_cpu':
            return cpuText(values)
        case 'over_quads':
            return `The nameplate draws up to ${count(value(values, 'quads') ?? 0)} shapes. The limit is ${count(limit)}. Use fewer or simpler layers, particles or repeats.`
        case 'over_cache':
            return `The nameplate keeps ${kilobytes(value(values, 'bytes') ?? 0)} of pictures in memory. The limit is ${kilobytes(limit)}. Use fewer frames or smaller sprites.`
        case 'over_margin':
            return `Reaches ${count(value(values, 'px') ?? 0)} px outside the game background. The limit is ${count(limit)} px. Move it closer, use a smaller picture, or make its movement smaller.`
        case 'over_states':
            return statesText(values)
        case 'flash':
            return `${flashText(values)} It can't be exported. Slow down whatever changes brightness quickly, or bring the bright and dark parts closer. ${FLASH_HOLD_HINT}`
        default:
            return null
    }
}
