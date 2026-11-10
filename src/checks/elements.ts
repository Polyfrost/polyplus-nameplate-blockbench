import type { Problem } from '../export/issues'
import { isLayerNode, isPinnedNode } from '../elements/nodes'
import { undoEdit } from '../util/undo'
import { removeButton } from './helpers'

const LISTED_NAMES = 4
const KIND_NAMES: Record<string, string> = {
    cube: 'cube',
    mesh: 'mesh',
    texture_mesh: 'texture mesh',
    spline: 'spline',
    billboard: 'billboard',
    armature: 'armature',
    armature_bone: 'bone',
    locator: 'locator',
    null_object: 'null object',
    bounding_box: 'bounding box',
}

function allElements(): any[] {
    const outliner = typeof Outliner === 'undefined' ? null : (Outliner as any)
    const elements = outliner?.elements
    return Array.isArray(elements) ? elements : []
}

function strayElements(): any[] {
    return allElements().filter((element) => !!element && !isLayerNode(element) && !isPinnedNode(element))
}

function kindOf(element: any): string {
    const type = String(element?.type ?? '')
    return KIND_NAMES[type] ?? (type ? type.replace(/_/g, ' ') : '3D part')
}

export function removeStrayElements() {
    const stray = strayElements()
    if (stray.length === 0) return
    undoEdit({ elements: stray, outliner: true, selection: true }, 'Remove 3D parts', () => {
        for (const element of stray) {
            try {
                element.remove(false)
            } catch (error) {
                console.error('[polyplus_nameplate] could not remove a 3D part', error)
            }
        }
    })
    updateSelection()
}

function describe(stray: any[]): string {
    const kinds = Array.from(new Set(stray.map(kindOf)))
    const names = stray.slice(0, LISTED_NAMES).map((element) => `'${String(element?.name ?? kindOf(element))}'`)
    if (stray.length > LISTED_NAMES) names.push(`and ${stray.length - LISTED_NAMES} more`)
    const what = stray.length === 1 ? `a 3D ${kinds[0]}` : `${stray.length} 3D parts (${kinds.join(', ')})`
    return `This nameplate has ${what}: ${names.join(', ')}. 3D parts can't be exported. Click Remove to delete ${stray.length === 1 ? 'it' : 'them'}.`
}

export function strayElementProblems(): Problem[] {
    const stray = strayElements()
    if (stray.length === 0) return []
    return [
        {
            level: 'error',
            code: 'element_3d',
            text: describe(stray),
            target: null,
            buttons: [removeButton(() => removeStrayElements())],
        },
    ]
}
