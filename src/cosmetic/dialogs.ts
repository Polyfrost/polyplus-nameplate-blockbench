import { engineSignals } from '../engine'
import { sanitizeId } from '../palette/ids'
import { cloneJson } from '../util/json'
import { hasProject } from '../util/project'
import { playerBoneOptions } from './attach'
import { CosmeticData, isVehicleRig, RIGS, REACTION_ON, ReactionData, SIGNAL_FREE_ON, UseRef } from './data'
import { Liveness, pickOf, projectLiveness, RefKind, RefPick, refOf, savedPick, shownPick, StaleChoice, staleChoice, staleLabel } from './references'
import { commitCosmetic, readCosmetic } from './state'
import { signalLabel } from './preview'
import { SETTINGS_SECTIONS } from './registry'

const SETTINGS_DIALOG = 'polyplus_cosmetic_settings'
const REACTIONS_DIALOG = 'polyplus_cosmetic_reactions'

export const ON_LABELS: Record<string, string> = { while: 'While on', start: 'When it turns on', stop: 'When it turns off', appear: 'When it first shows', equip: 'When you put it on' }
const BLENDS_IN: readonly string[] = ['while', 'equip']

export function animationNames(): string[] {
    return typeof Animator === 'undefined' ? [] : Animator.animations.map((animation) => animation.name)
}

export function controllerNames(): string[] {
    const all: any[] = typeof AnimationController === 'undefined' ? [] : (AnimationController as any).all ?? []
    return all.map((controller) => String(controller.name))
}

export function switchSignals(): string[] {
    return engineSignals().filter((name) => name.startsWith('is_'))
}

function options(names: string[], none?: string): Record<string, string> {
    const out: Record<string, string> = none === undefined ? {} : { '': none }
    for (const name of names) out[name] = name
    return out
}

export interface ControllerEntry {
    name: string
    stale: boolean
    on: boolean
    ref?: UseRef
}

export function controllerPicks(data: CosmeticData, live: Liveness): RefPick[] {
    const refs: unknown[] = Array.isArray(data.controllerRefs) ? data.controllerRefs : []
    return data.controllers.map((name, i) => pickOf(live, 'controllers', name, refOf(refs[i])))
}

export function controllerEntries(names: readonly string[], picked: readonly RefPick[]): ControllerEntry[] {
    const entries: ControllerEntry[] = []
    const live = picked.filter((pick) => !pick.stale)
    for (const name of Array.from(new Set([...names, ...picked.map((pick) => pick.name)]))) {
        for (const pick of picked) if (pick.stale && pick.name === name) entries.push({ name, stale: true, on: true, ...(pick.ref ? { ref: pick.ref } : {}) })
        const own = live.find((pick) => pick.name === name)
        if (own || names.includes(name)) entries.push({ name, stale: false, on: !!own, ...(own?.ref ? { ref: own.ref } : {}) })
    }
    return entries
}

export function pickedControllers(entries: readonly ControllerEntry[], on: (index: number) => boolean): { controllers: string[], refs: Array<UseRef | null> } {
    const controllers: string[] = []
    const refs: Array<UseRef | null> = []
    entries.forEach((entry, i) => {
        if (!on(i)) return
        if (entry.stale && entries.some((other, j) => !other.stale && other.name === entry.name && on(j))) return
        if (!entry.stale && controllers.includes(entry.name)) return
        controllers.push(entry.name)
        refs.push(entry.ref ?? null)
    })
    return { controllers, refs }
}

