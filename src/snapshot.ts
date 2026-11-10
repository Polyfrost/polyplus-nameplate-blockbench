import { readAnimations, readGroups, readLayers, readLoop } from './elements'
import type { ProjectSnapshot } from './model'
import { readNameplate, readSprites } from './palette'
import { readFlags } from './flags/state'
import { readMaterials } from './material/state'
import { withGroupBreakpoints } from './library/groups'
import { readSlotMolang } from './molang/slots'

export function buildSnapshot(): ProjectSnapshot {
    const nameplate = readNameplate()
    const layers = readLayers()
    const { sprites, pixelIssues } = readSprites(layers, nameplate.palette)
    return {
        nameplate,
        layers,
        groups: withGroupBreakpoints(readGroups()),
        loop: readLoop(nameplate.fps),
        animations: readAnimations(nameplate.fps),
        sprites,
        pixelIssues,
        flags: readFlags(),
        materials: readMaterials(),
        slotMolang: readSlotMolang(),
    }
}
