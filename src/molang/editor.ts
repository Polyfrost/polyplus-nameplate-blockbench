import { isNameplateActive } from '../format'
import { readNameplate } from '../palette/state'
import type { Slot } from '../model'
import { nameplateAutocomplete } from './autocomplete'
import { KEY_MOLANG_HELP, KEY_PRESETS, KeyPreset, SLOT_PRESETS, SlotPreset } from './catalog'
import { checkMolang } from './probe'
import { addKeyframeMenuItem, editKeyframes, selectedKeyframes } from './keys'
import { dialogButtons } from '../util/dialogs'
import { projectParams } from './params'
import { clearSlotMolang, setSlotMolang, slotMolangOf } from './slots'

const DIALOG_ID = 'polyplus_nameplate_slot_molang'
const NAMEPLATE_CHANNELS = new Set(['frame', 'position', 'opacity', 'visible'])

function round(value: number, places: number): number {
    const scale = Math.pow(10, places)
    return Math.round(value * scale) / scale
}

export function hsvOf(hex: string): { h: number, s: number, v: number } {
    const clean = String(hex ?? '').replace('#', '')
    const rgb = clean.length >= 8 ? clean.slice(2, 8) : clean.slice(0, 6)
    const r = parseInt(rgb.slice(0, 2), 16) / 255 || 0
    const g = parseInt(rgb.slice(2, 4), 16) / 255 || 0
    const b = parseInt(rgb.slice(4, 6), 16) / 255 || 0
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min
    let h = 0
    if (delta > 0) {
        if (max === r) h = 60 * (((g - b) / delta) % 6)
        else if (max === g) h = 60 * ((b - r) / delta + 2)
        else h = 60 * ((r - g) / delta + 4)
    }
    if (h < 0) h += 360
    return { h: Math.round(h), s: round(max === 0 ? 0 : delta / max, 2), v: round(max, 2) }
}

export function presetTones(preset: SlotPreset, slot: Slot): string[] {
    return slot.ramp.map((hex) => {
        const { h, s, v } = hsvOf(hex)
        return preset.template.split('{h}').join(String(h)).split('{s}').join(String(s)).split('{v}').join(String(v))
    })
}

function findSlot(slotId: string): Slot | null {
    return readNameplate().palette.slots.find((slot) => slot.id === slotId) ?? null
}

interface ToneRow {
    color: string
    source: string
}

export function openSlotMolangEditor(slotId: string): any {
    const slot = findSlot(slotId)
    if (!slot) return null
    const saved = slotMolangOf(slotId) ?? []
    const rows: ToneRow[] = slot.ramp.map((color, tone) => ({ color, source: saved[tone] ?? '' }))
    const params = projectParams()
    const prism = (globalThis as any).VuePrismEditor
    const state = { rows, preset: SLOT_PRESETS[0].name, presets: SLOT_PRESETS, prism: !!prism }
    const dialog: any = new Dialog({
        id: DIALOG_ID,
        title: `Color Formula: ${slot.name}`,
        width: 640,
        ...dialogButtons('Apply', 'Remove formula', 'Cancel'),
        component: {
            components: prism ? { VuePrismEditor: prism } : {},
            data: () => state,
            computed: {
                about(): string {
                    const preset = SLOT_PRESETS.find((entry) => entry.name === (this as any).preset)
                    return preset ? preset.about : ''
                },
            },
            methods: {
                problems(source: string): string[] {
                    return source.trim() ? checkMolang(source.trim(), 'slot', params) : []
                },
                usePreset() {
                    const preset = SLOT_PRESETS.find((entry) => entry.name === state.preset)
                    if (!preset) return
                    presetTones(preset, slot).forEach((source, tone) => {
                        state.rows[tone].source = source
                    })
                },
                clearAll() {
                    for (const row of state.rows) row.source = ''
                },
                autocomplete(text: string, position: number) {
                    const settings = (globalThis as any).Settings
                    if (settings?.get?.('autocomplete_code') === false) return []
                    return nameplateAutocomplete(text, position)
                },
            },
            template: `
                <div class="np-molang-color">
                    <p>The result is a color, for example math.hsv(hue, saturation, value). Leave a shade empty to keep it as painted.</p>
                    <div class="dialog_bar form_bar">
                        <label class="name_space_left">Example</label>
                        <select class="dark_bordered" v-model="preset">
                            <option v-for="entry in presets" :key="entry.name" :value="entry.name">{{ entry.name }}</option>
                        </select>
                        <button type="button" @click="usePreset()">Use for every shade</button>
                        <button type="button" @click="clearAll()">Clear</button>
                    </div>
                    <p class="np-subtle">{{ about }}</p>
                    <div v-for="(row, tone) in rows" :key="tone" class="np-molang-row">
                        <div class="dialog_bar form_bar">
                            <span class="color np-molang-swatch" :title="row.color"><div class="color_inner" :style="{ 'background-color': row.color }"></div></span>
                            <label class="name_space_left">Shade {{ tone + 1 }}</label>
                            <vue-prism-editor v-if="prism" class="molang_input dark_bordered" v-model="row.source" language="molang" :autocomplete="autocomplete" :line-numbers="false" />
                            <input v-else type="text" class="dark_bordered" v-model="row.source" placeholder="keep as painted">
                        </div>
                        <p v-for="problem in problems(row.source)" class="np-molang-problem" style="color: var(--color-error, #e85050)">{{ problem }}</p>
                    </div>
                </div>
            `,
        },
        onConfirm() {
            const tones = state.rows.map((row) => row.source.trim())
            const broken = tones.some((source) => source && checkMolang(source, 'slot', params).length > 0)
            if (broken) Blockbench.showQuickMessage('Saved, but a formula has a problem. Checks lists it.', 2500)
            setSlotMolang(slotId, tones)
        },
        onButton(index: number) {
            if (index === 1) clearSlotMolang(slotId)
        },
    } as any)
    dialog.show()
    return dialog
}

function selectedKeys(): any[] {
    return selectedKeyframes((channel) => NAMEPLATE_CHANNELS.has(channel))
}

export function applyKeyPreset(preset: KeyPreset, keyframes: any[] = selectedKeys()): number {
    const targets = keyframes.filter((keyframe) => keyframe.channel === preset.channel)
    if (targets.length === 0) return 0
    editKeyframes(targets, `Formula preset: ${preset.name}`, (keyframe) => keyframe.set(preset.axis ?? 'x', preset.source))
    return targets.length
}

function presetLabel(preset: KeyPreset): string {
    return preset.axis ? `${preset.name} (${preset.axis.toUpperCase()})` : preset.name
}

const keyMenuItem = {
    id: 'polyplus_nameplate_key_molang',
    name: 'Formula',
    icon: 'functions',
    description: KEY_MOLANG_HELP,
    condition: () => isNameplateActive() && selectedKeys().length > 0,
    children() {
        const channels = new Set(selectedKeys().map((keyframe) => String(keyframe.channel)))
        return KEY_PRESETS.filter((preset) => channels.has(preset.channel)).map((preset) => ({
            name: `${presetLabel(preset)}: ${preset.about}`,
            icon: 'functions',
            description: preset.source,
            click: () => applyKeyPreset(preset),
        }))
    },
}

let removeKeyMenu: (() => void) | null = null

export function registerKeyPresetMenu() {
    if (!removeKeyMenu) removeKeyMenu = addKeyframeMenuItem(keyMenuItem)
}

export function unregisterKeyPresetMenu() {
    removeKeyMenu?.()
    removeKeyMenu = null
}
