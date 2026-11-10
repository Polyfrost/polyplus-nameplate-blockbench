import { issueValue } from '../checks/codes'
import { layerTarget } from '../checks/helpers'
import { currentBundle } from '../compile'
import { readLayers } from '../elements'
import type { EngineIssue } from '../engine'
import type { Problem } from '../export/issues'
import { MAX_CORNER } from './shape'

const CORNER_PATH = /^layers\/(.+)\.json#(radius|corners)$/

function covers(path: string): boolean {
    return CORNER_PATH.test(path)
}

export function cornerProblems(): Problem[] {
    const layers = new Map(readLayers().map((layer) => [layer.id, layer.uuid]))
    const problems: Problem[] = []
    const seen = new Set<string>()
    for (const issue of currentBundle().issues as EngineIssue[]) {
        const match = CORNER_PATH.exec(issue.path)
        if (!match || seen.has(match[1])) continue
        seen.add(match[1])
        const uuid = layers.get(match[1])
        const both = issue.code === 'corners_both'
        problems.push({
            level: 'error',
            text: both
                ? `Layer '${match[1]}' has one roundness for every corner and also separate corners. Turn Separate corners on or off in the Inspector to keep one of them.`
                : `Layer '${match[1]}': each corner's roundness must be 0 to ${issueValue(issue, 'limit') ?? MAX_CORNER} px. Lower it in the Inspector, under Shape and corners.`,
            target: layerTarget(uuid),
            covers,
        })
    }
    return problems
}
