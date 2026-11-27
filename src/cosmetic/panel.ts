import { onEngineReady } from '../engine'
import { toRgbHex } from '../palette/color'
import { disposeAll } from '../util/teardown'
import { checksView, onChecks, refreshChecks } from './checks'
import { setBrushColor } from './colors'
import { cosmeticFormatIds } from './formats'
import { canPreviewDuo, duoUi, onDuoChange, playDuo, scrubDuo, setDuoLength, toggleDuo } from './duoPreview'
import { canGoLive, liveMove, liveUi, onLiveChange, playLiveEffect, toggleLive } from './livePreview'
import { INTERACTION_LABELS } from './data'
import { canPreviewPetRoles, choosePetInteraction, onPetPlayChange, petUi, playPetRoles, scrubPetRoles, syncPetInteractions, togglePetPlay } from './petPreview'
import { MOVES } from './moves'
import { preview, resetPreview, setHostVariable, setSignal, signalControls, SignalControl, signalValueText, typedValue, wearAgain } from './preview'
import { slotTones } from './indexed'
import { onSoundChange, setSoundMuted, soundUi } from './sounds'
import { activeKind, cosmeticState, readCosmetic } from './state'
import { HostControl, hostOptions, PANEL_BUTTONS, PanelButton, shownHostControls } from './registry'

const PANEL_ID = 'polyplus_cosmetic'


interface Swatch {
    slot: string
    color: string
    tone: string
}

const ui = {
    kind: '' as string,
    buttons: [] as PanelButton[],
    signals: [] as SignalControl[],
    host: [] as HostControl[],
    values: {} as Record<string, number>,
    equips: false,
    canLive: false,
    live: liveUi,
    muted: false,
    soundNote: '',
    canDuo: false,
    duo: duoUi,
    canPet: false,
    pet: petUi,
    interactionLabels: INTERACTION_LABELS as Record<string, string>,
    moves: MOVES,
    hostValues: {} as Record<string, number>,
    swatches: [] as Swatch[][],
    checks: checksView,
    open: { signals: true, colors: true, checks: true, cost: true } as Record<string, boolean>,
}

let panel: Panel | null = null
let hooks: Array<() => void> = []

function sync() {
    const kind = activeKind()
    ui.kind = kind ?? ''
    if (!kind) return
    ui.buttons = PANEL_BUTTONS.filter((button) => !button.kinds || button.kinds.includes(kind))
    ui.signals = signalControls()
    const data = readCosmetic()
    ui.host = shownHostControls(kind, data, preview.host).map((control) => ({ ...control, options: hostOptions(control, data) }))
    ui.values = Object.fromEntries(ui.signals.map((control) => [control.name, preview.values[control.name] ?? 0]))
    ui.hostValues = Object.fromEntries(ui.host.map((control) => [control.name, preview.host[control.name] ?? control.initial ?? 0]))
    ui.canLive = canGoLive()
    ui.live = { ...liveUi }
    ui.muted = soundUi.muted
    ui.soundNote = soundUi.note
    ui.canDuo = canPreviewDuo()
    syncPetInteractions()
    ui.canPet = canPreviewPetRoles()
    ui.equips = readCosmetic().reactions.some((reaction) => reaction.on === 'equip')
    ui.swatches = readCosmetic().palette.slots.map((slot) => slotTones(slot).map((tone) => ({ slot: slot.name, color: toRgbHex(tone), tone })))
    ui.checks = { ...checksView }
}

