import { FORMAT_ID } from '../model'
import { DESIGN_MODE } from '../navigate'
import { startLive } from './live'
import { useLeftStyle } from './style'

interface LeftPanelOptions {
    id: string
    name: string
    icon: string
    index: number
    height: number
    growable: boolean
    component: object
    folded?: boolean
    resizable?: boolean
    toolbars?: Toolbar[]
    useStyle?: () => () => void
    live?: boolean
}

export interface LeftPanel {
    panel: Panel
    remove: () => void
}

export function registerLeftPanel(options: LeftPanelOptions): LeftPanel {
    const removeStyle = (options.useStyle ?? useLeftStyle)()
    const stopLive = options.live === false ? null : startLive()
    const panel = new Panel(options.id, {
        name: options.name,
        icon: options.icon,
        condition: { formats: [FORMAT_ID], modes: [DESIGN_MODE, 'animate'] },
        default_side: 'left',
        default_position: { slot: 'left_bar', sidebar_index: options.index, height: options.height, ...(options.folded ? { folded: true } : {}) },
        ...(options.resizable ? { resizable: true } : {}),
        growable: options.growable,
        ...(options.toolbars ? { toolbars: options.toolbars } : {}),
        component: options.component as any,
    })
    return {
        panel,
        remove: () => {
            panel.delete()
            stopLive?.()
            removeStyle()
        },
    }
}
