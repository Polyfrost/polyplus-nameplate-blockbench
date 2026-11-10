import type { CostDetail, CostRow } from '../preview/cost'
import { costUi, selectLayerById } from './live'
import { registerLeftPanel } from './register'
import { costSummary, CostSummary, isNear } from './summary'

const COST_PANEL = 'polyplus_nameplate_cost'

function detailsOpen(row: CostRow): boolean {
    return costUi.opened.includes(row.id) || (row.detailsOpen && !costUi.closed.includes(row.id))
}

function toggleDetails(row: CostRow) {
    const open = detailsOpen(row)
    costUi.opened = open ? costUi.opened.filter((id) => id !== row.id) : [...costUi.opened, row.id]
    costUi.closed = open ? [...costUi.closed, row.id] : costUi.closed.filter((id) => id !== row.id)
}

function rowIcon(row: CostRow): string {
    if (row.over) return 'error'
    if (row.info) return 'info'
    if (isNear(row)) return 'warning'
    return row.measured ? 'check_circle' : 'remove_circle_outline'
}

const component = {
    data() {
        return { ui: costUi }
    },
    computed: {
        summary(this: any): CostSummary {
            return costSummary(this.ui.report)
        },
        open(this: any): boolean {
            return this.ui.manual ?? this.summary.open
        },
    },
    watch: {
        'summary.state'(this: any) {
            this.ui.manual = null
        },
    },
    methods: {
        toggle(this: any) {
            this.ui.manual = !this.open
        },
        rowIcon,
        isNear,
        rowTitle(row: CostRow): string {
            return [row.help, row.layer ? `Click to select layer '${row.layer}'` : ''].filter(Boolean).join('. ')
        },
        detailTitle(detail: CostDetail): string {
            return detail.layer ? `Click to select layer '${detail.layer}'.` : ''
        },
        selectLayer: selectLayerById,
        isOpen: detailsOpen,
        toggleDetails,
    },
    template: `
        <div class="np-left-host"><div class="np-left-scroll mobile_scrollbar">
            <div class="np-cost-summary" :class="'np-' + summary.state" :title="open ? 'Click to hide the numbers' : 'Click to show every limit'" @click="toggle()">
                <i class="material-icons notranslate icon np-cost-state">{{ summary.icon }}</i>
                <span class="np-cost-summary-text">{{ summary.text }}</span>
                <i class="material-icons notranslate icon np-cost-chevron">{{ open ? 'expand_less' : 'expand_more' }}</i>
            </div>
            <template v-if="open && ui.report.rows.length">
                <p class="np-left-note">One nameplate at its busiest.</p>
                <ul class="list np-cost">
                    <li v-for="row in ui.report.rows" :key="row.id" :class="{ 'np-over': row.over, 'np-near': isNear(row), 'np-unmeasured': !row.measured, 'np-info': row.info, 'np-layer': !!row.layer }" :title="rowTitle(row)" @click="selectLayer(row.layer)">
                        <div class="np-cost-line">
                            <i class="material-icons notranslate icon">{{ rowIcon(row) }}</i>
                            <span class="np-cost-name">{{ row.label }}</span>
                            <span class="np-cost-value">{{ row.value }}</span>
                        </div>
                        <div v-if="row.bar" class="np-meter"><div :style="{ width: row.percent + '%' }"></div></div>
                        <p v-if="row.note" class="np-cost-note">{{ row.note }}</p>
                        <template v-if="row.details.length">
                            <div class="np-cost-more" @click.stop="toggleDetails(row)">
                                <i class="material-icons notranslate icon">{{ isOpen(row) ? 'expand_more' : 'chevron_right' }}</i>
                                <span>{{ row.detailsLabel }}</span>
                            </div>
                            <ul v-if="isOpen(row)" class="np-cost-details">
                                <li v-for="detail in row.details" :key="detail.key" :class="{ 'np-layer': !!detail.layer, 'np-over': !!detail.over }" :title="detailTitle(detail)" @click.stop="selectLayer(detail.layer)">
                                    <div class="np-cost-line">
                                        <span class="np-cost-name">{{ detail.label }}</span>
                                        <span class="np-cost-value">{{ detail.value }}</span>
                                    </div>
                                    <p v-if="detail.note" class="np-cost-note">{{ detail.note }}</p>
                                </li>
                            </ul>
                        </template>
                    </li>
                </ul>
            </template>
        </div></div>
    `,
}

export function registerCostPanel(): () => void {
    return registerLeftPanel({ id: COST_PANEL, name: 'Cost', icon: 'speed', index: 21, height: 120, folded: true, growable: false, component }).remove
}
