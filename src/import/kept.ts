import { currentBundle } from '../compile'
import type { Problem } from '../export/issues'
import { isNameplateActive } from '../format'
import { channelName } from '../animate/checks'
import { PLATE_TARGET } from '../model'
import { confirmBox } from '../util/dialogs'
import { cloneJson } from '../util/json'
import { hasProject } from '../util/project'
import { installUndoState } from '../util/projectState'
import { looseLayerId, looseSpriteId } from '../util/bundlePath'
import { joinList } from '../util/text'
import { undoEdit } from '../util/undo'
import { defineAction } from '../util/actions'
import { disposeAll } from '../util/teardown'
import { currentExtra, EXTRA_PROPERTY, ExtraData, ExtraPatch, KeptOverride, lastKeptOverrides, PathStep, patchKey } from './extra'

const ACTION_ID = 'polyplus_nameplate_kept'
const DIALOG_ID = 'polyplus_nameplate_kept_dialog'
const TITLE = 'Kept from Import'
const ASPECT = 'nameplate_extra'

interface KeptRow {
    key: string
    label: string
    place: string
    status: string
    unused: boolean
}

const ui: { rows: KeptRow[] } = { rows: [] }

let action: Action | null = null
let listeners: Deletable[] = []

function stepText(step: PathStep): string {
    return typeof step === 'string' ? step : step.id
}

function placeOf(patch: ExtraPatch): string {
    const layer = looseLayerId(patch.file)
    if (layer !== null) return `Layer '${layer}'`
    const sprite = looseSpriteId(patch.file)
    if (sprite !== null) return `Picture '${sprite}'`
    if (patch.file === 'palettes.json') return 'Colors'
    if (patch.file === 'flags.json') return 'Flags'
    if (patch.file === 'manifest.json') {
        if (patch.path[0] === 'animations' && patch.path.length > 1) return `Animation '${stepText(patch.path[1])}'`
        if (patch.path[0] === 'variants' && patch.path.length > 1) return `Variant '${stepText(patch.path[1])}'`
        return 'Nameplate settings'
    }
    return patch.path.length === 0 ? 'A file of its own' : patch.file
}

function targetOf(patch: ExtraPatch): string {
    const target = patch.path.length > 3 ? stepText(patch.path[3]) : ''
    if (target === PLATE_TARGET) return 'the whole nameplate'
    return target === '$badge' ? 'the PolyPlus badge' : `'${target}'`
}

function channelsText(channels: string[]): string {
    return joinList(channels.map(channelName))
}

function partlyTaken(override: KeptOverride): boolean {
    return override.patch.path.length === 4 && override.channels.length < Object.keys((override.patch.value as object) ?? {}).length
}

function overrideText(override: KeptOverride): string {
    const patch = override.patch
    const animation = stepText(patch.path[1])
    if (patch.path.length === 2) {
        return `Your animation '${animation}' is used. The animation with the same name kept from the imported zip is left out of the export.`
    }
    const channels = channelsText(override.channels)
    return `Animation '${animation}': your own ${channels} keyframes on ${targetOf(patch)} are used, so the ${channels} track kept from the imported zip is left out${partlyTaken(override) ? ' (its other tracks are still written back)' : ''}.`
}

function overridesByKey(): Map<string, KeptOverride> {
    return new Map(lastKeptOverrides().map((override) => [patchKey(override.patch), override]))
}

function refreshRows() {
    try {
        currentBundle()
    } catch (error) {
        console.error('[polyplus_nameplate] could not check kept bundle data', error)
    }
    const overrides = overridesByKey()
    ui.rows = currentExtra().patches.map((patch) => {
        const override = overrides.get(patchKey(patch))
        const unused = !!override && !partlyTaken(override)
        return {
            key: patchKey(patch),
            label: patch.label || placeOf(patch),
            place: placeOf(patch),
            status: override
                ? unused
                    ? 'Not used: your own keyframes replace it.'
                    : `Partly used: your own ${channelsText(override.channels)} keyframes replace that part.`
                : 'Written back into the zip on export.',
            unused,
        }
    })
}

