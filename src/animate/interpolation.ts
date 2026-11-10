import type { Interpolation } from '../model'

export type BlockbenchInterpolation = 'step' | 'linear' | 'bezier'

const BLOCKBENCH_OPTIONS: BlockbenchInterpolation[] = ['linear', 'step', 'bezier']

export function readBack(from: BlockbenchInterpolation, to: BlockbenchInterpolation): Interpolation {
    if (from === 'step') return 'step'
    return from === 'bezier' || to === 'bezier' ? 'ease' : 'linear'
}

export function keyframeTravel(before: unknown, after: unknown): Interpolation {
    if (before === 'step') return 'step'
    if (before === 'catmullrom' || before === 'bezier' || after === 'catmullrom' || after === 'bezier') return 'ease'
    return 'linear'
}

export function blockbenchInterpolations(modes: readonly string[]): BlockbenchInterpolation[] {
    const options = BLOCKBENCH_OPTIONS
    const count = modes.length
    if (count === 0) return []
    let costs = options.map(() => 0)
    const choices: number[][] = []
    for (let i = 1; i < count; i++) {
        const next: number[] = []
        const picked: number[] = []
        options.forEach((option) => {
            let best = Infinity
            let from = 0
            options.forEach((previous, at) => {
                const cost = costs[at] + (readBack(previous, option) === modes[i] ? 0 : 1)
                if (cost < best) {
                    best = cost
                    from = at
                }
            })
            next.push(best)
            picked.push(from)
        })
        costs = next
        choices.push(picked)
    }
    let current = costs.indexOf(Math.min(...costs))
    const result: BlockbenchInterpolation[] = new Array(count)
    for (let i = count - 1; i >= 0; i--) {
        result[i] = options[current]
        if (i > 0) current = choices[i - 1][current]
    }
    return result
}