export function openSettings(): Dialog | null {
    if (!hasProject()) return null
    const data = readCosmetic()
    const controllers = controllerEntries(controllerNames(), controllerPicks(data, projectLiveness(data)))
    const sections = SETTINGS_SECTIONS.map((section) => section(data))
    const form: Record<string, unknown> = {
        id: { label: 'ID', type: 'text', value: data.id },
    }
    if (data.kind !== 'emote') {
        form.rig = { label: 'Worn on', type: 'select', options: options([...RIGS]), value: data.attach.rig }
        form.player_bone = {
            label: 'Sticks to',
            type: 'select',
            options: playerBoneOptions(data.attach.rig === 'player' ? data.attach.bone : ''),
            value: data.attach.rig === 'player' ? data.attach.bone : '',
            condition: (f: Record<string, unknown>) => f.rig === 'player',
        }
        form.bone = {
            label: 'Sticks to',
            type: 'text',
            value: data.attach.rig === 'player' ? '' : data.attach.bone,
            placeholder: 'root',
            condition: (f: Record<string, unknown>) => f.rig !== 'player',
        }
        form.replaces = {
            label: 'Replaces part',
            type: 'text',
            value: data.attach.replaces,
            placeholder: 'left_paddle',
            condition: (f: Record<string, unknown>) => isVehicleRig(f.rig) || !!data.attach.replaces,
        }
    }
    controllers.forEach((entry, i) => {
        form[`controller_${i}`] = { label: i === 0 ? 'Runs controllers' : ' ', type: 'checkbox', text: entry.stale ? staleLabel(entry.name) : entry.name, value: entry.on }
    })
    for (const section of sections) Object.assign(form, section.form)
    const dialog = new Dialog({
        id: SETTINGS_DIALOG,
        title: 'Cosmetic Settings',
        width: 480,
        form: form as any,
        onConfirm(result: Record<string, any>) {
            commitCosmetic('Edit cosmetic settings', (next) => {
                next.id = sanitizeId(String(result.id ?? '').trim()) || next.id
                if (next.kind !== 'emote') {
                    const rig = String(result.rig ?? next.attach.rig)
                    const bone = rig === 'player' ? result.player_bone : result.bone
                    next.attach = { rig, bone: String(bone ?? '').trim(), replaces: String(result.replaces ?? '').trim() }
                }
                const picked = pickedControllers(controllers, (i) => result[`controller_${i}`] === true)
                next.controllers = picked.controllers
                if (picked.refs.some(Boolean)) next.controllerRefs = picked.refs
                else delete next.controllerRefs
                for (const section of sections) section.save(result, next)
            })
            if (typeof Project !== 'undefined' && Project) Project.name = readCosmetic().id
        },
    } as any)
    dialog.show()
    return dialog
}

export interface ReactionRow extends Omit<ReactionData, 'speed'> {
    key: number
    speed: string
}

type ReactionPickField = 'play' | 'palette' | 'effect'

const REACTION_PICKS: Array<{ field: ReactionPickField, ref: 'playRef' | 'paletteRef' | 'effectRef', kind: RefKind }> = [
    { field: 'play', ref: 'playRef', kind: 'animations' },
    { field: 'palette', ref: 'paletteRef', kind: 'colorways' },
    { field: 'effect', ref: 'effectRef', kind: 'effects' },
]

export function reactionOfRow(row: ReactionRow): ReactionData {
    const speed = row.speed === '' ? null : Number(row.speed)
    const reaction: ReactionData = {
        signal: SIGNAL_FREE_ON.includes(row.on) ? '' : row.signal,
        on: row.on,
        play: row.play,
        restart: row.on !== 'while' && row.restart,
        blend: BLENDS_IN.includes(row.on) ? Math.max(0, Number(row.blend) || 0) : 0,
        speed: row.on === 'while' && speed !== null && Number.isFinite(speed) ? speed : null,
        palette: row.palette,
        effect: row.effect,
    }
    for (const { ref } of REACTION_PICKS) {
        const kept = refOf(row[ref])
        if (kept) reaction[ref] = kept
    }
    return reaction
}

export interface ShownReaction extends ReactionRow {
    picks: Record<ReactionPickField, RefPick>
    stale: Record<ReactionPickField, StaleChoice | null>
}

export function shownReaction(reaction: ReactionData, live: Liveness, key: number): ShownReaction {
    const { speed, ...rest } = cloneJson(reaction)
    const row: ShownReaction = { ...rest, speed: speed === null ? '' : String(speed), key, picks: {} as ShownReaction['picks'], stale: {} as ShownReaction['stale'] }
    for (const { field, ref, kind } of REACTION_PICKS) {
        const pick = pickOf(live, kind, reaction[field], refOf(reaction[ref]))
        row.picks[field] = pick
        row.stale[field] = staleChoice(pick)
        row[field] = shownPick(pick)
        delete row[ref]
    }
    return row
}

export function savedReaction(row: ShownReaction): ReactionData {
    const { picks, stale, ...out } = row
    for (const { field, ref } of REACTION_PICKS) {
        const saved = savedPick(row[field], picks[field])
        out[field] = saved.name
        if (saved.ref) out[ref] = saved.ref
        else delete out[ref]
    }
    return reactionOfRow(out)
}