function writeExtra(label: string, change: (extra: ExtraData) => ExtraData) {
    if (!hasProject()) return
    undoEdit({ [ASPECT]: true }, label, () => {
        ;(Project as any)[EXTRA_PROPERTY] = cloneJson(change(currentExtra()))
    })
    refreshRows()
}

const component = {
    data() {
        return { ui }
    },
    computed: {
        unusedCount(this: any): number {
            return this.ui.rows.filter((row: KeptRow) => row.unused).length
        },
    },
    methods: {
        remove(row: KeptRow) {
            writeExtra('Remove kept zip data', (extra) => ({ ...extra, patches: extra.patches.filter((patch) => patchKey(patch) !== row.key) }))
        },
        removeUnused() {
            const unused = new Set(ui.rows.filter((row) => row.unused).map((row) => row.key))
            if (unused.size === 0) return
            writeExtra('Remove unused kept zip data', (extra) => ({ ...extra, patches: extra.patches.filter((patch) => !unused.has(patchKey(patch))) }))
        },
        removeAll() {
            confirmBox(
                {
                    title: TITLE,
                    icon: 'delete',
                    message: 'Remove everything kept from the import? It is left out of the next export. Ctrl+Z brings it back.',
                    confirm: 'Remove all',
                },
                () => writeExtra('Remove all kept zip data', (extra) => ({ ...extra, patches: [] })),
            )
        },
    },
    template: `
        <div class="np-kept">
            <p v-if="!ui.rows.length" class="np-panel-empty">Nothing is kept from an import. Everything in this nameplate can be edited here.</p>
            <template v-else>
                <p class="np-subtle">These imported parts can't be edited here. They export as they were. Remove one to leave it out.</p>
                <ul class="np-issues">
                    <li v-for="row in ui.rows" :key="row.key">
                        <i class="material-icons notranslate icon" :class="row.unused ? 'np-subtle' : ''">{{ row.unused ? 'block' : 'inventory_2' }}</i>
                        <div style="flex: 1; min-width: 0;">
                            <div>{{ row.label }}</div>
                            <div class="np-subtle">{{ row.place }}. {{ row.status }}</div>
                        </div>
                        <i class="material-icons notranslate icon np-icon-button" title="Remove: leave it out of the export" @click="remove(row)">delete</i>
                    </li>
                </ul>
                <div class="np-empty-actions" style="padding: 6px 10px;">
                    <button v-if="unusedCount" type="button" @click="removeUnused()"><i class="material-icons notranslate icon">cleaning_services</i> Remove the {{ unusedCount }} not used</button>
                    <button type="button" @click="removeAll()"><i class="material-icons notranslate icon">delete_sweep</i> Remove all</button>
                </div>
            </template>
        </div>
    `,
}

export function openKeptDialog(): Dialog {
    refreshRows()
    const dialog = new Dialog({
        id: DIALOG_ID,
        title: TITLE,
        width: 640,
        component,
        buttons: ['Close'],
        singleButton: true,
    } as any)
    dialog.show()
    return dialog
}

export function keptProblems(): Problem[] {
    if (!hasProject() || !isNameplateActive()) return []
    return lastKeptOverrides().map((override) => ({
        level: 'warning',
        text: `${overrideText(override)} Remove it under File > ${TITLE}... to tidy up.`,
        target: null,
        buttons: [{ name: 'Show kept data', icon: 'inventory_2', click: () => openKeptDialog() }],
    }))
}

export function registerKept() {
    if (action) return
    listeners = installUndoState(
        ASPECT,
        () => cloneJson(currentExtra()),
        (saved) => {
            ;(Project as any)[EXTRA_PROPERTY] = cloneJson(saved)
            refreshRows()
        },
    )
    action = defineAction(
        ACTION_ID,
        {
            name: `${TITLE}...`,
            description: 'See the parts of an imported zip the plugin keeps as they were, and remove the ones you no longer want',
            icon: 'inventory_2',
            condition: () => isNameplateActive() && currentExtra().patches.length > 0,
            click() {
                openKeptDialog()
            },
        },
        'file',
    )
}

export function unregisterKept() {
    disposeAll(listeners)
    action?.delete()
    action = null
}
