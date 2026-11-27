import { setLayerDrawer } from '../engine'
import { disposeGl, setFullReplay, setPlaceholderSource } from '../engine/gl'
import { composeLayers, fullReplayWanted, setComposePreview } from './compose'
import { placeholderPixels } from './placeholder'

export { beginCompose, composeSummary, gpuNotes, setComposePreview } from './compose'
export { backdropShown, drawBackdrop, eraTextColor, legacyColor, litColor } from './world'

let registered = false

export function registerGpu(): () => void {
    if (registered) return () => undefined
    registered = true
    setLayerDrawer(composeLayers)
    setFullReplay(fullReplayWanted)
    setPlaceholderSource((kind, id) => placeholderPixels(kind, id, false))
    return () => {
        registered = false
        setLayerDrawer(null)
        setFullReplay(null)
        setPlaceholderSource(null)
        setComposePreview(null)
        disposeGl()
    }
}