export function openReactions(): Dialog | null {
    if (!hasProject()) return null
    const data = readCosmetic()
    const live = projectLiveness(data)
    let next = 0
    const state = {
        rows: data.reactions.map((reaction) => shownReaction(reaction, live, next++)),
        signals: switchSignals().map((name) => ({ name, label: signalLabel(name) })),
        ons: REACTION_ON.map((on) => ({ on, label: ON_LABELS[on] })),
        animations: animationNames(),
        colorways: Object.keys(data.palette.colorways),
        effects: Object.keys(data.effects.named),
    }
    const dialog: any = new Dialog({
        id: REACTIONS_DIALOG,
        title: 'Reactions',
        width: 720,
        component: {
            data: () => state,
            methods: {
                add() {
                    state.rows.push(shownReaction({ signal: state.signals[0]?.name ?? '', on: 'while', play: '', restart: false, blend: 0.25, speed: null, palette: '', effect: '' }, live, next++))
                },
                remove(index: number) {
                    state.rows.splice(index, 1)
                },
            },
            template: `
                <div class="pp-reactions">
                    <p v-if="!rows.length">No reactions yet.</p>
                    <div v-for="(row, index) in rows" :key="row.key" style="padding: 4px 0 8px; border-bottom: 1px solid var(--color-border);">
                        <div class="dialog_bar form_bar" style="display: flex; align-items: center; gap: 6px;">
                            <select class="dark_bordered" style="flex: 1;" v-model="row.on">
                                <option v-for="item in ons" :value="item.on">{{ item.label }}</option>
                            </select>
                            <select v-if="row.on !== 'appear' && row.on !== 'equip'" class="dark_bordered" style="flex: 1;" v-model="row.signal">
                                <option v-for="item in signals" :value="item.name">{{ item.label }}</option>
                            </select>
                            <span v-else style="flex: 1;"></span>
                            <i class="material-icons notranslate icon" title="Remove" @click="remove(index)">delete</i>
                        </div>
                        <div class="dialog_bar form_bar" style="display: flex; align-items: center; gap: 6px;">
                            <label style="flex: none;">Plays</label>
                            <select class="dark_bordered" style="flex: 2;" v-model="row.play">
                                <option value="">Nothing</option>
                                <option v-if="row.stale.play" :value="row.stale.play.value">{{ row.stale.play.label }}</option>
                                <option v-for="name in animations" :value="name">{{ name }}</option>
                            </select>
                            <template v-if="row.on === 'while' || row.on === 'equip'">
                                <label style="flex: none;">Blend in (s)</label>
                                <input type="number" class="dark_bordered" style="flex: 1; min-width: 0;" v-model.number="row.blend" min="0" step="0.05">
                            </template>
                            <template v-if="row.on === 'while'">
                                <label style="flex: none;">Speed</label>
                                <input type="number" class="dark_bordered" style="flex: 1; min-width: 0;" v-model="row.speed" min="0" step="0.1" placeholder="1">
                            </template>
                            <label v-else style="flex: none;"><input type="checkbox" v-model="row.restart"> Restart if it fires again</label>
                        </div>
                        <div class="dialog_bar form_bar" style="display: flex; align-items: center; gap: 6px;">
                            <label style="flex: none;">Colorway</label>
                            <select class="dark_bordered" style="flex: 1;" v-model="row.palette">
                                <option value="">Same</option>
                                <option v-if="row.stale.palette" :value="row.stale.palette.value">{{ row.stale.palette.label }}</option>
                                <option v-for="name in colorways" :value="name">{{ name }}</option>
                            </select>
                            <label style="flex: none;">Effect</label>
                            <select class="dark_bordered" style="flex: 1;" v-model="row.effect">
                                <option value="">None</option>
                                <option v-if="row.stale.effect" :value="row.stale.effect.value">{{ row.stale.effect.label }}</option>
                                <option v-for="name in effects" :value="name">{{ name }}</option>
                            </select>
                        </div>
                    </div>
                    <div style="padding-top: 8px;">
                        <button type="button" @click="add()"><i class="material-icons notranslate icon">add</i> Add a reaction</button>
                    </div>
                </div>
            `,
        },
        onConfirm() {
            const reactions = state.rows.map(savedReaction)
            commitCosmetic('Edit reactions', (target) => {
                target.reactions = reactions
            })
        },
    } as any)
    dialog.show()
    return dialog
}
