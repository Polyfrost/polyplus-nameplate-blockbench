import { onHeavy } from '../design/events'
import { onPaintDragEnd, watchPaintDrags } from '../util/paintDrag'
import { ProblemButton, projectProblems, ProjectProblems, showProblemTarget } from '../export/issues'
import { isNameplateActive } from '../format'
import { CheckCounts, checkItems, CheckItem, checksHeadline, countChecks } from './items'
import { costNotes, onCostReport, selectLayerById } from './live'
import { registerLeftPanel } from './register'
import { pluginToolbar } from '../toolbar'
import { disposeAll, forgetToolbar } from '../util/teardown'
import { hasProject } from '../util/project'

const CHECKS_PANEL = 'polyplus_nameplate_checks'

const TOOLBAR_CHILDREN = [
    'polyplus_nameplate_settings',
    'polyplus_nameplate_variants',
    'polyplus_nameplate_tour',
    'polyplus_nameplate_params',
    'polyplus_nameplate_text_badge',
    'polyplus_nameplate_kept',
    '+',
    'polyplus_nameplate_export',
]

const LEVEL_ICONS: Record<CheckItem['level'], string> = {
    error: 'error',
    warning: 'warning',
    note: 'info',
}

interface ChecksUi {
    hasProject: boolean
    items: CheckItem[]
    counts: CheckCounts
    headline: string
}

const checksUi: ChecksUi = { hasProject: false, items: [], counts: { errors: 0, warnings: 0, notes: 0 }, headline: '' }

let problems: ProjectProblems = { errors: [], warnings: [] }
let panel: Panel | null = null

function rebuild() {
    checksUi.hasProject = hasProject()
    const items = checksUi.hasProject ? checkItems(problems, costNotes()) : []
    const counts = countChecks(items)
    checksUi.items = items
    checksUi.counts = counts
    checksUi.headline = checksHeadline(counts)
}

function refreshChecks() {
    try {
        problems = hasProject() ? projectProblems() : { errors: [], warnings: [] }
        rebuild()
        if (isNameplateActive()) Validator.validate()
    } catch (error) {
        console.error('[polyplus_nameplate] checks refresh failed', error)
    }
}

export function showChecks() {
    const shown = panel as any
    if (!shown) return
    try {
        if (shown.folded) shown.fold(false)
        const host = shown.attached_to && typeof Panels !== 'undefined' ? (Panels as any)[shown.attached_to] : null
        if (host?.selectTab) host.selectTab(shown)
        shown.moveToFront?.()
    } catch (error) {
        console.error('[polyplus_nameplate] could not show the Checks panel', error)
    }
    refreshChecks()
}

const component = {
    data() {
        return { ui: checksUi }
    },
    methods: {
        jump(item: CheckItem) {
            const jump = item.jump
            if (!jump) return
            try {
                if (jump.kind === 'target') showProblemTarget(jump.target)
                else if (jump.kind === 'button') jump.button.click()
                else selectLayerById(jump.layer)
            } catch (error) {
                console.error('[polyplus_nameplate] could not show this check', error)
            }
        },
        press(button: ProblemButton) {
            try {
                button.click()
            } catch (error) {
                console.error('[polyplus_nameplate] check button failed', error)
            }
        },
        levelIcon(item: CheckItem): string {
            return LEVEL_ICONS[item.level]
        },
        isFa(icon: string): boolean {
            return /^fa[srb]?[-.]/.test(icon)
        },
    },
    template: `
        <div class="np-left-host"><div class="np-left-scroll mobile_scrollbar">
            <p v-if="!ui.hasProject" class="np-left-empty">Open a nameplate to check it.</p>
            <template v-else>
                <div class="np-left-head" :class="ui.counts.errors ? 'np-blocked' : 'np-ready'">
                    <i class="material-icons notranslate icon">{{ ui.counts.errors ? 'error' : 'check_circle' }}</i>
                    <span>{{ ui.headline }}</span>
                </div>
                <ul v-if="ui.items.length" class="list np-checks">
                    <li v-for="item in ui.items" :key="item.key" :class="['np-level-' + item.level, { 'np-jump': !!item.jump }]" :title="item.jumpLabel" @click="jump(item)">
                        <div class="np-check-line">
                            <i class="material-icons notranslate icon">{{ levelIcon(item) }}</i>
                            <span class="np-check-text">{{ item.text }}</span>
                        </div>
                        <div v-if="item.buttons.length" class="np-check-buttons">
                            <button v-for="(button, index) in item.buttons" :key="index" type="button" @click.stop="press(button)">
                                <i v-if="isFa(button.icon)" class="fa icon" :class="button.icon"></i>
                                <i v-else class="material-icons notranslate icon">{{ button.icon }}</i>
                                <span>{{ button.name }}</span>
                            </button>
                        </div>
                    </li>
                </ul>
            </template>
        </div></div>
    `,
}

export function registerChecksPanel(): () => void {
    const toolbar = pluginToolbar(CHECKS_PANEL, { children: TOOLBAR_CHILDREN })
    const registration = registerLeftPanel({
        id: CHECKS_PANEL,
        name: 'Checks',
        icon: 'assignment_turned_in',
        index: 20,
        height: 260,
        resizable: true,
        growable: true,
        toolbars: [toolbar],
        component,
    })
    panel = registration.panel
    const removers = [onHeavy(refreshChecks), onCostReport(rebuild), onPaintDragEnd(refreshChecks), watchPaintDrags()]
    refreshChecks()
    return () => {
        disposeAll(removers)
        forgetToolbar(toolbar)
        registration.remove()
        panel = null
        problems = { errors: [], warnings: [] }
        checksUi.hasProject = false
        checksUi.items = []
        checksUi.counts = { errors: 0, warnings: 0, notes: 0 }
        checksUi.headline = ''
    }
}
