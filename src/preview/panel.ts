import { registerCostPanel } from '../leftside/cost'
import { registerTryPanel } from '../leftside/try'
import { disposeAllReversed } from '../util/teardown'

export { CROWD_TOGGLE, setCrowdView, startPlaying } from '../leftside/try'

let removers: Array<() => void> = []

export function registerPreviewPanel(): () => void {
    if (removers.length > 0) return () => {}
    removers = [registerCostPanel(), registerTryPanel()]
    return () => {
        disposeAllReversed(removers)
    }
}