const component = {
    data: () => ({ ui }),
    methods: {
        run(id: string) {
            ;(BarItems as any)[id]?.trigger?.()
        },
        flip(name: string, control: SignalControl) {
            const value = ui.values[name] ? 0 : 1
            ui.values = { ...ui.values, [name]: value }
            setSignal(control.name, value)
        },
        valueText(control: SignalControl, value: number): string {
            return signalValueText(control, value)
        },
        slide(name: string, event: Event) {
            const value = typedValue((event.target as HTMLInputElement).value)
            if (value === null) return
            ui.values = { ...ui.values, [name]: value }
            setSignal(name, value)
        },
        host(name: string, value: unknown) {
            const number = Number(value)
            ui.hostValues = { ...ui.hostValues, [name]: number }
            setHostVariable(name, number)
            sync()
        },
        reset() {
            resetPreview()
            sync()
        },
        wearAgain() {
            wearAgain()
        },
        toggleLive() {
            toggleLive()
            sync()
        },
        togglePetPlay() {
            togglePetPlay()
            sync()
        },
        playPetRoles(playing: boolean) {
            playPetRoles(playing)
        },
        scrubPetRoles(event: Event) {
            scrubPetRoles(Number((event.target as HTMLInputElement).value))
        },
        choosePetInteraction(event: Event) {
            choosePetInteraction((event.target as HTMLSelectElement).value)
            sync()
        },
        toggleDuo() {
            toggleDuo()
            sync()
        },
        playDuo(playing: boolean) {
            playDuo(playing)
        },
        scrubDuo(event: Event) {
            scrubDuo(Number((event.target as HTMLInputElement).value))
        },
        lengthDuo(event: Event) {
            setDuoLength(Number((event.target as HTMLInputElement).value))
        },
        playEffect(name: string) {
            playLiveEffect(name)
            sync()
        },
        effectLabel(name: string): string {
            const words = name.replace(/_/g, ' ').trim()
            return words ? words.charAt(0).toUpperCase() + words.slice(1) : name
        },
        toggleSound() {
            setSoundMuted(!soundUi.muted)
            ui.muted = soundUi.muted
        },
        move(id: string) {
            liveMove(id as any)
            sync()
        },
        paint(color: string) {
            setBrushColor(color)
        },
        toggle(section: string) {
            ui.open = { ...ui.open, [section]: !ui.open[section] }
        },
    },
    template: `
        <div class="pp-cosmetic" style="padding: 4px 8px;">
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                <button type="button" v-for="button in ui.buttons" :key="button.action" @click="run(button.action)" :title="button.label">
                    <i class="material-icons notranslate icon">{{ button.icon }}</i> {{ button.label }}
                </button>
            </div>
            <h4 style="cursor: pointer; margin: 8px 0 4px;" @click="toggle('signals')">Try signals</h4>
            <div v-if="ui.open.signals">
                <div v-if="ui.canDuo || ui.duo.on" style="display: flex; align-items: center; gap: 4px; margin-bottom: 4px;">
                    <label style="display: inline-flex; align-items: center; gap: 2px;" title="Plays both roles side by side, the way the game does">
                        <input type="checkbox" :checked="ui.duo.on" @change="toggleDuo()"> Duo preview
                    </label>
                    <template v-if="ui.duo.on">
                        <button type="button" :title="ui.duo.playing ? 'Pause' : 'Play'" @click="playDuo(!ui.duo.playing)"><i class="material-icons notranslate icon">{{ ui.duo.playing ? 'pause' : 'play_arrow' }}</i></button>
                        <input type="range" style="flex: 1;" min="0" :max="ui.duo.length" step="0.01" :value="ui.duo.time" @input="scrubDuo($event)">
                        <span style="flex: none; width: 44px; text-align: right;">{{ ui.duo.time.toFixed(2) }}s</span>
                        <input type="number" class="dark_bordered" style="flex: none; width: 56px;" min="0.25" step="0.25" :value="ui.duo.length" @change="lengthDuo($event)" title="How many seconds the timeline shows. The duo keeps playing until both roles finish.">
                    </template>
                </div>
                <p v-if="ui.duo.note" style="margin: 0 0 4px;">{{ ui.duo.note }}</p>
                <div v-if="ui.canPet || ui.pet.on" style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 4px;">
                    <label style="display: inline-flex; align-items: center; gap: 2px;" title="Plays an interaction on two pets, the way the game does">
                        <input type="checkbox" :checked="ui.pet.on" @change="togglePetPlay()"> Two pets
                    </label>
                    <select v-if="ui.pet.interactions.length > 1" class="dark_bordered" :value="ui.pet.interaction" @change="choosePetInteraction($event)">
                        <option v-for="id in ui.pet.interactions" :key="id" :value="id">{{ ui.interactionLabels[id] || id }}</option>
                    </select>
                    <template v-if="ui.pet.on">
                        <button type="button" :title="ui.pet.playing ? 'Pause' : 'Play'" @click="playPetRoles(!ui.pet.playing)"><i class="material-icons notranslate icon">{{ ui.pet.playing ? 'pause' : 'play_arrow' }}</i></button>
                        <input type="range" style="flex: 1;" min="0" :max="ui.pet.length" step="0.01" :value="ui.pet.time" @input="scrubPetRoles($event)">
                        <span style="flex: none; width: 44px; text-align: right;">{{ ui.pet.time.toFixed(2) }}s</span>
                    </template>
                </div>
                <p v-if="ui.pet.note" style="margin: 0 0 4px;">{{ ui.pet.note }}</p>
                <div v-if="ui.canLive" style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 4px;">
                    <label style="display: inline-flex; align-items: center; gap: 2px;" title="Plays it the way the game does, with reactions and swinging parts">
                        <input type="checkbox" :checked="ui.live.on" @change="toggleLive()"> Live preview
                    </label>
                    <button type="button" v-for="item in ui.moves" :key="item.id" :title="item.title" @click="move(item.id)">{{ item.label }}</button>
                    <label style="display: inline-flex; align-items: center; gap: 2px;" title="Plays sound keyframes and effect sounds">
                        <input type="checkbox" :checked="!ui.muted" @change="toggleSound()"> Sound
                    </label>
                </div>
                <div v-if="ui.live.on && ui.live.effects.length" style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 4px;">
                    <span style="flex: none;">Play effect:</span>
                    <button type="button" v-for="name in ui.live.effects" :key="name" :title="'Plays ' + name + ' once, the way the game does'" @click="playEffect(name)">{{ effectLabel(name) }}</button>
                </div>
                <p v-if="ui.live.on && ui.live.colorway" style="margin: 0 0 4px;">Colorway: {{ ui.live.colorway }}</p>
                <p v-if="ui.live.note" style="margin: 0 0 4px;">{{ ui.live.note }}</p>
                <p v-if="ui.soundNote && !ui.muted" style="margin: 0 0 4px;">{{ ui.soundNote }}</p>
                <label v-for="control in ui.signals" v-if="control.toggle" :key="control.name" style="display: inline-flex; align-items: center; gap: 2px; margin-right: 8px;">
                    <input type="checkbox" :checked="!!ui.values[control.name]" @change="flip(control.name, control)"> {{ control.label }}
                </label>
                <div v-for="control in ui.signals" v-if="!control.toggle" :key="control.name + '_slider'" style="display: flex; align-items: center; gap: 6px;">
                    <span style="flex: none; min-width: 110px;">{{ control.label }}</span>
                    <input type="range" style="flex: 1;" :min="control.min" :max="control.max" :step="control.step" :value="ui.values[control.name]" @input="slide(control.name, $event)">
                    <input v-if="!control.names" type="number" class="dark_bordered" style="flex: none; width: 56px;" :step="control.step" :value="ui.values[control.name]" @change="slide(control.name, $event)">
                    <span v-else style="flex: none; min-width: 36px; text-align: right;">{{ valueText(control, ui.values[control.name]) }}</span>
                </div>
                <div v-for="control in ui.host" :key="control.name" style="display: flex; align-items: center; gap: 6px;">
                    <span style="flex: none; min-width: 110px;">{{ control.label }}</span>
                    <select v-if="control.options" class="dark_bordered" style="flex: 1;" :value="ui.hostValues[control.name]" @change="host(control.name, $event.target.value)">
                        <option v-for="option in control.options" :value="option.value">{{ option.label }}</option>
                    </select>
                    <input v-else-if="control.toggle" type="checkbox" :checked="!!ui.hostValues[control.name]" @change="host(control.name, ui.hostValues[control.name] ? 0 : 1)">
                    <input v-else type="range" style="flex: 1;" :min="control.min" :max="control.max" :step="control.step" :value="ui.hostValues[control.name]" @input="host(control.name, $event.target.value)">
                </div>
                <button v-if="ui.equips" type="button" @click="wearAgain()" title="Plays what happens when you put it on">Wear again</button>
                <button type="button" @click="reset()">Reset</button>
            </div>
            <h4 style="cursor: pointer; margin: 8px 0 4px;" @click="toggle('colors')">Palette</h4>
            <div v-if="ui.open.colors">
                <p v-if="!ui.swatches.length" style="margin: 0;">No palette colors yet.</p>
                <div v-for="(ramp, index) in ui.swatches" :key="index" style="display: flex; gap: 2px; margin-bottom: 2px;">
                    <div v-for="(swatch, t) in ramp" :key="t" :title="swatch.slot + ' ' + (t + 1)" @click="paint(swatch.tone)" :style="{ background: swatch.color, width: '20px', height: '20px', cursor: 'pointer', border: '1px solid var(--color-border)' }"></div>
                </div>
            </div>
            <h4 style="cursor: pointer; margin: 8px 0 4px;" @click="toggle('checks')">Checks <span style="opacity: 0.7;">{{ ui.checks.headline }}</span></h4>
            <ul v-if="ui.open.checks" style="margin: 0; padding: 0; list-style: none;">
                <li v-for="(row, index) in ui.checks.rows" :key="index" style="display: flex; gap: 4px; padding: 2px 0;">
                    <i class="material-icons notranslate icon" :style="{ color: row.level === 'error' ? 'var(--color-error, #e85050)' : row.level === 'warning' ? 'var(--color-warning, #e8b050)' : 'inherit' }">{{ row.level === 'info' ? 'info' : row.level }}</i>
                    <span>{{ row.text }}</span>
                </li>
            </ul>
            <h4 v-if="ui.checks.cost.length" style="cursor: pointer; margin: 8px 0 4px;" @click="toggle('cost')">Cost</h4>
            <div v-if="ui.open.cost">
                <div v-for="row in ui.checks.cost" :key="row.label" style="padding: 2px 0;">
                    <div style="display: flex; gap: 6px;"><span style="flex: 1;">{{ row.label }}</span><span :style="{ color: row.over ? 'var(--color-error, #e85050)' : 'inherit' }">{{ row.value }}</span></div>
                    <div v-if="row.percent !== null" style="height: 4px; background: var(--color-back);"><div :style="{ width: row.percent + '%', height: '100%', background: row.over ? 'var(--color-error, #e85050)' : 'var(--color-accent)' }"></div></div>
                </div>
            </div>
        </div>
    `,
}

export function registerCosmeticPanel() {
    if (panel) return
    panel = new Panel(PANEL_ID, {
        name: 'PolyPlus',
        icon: 'auto_awesome',
        condition: { formats: cosmeticFormatIds() },
        default_side: 'right',
        default_position: { slot: 'right_bar', sidebar_index: 0, height: 480 },
        growable: true,
        component: component as any,
    } as any)
    hooks = [
        onChecks(sync),
        cosmeticState.on(sync),
        onLiveChange(sync),
        onDuoChange(sync),
        onPetPlayChange(sync),
        onSoundChange(sync),
        onEngineReady(() => {
            sync()
            refreshChecks()
        }),
    ]
    sync()
}

export function syncCosmeticPanel() {
    sync()
}

export function unregisterCosmeticPanel() {
    disposeAll(hooks)
    panel?.delete()
    panel = null
}
