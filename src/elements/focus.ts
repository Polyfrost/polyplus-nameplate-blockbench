import { isNameplateActive } from '../format'
import { layerNodes, selectedLayerNodes } from './nodes'

const PAINT_PANEL = 'uv'
const LAYERS_PANEL = 'outliner'
const ROUTED_KEYS = ['select_all', 'delete']
const LAYERS_DELETE_EDIT = 'Delete outliner selection'
const SELECT_ALL_MESSAGE = 'To select every layer, click in Layers first.'

function isUnderMouse(id: string): boolean {
    const node = Panels[id]?.node as HTMLElement | undefined
    return !!node?.matches(':hover')
}

function panelUnderMouse(): string | null {
    if (!isNameplateActive() || !Modes.paint) return null
    if (isUnderMouse(PAINT_PANEL) && (UVEditor as any).texture) return PAINT_PANEL
    return isUnderMouse(LAYERS_PANEL) ? LAYERS_PANEL : null
}

function routeToPanelUnderMouse(name: string): Deletable {
    return SharedActions.add(name as any, {
        subject: 'nameplate_under_mouse',
        priority: 3,
        condition: () => {
            const panel = panelUnderMouse()
            return !!panel && panel !== Prop.active_panel
        },
        run(event: Event) {
            setActivePanel(panelUnderMouse() as string)
            SharedActions.run(name as any, event)
        },
    } as any)
}

function keepSelectAllInLayers(): Deletable {
    return SharedActions.add('select_all', {
        subject: 'nameplate_layers',
        priority: -1.5,
        condition: () => isNameplateActive() && !!Modes.paint && Prop.active_panel !== LAYERS_PANEL,
        run(event: Event) {
            if (event instanceof KeyboardEvent) Blockbench.showQuickMessage(SELECT_ALL_MESSAGE, 2500)
            else SharedActions.runSpecific('select_all', 'outliner', event)
        },
    } as any)
}

function narrowRestoredSelection(data: any) {
    if (!isNameplateActive() || data?.entry?.action !== LAYERS_DELETE_EDIT) return
    const selected = selectedLayerNodes()
    if (selected.length > 1 && selected.length === layerNodes().length) selected[0].select()
}

export function registerFocus(): () => void {
    if (typeof SharedActions === 'undefined') return () => {}
    const handlers: Deletable[] = [
        ...ROUTED_KEYS.map(routeToPanelUnderMouse),
        keepSelectAllInLayers(),
        Blockbench.on('undo', narrowRestoredSelection),
    ]
    return () => {
        for (const handler of handlers) handler.delete()
    }
}
