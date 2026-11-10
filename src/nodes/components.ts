import { Ref } from 'rete-vue-plugin/vue2'

const CLICK_SLOP = 4

export const NodeComponent = {
    props: ['data', 'emit', 'seed'],
    components: { Ref },
    data() {
        return { downAt: null as { x: number, y: number } | null }
    },
    methods: {
        inputs(this: any) {
            return Object.entries(this.data.inputs).filter((entry) => !!entry[1])
        },
        outputs(this: any) {
            return Object.entries(this.data.outputs).filter((entry) => !!entry[1])
        },
        row(this: any, key: string) {
            return this.data.look.rows[key] ?? { linked: false, literal: '', placeholder: '', editable: false, required: false }
        },
        rowTitle(this: any, key: string, input: { label?: string }) {
            const row = this.row(key)
            if (row.linked) return `${input.label}: comes from the linked node`
            if (!row.editable) return input.label ?? key
            return row.literal ? `${input.label}: ${row.literal}. Click to change it` : `${input.label}: ${row.placeholder || 'empty'}. Click to set a value`
        },
        note(this: any) {
            const look = this.data.look
            const list: string[] = look.problems.length ? look.problems : look.hints
            if (!list.length) return ''
            return list.length > 1 ? `${list[0]} (and ${list.length - 1} more)` : list[0]
        },
        noteTitle(this: any) {
            const look = this.data.look
            return [...look.problems, ...look.hints].join('\n')
        },
        down(this: any, event: PointerEvent) {
            this.downAt = { x: event.clientX, y: event.clientY }
        },
        edit(this: any, key: string, event: MouseEvent) {
            const start = this.downAt
            this.downAt = null
            if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) return
            this.data.look.onEdit(key)
        },
    },
    template: `
        <div class="np-node" :class="{ selected: data.selected, 'np-node-bad': data.look.problems.length > 0, 'np-node-unused': data.look.unused }" :title="data.look.help" data-testid="node">
            <div class="np-node-title">
                <i class="material-icons notranslate icon">{{ data.look.icon }}</i>
                <span class="np-node-name">{{ data.label }}</span>
            </div>
            <div class="np-node-row np-node-out" v-for="[key, output] in outputs()" :key="'o' + key + seed">
                <span class="np-node-label">{{ output.label }}</span>
                <Ref class="np-node-out-socket" :data="{ type: 'socket', side: 'output', key: key, nodeId: data.id, payload: output.socket }" :emit="emit" />
            </div>
            <div class="np-node-row" v-for="[key, input] in inputs()" :key="'i' + key + seed" :title="rowTitle(key, input)">
                <Ref class="np-node-in-socket" :data="{ type: 'socket', side: 'input', key: key, nodeId: data.id, payload: input.socket }" :emit="emit" />
                <span class="np-node-label" :class="{ 'np-required': row(key).required }">{{ input.label }}</span>
                <span v-if="!row(key).linked && (row(key).literal || row(key).placeholder)" class="np-node-value"
                    :class="{ 'np-node-default': !row(key).literal, 'np-node-editable': row(key).editable }"
                    @pointerdown="down" @click="row(key).editable && edit(key, $event)">{{ row(key).literal || row(key).placeholder }}</span>
            </div>
            <div class="np-node-summary" v-if="data.look.summary !== null" :title="data.look.summary" @pointerdown="down" @click="edit('', $event)">{{ data.look.summary }}</div>
            <div class="np-node-note" v-if="note()" :class="{ 'np-hint': !data.look.problems.length }" :title="noteTitle()">
                <i class="material-icons notranslate icon">{{ data.look.problems.length ? 'error' : 'info' }}</i>
                <span>{{ note() }}</span>
            </div>
            <div class="np-node-pad"></div>
        </div>
    `,
}

export const SocketComponent = {
    props: ['data'],
    template: `<div class="np-socket" :class="'np-socket-' + data.name" :title="data.title || data.name" data-testid="socket"></div>`,
}

export const ConnectionComponent = {
    props: ['data', 'start', 'end', 'path'],
    template: `<svg class="np-connection" data-testid="connection"><path :d="path" class="np-link-hit"><title>Right-click to remove this link</title></path><path :d="path" :class="'np-link-' + (data.kind || 'any')"></path></svg>`,
}
