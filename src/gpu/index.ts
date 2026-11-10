import { setLayerDrawer, setMaterialDrawsWanted } from '../engine'
import { currentLook } from '../preview/options'
import { composeLayers, gpuWanted, setComposePreview } from './compose'

export { beginCompose, composeSummary, gpuNotes, setComposePreview } from './compose'
export { backdropShown, drawBackdrop, eraTextColor, legacyColor, litColor } from './world'

let registered = false

export function registerGpu(): () => void {
    if (registered) return () => undefined
    registered = true
    setLayerDrawer(composeLayers)
    setMaterialDrawsWanted(() => currentLook().effects && gpuWanted())
    return () => {
        registered = false
        setLayerDrawer(null)
        setMaterialDrawsWanted(null)
        setComposePreview(null)
    }
}
