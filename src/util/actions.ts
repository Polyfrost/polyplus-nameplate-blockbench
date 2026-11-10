import { FORMAT_ID } from '../model'
import { DESIGN_MODE } from '../navigate'

interface ActionSpec {
    name: string
    icon: unknown
    click: (event?: Event) => void
    description?: string
    category?: string
    condition?: unknown
}

export function defineAction(id: string, spec: ActionSpec, menuBarPath?: string): Action {
    const action = new Action(id, spec as any)
    if (menuBarPath) MenuBar.addAction(action, menuBarPath)
    return action
}

export function defineFormatAction(id: string, spec: ActionSpec, menuBarPath?: string): Action {
    return defineAction(id, { category: 'edit', condition: { formats: [FORMAT_ID] }, ...spec }, menuBarPath)
}

export function defineDesignAction(id: string, spec: ActionSpec, menuBarPath?: string): Action {
    return defineFormatAction(id, { condition: { formats: [FORMAT_ID], modes: [DESIGN_MODE] }, ...spec }, menuBarPath)
}

export function disposeMenuBarAction(action: Action | null, menuBarPath: string) {
    if (!action) return
    try {
        MenuBar.removeAction(`${menuBarPath}.${action.id}`)
    } finally {
        action.delete()
    }
}

export function addToMenu(menu: Menu | undefined, item: object, path: string, label = 'menu'): () => void {
    if (!menu || typeof (menu as any).addAction !== 'function') return () => {}
    try {
        menu.addAction(item as any, path)
    } catch (error) {
        console.error(`[polyplus_nameplate] could not add a ${label} entry`, error)
        return () => {}
    }
    return () => {
        try {
            menu.removeAction(item as any)
        } catch (error) {
            console.error(`[polyplus_nameplate] could not remove a ${label} entry`, error)
        }
    }
}
