import { fullChecksFailed } from '../compile'
import { CompiledBundle } from '../model'
import type { Problem } from './issues'

export const FULL_CHECKS_FAILED = "Checks couldn't finish, so the nameplate can't be exported yet. Try again."

export function fullCheckProblems(bundle: CompiledBundle): Problem[] {
    if (!fullChecksFailed(bundle)) return []
    return [{ level: 'error', code: 'other', text: FULL_CHECKS_FAILED, target: null }]
}
