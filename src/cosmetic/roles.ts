import { INTERACTION_LABELS, INTERACTIONS, PetData, PetRoleData, ROLE_IDS, ROLE_LABELS, RoleData, UseRef } from './data'
import { Liveness, pickOf, RefPick, savedPick, shownPick, StaleChoice, staleChoice } from './references'

export interface RoleRow {
    interaction: string
    id: string
    animation: string
    offset: [number, number, number]
    yaw: number
    ref?: UseRef
}

export interface RoleDialogSpec {
    id: string
    title: string
    empty: string
    max: number
    rows: RoleRow[]
    animations: string[]
    interactions: boolean
    live: Liveness
    added(rows: readonly RoleRow[], animations: readonly string[]): RoleRow | null
    save(rows: RoleRow[]): void
}

const PET_SPOT = 0.75

function shortName(name: string): string {
    return name.slice(name.lastIndexOf('.') + 1)
}

function withRef<T extends object>(value: T, ref: UseRef | undefined): T & { ref?: UseRef } {
    return ref ? { ...value, ref: { ...ref } } : value
}

export function roleRow(role: RoleData & { interaction?: string }): RoleRow {
    return withRef({ interaction: role.interaction ?? '', id: role.id, animation: role.animation, offset: [...role.offset] as [number, number, number], yaw: role.yaw }, role.ref)
}

export function cleanRow(row: RoleRow): RoleRow {
    return withRef({
        interaction: row.interaction,
        id: row.id,
        animation: row.animation,
        offset: [0, 1, 2].map((axis) => Number(row.offset[axis]) || 0) as [number, number, number],
        yaw: Number(row.yaw) || 0,
    }, row.ref)
}

export function roleOf(row: RoleRow): RoleData {
    const { id, animation, offset, yaw, ref } = cleanRow(row)
    return withRef({ id, animation, offset, yaw }, ref)
}

export function petRoleOf(row: RoleRow): PetRoleData {
    const { interaction, id, animation, offset, yaw, ref } = cleanRow(row)
    return withRef({ interaction, id, animation, offset, yaw }, ref)
}

export function nextPetRole(rows: readonly RoleRow[], pet: PetData, animations: readonly string[]): RoleRow | null {
    const taken = new Set(rows.map((row) => `${row.interaction}|${row.id}`))
    const declared = (interaction: string, id: string) => (pet.interactions[interaction as keyof PetData['interactions']] ?? []).includes(id as 'a' | 'b')
    const open: Array<[string, string]> = []
    for (const interaction of INTERACTIONS) for (const id of ROLE_IDS) if (!taken.has(`${interaction}|${id}`)) open.push([interaction, id])
    const pick = open.find(([interaction, id]) => declared(interaction, id)) ?? open[0]
    if (!pick) return null
    const [interaction, id] = pick
    const wanted = [`${interaction}_${id}`, interaction]
    const animation = wanted.map((name) => animations.find((candidate) => shortName(candidate) === name)).find(Boolean) ?? animations[0] ?? ''
    return { interaction, id, animation, offset: [0, 0, id === 'b' ? PET_SPOT : -PET_SPOT], yaw: id === 'b' ? 180 : 0 }
}

export interface ShownRow extends RoleRow {
    pick: RefPick
    stale: StaleChoice | null
}

export function shownRow(row: RoleRow, live: Liveness): ShownRow {
    const pick = pickOf(live, 'animations', row.animation, row.ref)
    return { ...row, offset: [...row.offset] as [number, number, number], animation: shownPick(pick), pick, stale: staleChoice(pick) }
}

export function savedRow(row: ShownRow): RoleRow {
    const { pick, stale, ref, ...rest } = row
    const saved = savedPick(row.animation, pick)
    return cleanRow({ ...rest, animation: saved.name, ...(saved.ref ? { ref: saved.ref } : {}) })
}

export function liveAnimations(animations: readonly string[], rows: readonly ShownRow[]): string[] {
    const out = [...animations]
    for (const row of rows) if (!row.stale && row.pick.name && !out.includes(row.pick.name)) out.push(row.pick.name)
    return out
}

export function openRoleDialog(spec: RoleDialogSpec): Dialog {
    let next = 0
    const shown = spec.rows.map((row) => shownRow(row, spec.live))
    const state = {
        rows: shown.map((row) => ({ ...row, key: next++ })),
        animations: liveAnimations(spec.animations, shown),
        interactions: spec.interactions ? INTERACTION_LABELS : null,
        roles: ROLE_LABELS,
        max: spec.max,
        empty: spec.empty,
    }
    const dialog: any = new Dialog({
        id: spec.id,
        title: spec.title,
        width: spec.interactions ? 760 : 640,
        component: {
            data: () => state,
            methods: {
                add() {
                    if (state.rows.length >= spec.max) return
                    const row = spec.added(state.rows, state.animations)
                    if (row) state.rows.push({ ...shownRow(row, spec.live), key: next++ })
                },
            },
            template: `
<div>
<p v-if="!rows.length">{{ empty }}</p>
<div v-for="(row, i) in rows" :key="row.key" class="dialog_bar form_bar" style="display:flex;align-items:center;gap:6px">
<select v-if="interactions" class="dark_bordered" v-model="row.interaction"><option v-for="(label, value) in interactions" :value="value">{{ label }}</option></select>
<select class="dark_bordered" v-model="row.id"><option v-for="(label, value) in roles" :value="value">{{ label }}</option></select>
<select class="dark_bordered" style="flex:1" v-model="row.animation"><option v-if="row.stale" :value="row.stale.value">{{ row.stale.label }}</option><option v-for="name in animations" :value="name">{{ name }}</option></select>
<label>Stands at</label>
<input v-for="axis in [0,1,2]" :key="axis" type="number" class="dark_bordered" style="width:56px" v-model.number="row.offset[axis]" step="0.25">
<label>Faces</label><input type="number" class="dark_bordered" style="width:64px" v-model.number="row.yaw" step="15">
<i class="material-icons notranslate icon" @click="rows.splice(i,1)">delete</i>
</div>
<button v-if="rows.length < max" type="button" @click="add()"><i class="material-icons notranslate icon">add</i> Add a role</button>
</div>`,
        },
        onConfirm() {
            spec.save(state.rows.map(({ key, ...row }) => savedRow(row)))
        },
    } as any)
    dialog.show()
    return dialog
}
