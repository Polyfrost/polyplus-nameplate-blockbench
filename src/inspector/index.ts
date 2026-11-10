import { applyLayerChange, layerFormConfig, layerFormValues, layerHeader } from '../design/layer'
import { onLight } from '../design/events'
import { isPlateNode, PLATE_NAME } from '../plate'
import { findNode, isNameTextNode, selectedPinnedNode } from '../elements/nodes'
import { mountFlagsEditor } from '../flags/panel'
import { FORMAT_ID } from '../model'
import { DESIGN_MODE } from '../navigate'
import { readNameplate } from '../palette/state'
import { onShownColorway } from '../palette/tones'
import { onPreviewResult, previewUi } from '../preview'
import { mountTextEditor } from '../text/panel'
import { chooseView, FLAG_SECTION, InspectorView, LayerKind, SECTION_PLANS, wantsFlagEditor } from './plan'
import { buildPlateView } from './plate'
import { element } from '../util/dom'
import { hasProject } from '../util/project'
import { SectionedForm, signatureOf, splitConfig } from './sections'
import { setInspectorRefresh } from './selection'
import { injectStyle } from '../util/style'
import { INSPECTOR_STYLE, INSPECTOR_STYLE_ID } from './style'

export { selectInspectorTarget } from './selection'
export type { InspectorTarget } from './selection'

export const INSPECTOR_PANEL = 'polyplus_nameplate_inspector'

const GROUP_NOTE = 'A group moves and animates its layers together. To move it, drag one of its layers, or click empty preview and use the arrow keys (Shift: 5 px).'

interface InspectorUi {
    view: InspectorView
    title: string
    icon: string
    subtitle: string
    note: string
}

export const inspectorUi: InspectorUi = { view: 'none', title: '', icon: '', subtitle: '', note: '' }

const state: {
    panel: Panel | null
    style: (() => void) | null
    host: HTMLElement | null
    key: string
    teardown: (() => void) | null
    sectioned: SectionedForm | null
    flags: (() => void) | null
    flagHost: HTMLElement | null
    variant: string
} = { panel: null, style: null, host: null, key: '', teardown: null, sectioned: null, flags: null, flagHost: null, variant: '' }

function clearView() {
    unmountFlags()
    const teardown = state.teardown
    state.teardown = null
    state.sectioned = null
    state.key = ''
    try {
        teardown?.()
    } catch (error) {
        console.error('[polyplus_nameplate] could not clear the inspector', error)
    }
    if (state.host) state.host.textContent = ''
}

function unmountFlags() {
    const remove = state.flags
    state.flags = null
    state.flagHost = null
    try {
        remove?.()
    } catch (error) {
        console.error('[polyplus_nameplate] could not remove the flag editor', error)
    }
}

function syncFlags() {
    const sectioned = state.sectioned
    const host = sectioned?.extra(FLAG_SECTION) ?? null
    const wanted = !!sectioned && !!host && wantsFlagEditor(sectioned.result())
    if (!wanted || state.flagHost !== host) unmountFlags()
    if (wanted && host && !state.flags) {
        state.flags = mountFlagsEditor(host)
        state.flagHost = host
    }
}

function variantLayerNote(node: any): string {
    const key = previewUi.variant
    const variant = readNameplate().variants[key]
    if (!variant || !node) return ''
    if (variant.hide.includes(node.uuid)) return `Variant '${key}' hides this layer. Pick another variant to see changes.`
    const swap = variant.swap[node.uuid]
    if (!swap) return ''
    return `Variant '${key}' shows '${String(findNode(swap)?.name ?? swap)}' here instead. Pick another variant to see changes.`
}

function plateRowSelected(): boolean {
    return isPlateNode(selectedPinnedNode())
}

function headerFor(view: InspectorView, kind: LayerKind | null): Partial<InspectorUi> {
    switch (view) {
        case 'none':
            return { note: 'Open a nameplate to edit it here.' }
        case 'plate':
            if (plateRowSelected()) return { title: PLATE_NAME, icon: 'open_with', subtitle: 'Moves the whole nameplate' }
            return { title: 'Nameplate', icon: 'badge', subtitle: readNameplate().id }
        case 'name':
            return { title: 'Name text', icon: 'title', subtitle: "The player's name" }
        case 'badge':
            return { title: 'Badge', icon: 'verified', subtitle: 'PolyPlus badge' }
        case 'layer': {
            const header = layerHeader()
            return {
                title: header?.name ?? '',
                icon: header?.icon ?? '',
                subtitle: header ? `${header.kindLabel}${header.count > 1 ? `, ${header.count} selected` : ''}` : '',
                note: kind === 'group' ? GROUP_NOTE : variantLayerNote(header?.node),
            }
        }
    }
}

