import { materialLimits, materialNodeCost } from '../engine'
import { NODE_SPECS, NodeSpec } from './catalog'
import { MAX_COST, OUTLINE_FACTOR, TONE_COST, Weigher } from './typing'

const WIDTHS = [1, 2, 3, 4]
const VARIANTS: Record<NodeSpec['cost'], number[]> = {
    flat: [0],
    width: WIDTHS,
    inputs: WIDTHS,
    octaves: [1, 2, 3, 4, 5, 6, 7, 8],
}

interface WeightTable {
    weights: Map<string, number>
    limit: number
    outlineFactor: number
    missing: string[]
    fromEngine: boolean
}

function weightKey(type: string, variant: number): string {
    return `${type}#${variant}`
}

function readAll(): WeightTable {
    const weights = new Map<string, number>()
    const missing: string[] = []
    for (const spec of NODE_SPECS) {
        for (const variant of VARIANTS[spec.cost]) {
            const key = weightKey(spec.type, variant)
            const cost = materialNodeCost(spec.type, variant)
            if (cost === null) missing.push(key)
            else weights.set(key, cost)
        }
    }
    const limits = materialLimits()
    if (limits) weights.set(weightKey(TONE_COST, 0), limits.toneCost)
    else missing.push(weightKey(TONE_COST, 0))
    return {
        weights,
        limit: limits?.maxCost ?? MAX_COST,
        outlineFactor: limits?.outlineFactor ?? OUTLINE_FACTOR,
        missing,
        fromEngine: weights.size > 0,
    }
}

let table: WeightTable | null = null

function weightTable(): WeightTable {
    if (table) return table
    try {
        table = readAll()
        if (table.missing.length) console.warn('[polyplus_nameplate] material node costs the engine did not report', table.missing)
    } catch (error) {
        console.error('[polyplus_nameplate] reading material node costs from the engine failed', error)
        table = { weights: new Map(), limit: MAX_COST, outlineFactor: OUTLINE_FACTOR, missing: [], fromEngine: false }
    }
    return table
}

export function nodeWeigher(): Weigher {
    const weights = weightTable().weights
    return (type, variant) => weights.get(weightKey(type, variant)) ?? 0
}

export function costLimit(): number {
    return weightTable().limit
}

export function outlineFactor(): number {
    return weightTable().outlineFactor
}
