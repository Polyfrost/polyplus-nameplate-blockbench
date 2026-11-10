import type { Problem, ProblemButton, ProblemLevel, ProblemTarget } from '../export/issues'
import { showLayer } from '../navigate'

export const SHOW_ME = { name: 'Show me', icon: 'visibility' }
export const SELECT_LAYER = { name: 'Select layer', icon: 'fa-crosshairs' }

export function layerTarget(uuid: string | null | undefined): ProblemTarget | null {
    return uuid ? { kind: 'layer', uuid } : null
}

export function nodeTarget(node: any): ProblemTarget | null {
    return node ? layerTarget(String(node.uuid)) : null
}

export function problemFromNode(
    problem: { level: ProblemLevel, message: string, node?: any, designerOnly?: boolean },
    covers?: (path: string) => boolean,
): Problem {
    return {
        level: problem.level,
        text: problem.message,
        target: nodeTarget(problem.node),
        covers,
        designerOnly: problem.designerOnly,
    }
}

export function selectLayerButton(find: () => any): ProblemButton {
    return {
        ...SELECT_LAYER,
        click: () => {
            const node = find()
            if (node) showLayer(node)
        },
    }
}

export function removeButton(click: () => void, name = 'Remove'): ProblemButton {
    return { name, icon: 'delete', click }
}

export function editVariantButton(click: () => void): ProblemButton {
    return { name: 'Edit variant', icon: 'edit', click }
}

export function pathCovers(prefix: string, boundaries: string): (path: string) => boolean {
    return (path) => path === prefix || Array.from(boundaries).some((boundary) => path.startsWith(`${prefix}${boundary}`))
}