function setHeader(view: InspectorView, kind: LayerKind | null) {
    Object.assign(inspectorUi, { view, title: '', icon: '', subtitle: '', note: '' }, headerFor(view, kind))
}

function showLayer(node: any, kind: LayerKind, host: HTMLElement) {
    const sections = splitConfig(layerFormConfig(node), SECTION_PLANS[kind])
    const signature = signatureOf(sections, `layer|${kind}|${node.type}`)
    if (state.key !== signature || !state.sectioned) {
        clearView()
        const sectioned = new SectionedForm(sections, `layer.${kind}`, (changed, result) => {
            applyLayerChange(changed, result)
            syncFlags()
        })
        host.appendChild(sectioned.node)
        state.sectioned = sectioned
        state.key = signature
        state.teardown = () => sectioned.delete()
    }
    state.sectioned.setValues(layerFormValues(node))
    syncFlags()
}

export function currentView(): { view: InspectorView, kind: LayerKind | null } {
    const project = hasProject()
    const pinned = project ? selectedPinnedNode() : null
    const header = project && !pinned ? layerHeader() : null
    return chooseView({
        hasProject: project,
        pinned: pinned && !isPlateNode(pinned) ? (isNameTextNode(pinned) ? 'name' : 'badge') : null,
        layerKind: header?.kind ?? null,
    })
}

export function refreshInspector() {
    try {
        const host = state.host
        const { view, kind } = currentView()
        setHeader(view, kind)
        if (!host) {
            clearView()
            return
        }
        if (view === 'layer' && kind) {
            const header = layerHeader()
            if (header) {
                showLayer(header.node, kind, host)
                return
            }
        }
        if (view === 'plate') {
            clearView()
            buildPlateView(host, plateRowSelected())
            state.key = 'plate'
            return
        }
        if (view === 'name' || view === 'badge') {
            if (state.key === view) return
            clearView()
            const container = element('div', 'np-section-body', host)
            const unmount = mountTextEditor(container, view)
            state.teardown = () => {
                unmount()
                container.remove()
            }
            state.key = view
            return
        }
        clearView()
    } catch (error) {
        console.error('[polyplus_nameplate] inspector refresh failed', error)
    }
}

const component = {
    data() {
        return { ui: inspectorUi }
    },
    mounted(this: any) {
        state.host = (this.$refs.body as HTMLElement | undefined) ?? null
        state.key = ''
        refreshInspector()
    },
    beforeDestroy() {
        clearView()
        state.host = null
    },
    template: `
        <div class="np-scroll-host"><div class="np-scroll mobile_scrollbar">
        <div class="np-inspector capture_tab_key">
            <div v-if="ui.title" class="np-layer-head">
                <i class="material-icons notranslate icon">{{ ui.icon }}</i>
                <span class="np-layer-name">{{ ui.title }}</span>
                <span class="np-subtle">{{ ui.subtitle }}</span>
            </div>
            <p v-if="ui.note" class="np-panel-empty">{{ ui.note }}</p>
            <div ref="body"></div>
        </div>
        </div></div>
    `,
}

function onShownVariant() {
    if (previewUi.variant === state.variant) return
    state.variant = previewUi.variant
    if (state.key !== 'plate') refreshInspector()
}

export function registerInspector(): () => void {
    state.style = injectStyle(INSPECTOR_STYLE_ID, INSPECTOR_STYLE)
    state.panel = new Panel(INSPECTOR_PANEL, {
        name: 'Inspector',
        icon: 'tune',
        condition: { formats: [FORMAT_ID], modes: [DESIGN_MODE, 'animate'] },
        default_side: 'right',
        default_position: { slot: 'right_bar', sidebar_index: 9, height: 520 },
        resizable: true,
        growable: true,
        component: component as any,
    })
    setInspectorRefresh(refreshInspector)
    const removers = [onLight(refreshInspector), onShownColorway(refreshInspector), onPreviewResult(onShownVariant)]
    refreshInspector()
    return () => {
        for (const remove of removers) remove()
        setInspectorRefresh(null)
        clearView()
        state.panel?.delete()
        state.panel = null
        state.host = null
        state.style?.()
        state.style = null
    }
}
