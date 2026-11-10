import { nodeTarget } from '../checks/helpers'
import type { Problem } from '../export/issues'
import { coversGroupBreakpoints, groupWidthProblems } from './groups'

export function groupWidthIssues(): Problem[] {
    return groupWidthProblems().map((problem) => ({
        level: problem.level,
        text: problem.message,
        target: nodeTarget(problem.node),
        covers: problem.level === 'error' ? coversGroupBreakpoints : undefined,
    }))
}
