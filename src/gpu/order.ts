import { NameplateLayer } from '../engine'

const DEPTH_RANK: Record<string, number> = {
    behind: 0,
    background: 1,
    over_background: 2,
    over_text: 3,
}

function rank(depth: string): number {
    return DEPTH_RANK[depth] ?? DEPTH_RANK.background
}

export function inDrawOrder<T extends Pick<NameplateLayer, 'depth' | 'index'>>(layers: readonly T[]): T[] {
    return layers.slice().sort((a, b) => rank(a.depth) - rank(b.depth) || a.index - b.index)
}
