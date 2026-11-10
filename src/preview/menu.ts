import { defineAction } from '../util/actions'
import { wholeClamped } from '../util/num'
import { FORMAT_ID } from '../model'
import { lineChoice, mainSpec, nameWidthOf, previewUi, redraw, referenceName, setLineChoice, syncNameWidth } from '../preview'
import {
    BACKDROPS,
    colorText,
    COMPARES,
    GameLook,
    keptOptions,
    LIGHTS,
    LOOKS,
    MAX_PADDING,
    PRESETS,
    PreviewOptions,
    PreviewPreset,
    previewOptions,
    rankAdvance,
    resetOptions,
} from './options'

export const LOOK_SELECT = 'polyplus_nameplate_game_look'
export const OPTIONS_ACTION = 'polyplus_nameplate_preview_options'
export const OPTIONS_DIALOG = 'polyplus_nameplate_preview_options_dialog'
const LOOK_WIDTH = 120
const LINE_PITCH = 10

export const LINE_CHOICES: Record<string, string> = {
    '1': 'One line',
    '2': 'Two lines, name on top',
    '2b': 'Two lines, name below',
    '3': 'Three lines',
}

const menuState = { preset: '' }

interface OptionsForm {
    name?: string
    rank?: string
    rankColor?: unknown
    lines?: string
    above?: string
    below?: string
    polyNametag?: boolean
    padX?: number
    padY?: number
    backgroundColor?: unknown
    backgroundOpacity?: number
}

interface Snapshot {
    options: PreviewOptions
    lines: number
    autoWidth: boolean
    nameWidth: number
    preset: string
}

function snapshot(): Snapshot {
    return {
        options: { ...previewOptions },
        lines: previewUi.lines,
        autoWidth: previewUi.autoWidth,
        nameWidth: previewUi.nameWidth,
        preset: menuState.preset,
    }
}

function restore(saved: Snapshot) {
    Object.assign(previewOptions, saved.options)
    previewUi.lines = saved.lines
    previewUi.autoWidth = saved.autoWidth
    previewUi.nameWidth = saved.nameWidth
    menuState.preset = saved.preset
    redraw(false)
}

export function currentPreset(): string {
    return menuState.preset
}

export function applyPreset(preset: PreviewPreset) {
    resetOptions({ ...keptOptions(), ...preset.options })
    previewUi.lines = preset.lines
    previewUi.autoWidth = true
    syncNameWidth()
    menuState.preset = preset.id
    redraw(false)
}

function presetWidth(preset: PreviewPreset): number {
    const { rank = '', name, above = '' } = preset.options
    const nameRun = rankAdvance(rank) + nameWidthOf(name ?? referenceName())
    return above ? Math.max(nameRun, nameWidthOf(above)) : nameRun
}

export function zoomFrame(columns: number, rows: number): { columns: number, rows: number } {
    if (!menuState.preset) return { columns, rows }
    const widest = Math.max(...PRESETS.map(presetWidth))
    const tallest = Math.max(...PRESETS.map((preset) => preset.lines))
    return {
        columns: columns + Math.max(0, widest - Math.max(0, ...(mainSpec().widths ?? []))),
        rows: rows + Math.max(0, tallest - previewUi.lines) * LINE_PITCH,
    }
}

export function presetById(id: string): PreviewPreset | undefined {
    return PRESETS.find((preset) => preset.id === id)
}

export function clearPreviewOptions() {
    resetOptions(keptOptions())
    previewUi.lines = 1
    previewUi.autoWidth = true
    syncNameWidth()
    menuState.preset = ''
}

export function resetPreviewOptions() {
    clearPreviewOptions()
    redraw(false)
}

export function setGameLook(look: string) {
    if (!(look in LOOKS)) return
    previewOptions.look = look as GameLook
    redraw(false)
}

export function setWorldOption<K extends 'backdrop' | 'light' | 'compare' | 'wardrobe'>(key: K, value: PreviewOptions[K]) {
    previewOptions[key] = value
    redraw(false)
}

function choices<K extends 'backdrop' | 'light' | 'compare'>(key: K, labels: Record<PreviewOptions[K], string>, icons: Record<string, string> = {}): any[] {
    return (Object.keys(labels) as PreviewOptions[K][]).map((value) => ({
        name: labels[value],
        icon: icons[value as string] ?? (previewOptions[key] === value ? 'radio_button_checked' : 'radio_button_unchecked'),
        marked: previewOptions[key] === value,
        click: () => setWorldOption(key, value),
    }))
}

function worldItems(): any[] {
    return [
        {
            name: 'World Behind the Tag',
            icon: 'landscape',
            description: 'Scenery behind the nameplate, to judge glows and contrast',
            children: () => choices('backdrop', BACKDROPS),
        },
        {
            name: 'Light',
            icon: 'light_mode',
            description: 'Effects with "Glows in the dark" stay bright. Everything else darkens',
            children: () => choices('light', LIGHTS),
        },
        {
            name: 'Compare Full and Basic Effects',
            icon: 'compare',
            description: 'Check that each effect looks the same in both. Basic effects run on 1.21.5 and older, and with shader packs',
            children: () => choices('compare', COMPARES),
        },
        {
            name: 'Wardrobe View',
            icon: previewOptions.wardrobe ? 'check_box' : 'check_box_outline_blank',
            description: 'Show the nameplate as the PolyPlus wardrobe does',
            marked: previewOptions.wardrobe,
            click: () => setWorldOption('wardrobe', !previewOptions.wardrobe),
        },
    ]
}

export function applyOptionsForm(form: OptionsForm) {
    const before = JSON.stringify(previewOptions) + lineChoice()
    const name = String(form.name ?? previewOptions.name)
    const renamed = name.trim() !== previewOptions.name.trim()
    previewOptions.name = name
    previewOptions.rank = String(form.rank ?? previewOptions.rank)
    previewOptions.rankColor = colorText(form.rankColor ?? previewOptions.rankColor, previewOptions.rankColor)
    setLineChoice(String(form.lines ?? lineChoice()))
    previewOptions.above = String(form.above ?? previewOptions.above)
    previewOptions.below = String(form.below ?? previewOptions.below)
    previewOptions.polyNametag = form.polyNametag === undefined ? previewOptions.polyNametag : !!form.polyNametag
    previewOptions.padX = wholeClamped(form.padX, 0, MAX_PADDING, previewOptions.padX)
    previewOptions.padY = wholeClamped(form.padY, 0, MAX_PADDING, previewOptions.padY)
    previewOptions.backgroundColor = colorText(form.backgroundColor ?? previewOptions.backgroundColor, previewOptions.backgroundColor)
    previewOptions.backgroundOpacity = wholeClamped(form.backgroundOpacity, 0, 100, previewOptions.backgroundOpacity)
    if (renamed) {
        previewUi.autoWidth = true
        syncNameWidth()
    }
    if (JSON.stringify(previewOptions) + lineChoice() !== before) menuState.preset = ''
    redraw(false)
}

const padded = (form: OptionsForm) => !!form.polyNametag
const ranked = (form: OptionsForm) => !!String(form.rank ?? '').trim()

function wholeField(label: string, value: number, max: number, condition: (form: OptionsForm) => boolean) {
    return { type: 'number', label, value, min: 0, max, step: 1, force_step: true, condition }
}

export function openOptionsDialog(): Dialog {
    const saved = snapshot()
    const dialog = new Dialog({
        id: OPTIONS_DIALOG,
        title: 'Preview Name, Rank and Padding',
        width: 520,
        form: {
            about: {
                type: 'info',
                text: 'These change only the preview.',
            },
            name: {
                type: 'text',
                label: 'Name',
                value: previewOptions.name,
                placeholder: referenceName(),
                description: 'Empty shows the example name',
            },
            rank: {
                type: 'text',
                label: 'Rank prefix',
                value: previewOptions.rank,
                placeholder: '[VIP] ',
                description: 'Text a server puts before the name, like "[VIP] " with its space',
            },
            rankColor: { type: 'color', label: 'Rank color', value: previewOptions.rankColor, condition: ranked },
            lines: {
                type: 'select',
                label: 'Lines',
                value: lineChoice(),
                options: LINE_CHOICES,
            },
            above: {
                type: 'text',
                label: 'Line above the name',
                value: previewOptions.above,
                condition: (form: OptionsForm) => form.lines === '2b' || form.lines === '3',
            },
            below: {
                type: 'text',
                label: 'Line below the name',
                value: previewOptions.below,
                condition: (form: OptionsForm) => form.lines === '2' || form.lines === '3',
            },
            polyNametag: {
                type: 'checkbox',
                label: 'PolyNametag background',
                value: previewOptions.polyNametag,
                description: "Show the tag with PolyNametag's background on",
            },
            padX: wholeField('Padding X (pixels)', previewOptions.padX, MAX_PADDING, padded),
            padY: wholeField('Padding Y (pixels)', previewOptions.padY, MAX_PADDING, padded),
            backgroundColor: { type: 'color', label: 'Background color', value: previewOptions.backgroundColor, condition: padded },
            backgroundOpacity: wholeField('Background opacity (%)', previewOptions.backgroundOpacity, 100, padded),
            paddingNote: {
                type: 'info',
                text: 'A nameplate that draws its own background hides this one.',
                condition: padded,
            },
        },
        onFormChange: applyOptionsForm,
        onConfirm: applyOptionsForm,
        onCancel() {
            restore(saved)
        },
    } as any)
    dialog.show()
    return dialog
}

function menuItems(): any[] {
    return [
        ...PRESETS.map((preset) => ({
            name: preset.name,
            icon: preset.icon,
            description: preset.description,
            marked: menuState.preset === preset.id,
            click: () => applyPreset(preset),
        })),
        '_',
        ...worldItems(),
        '_',
        {
            name: 'Name, Rank and Padding...',
            icon: 'edit',
            description: 'Type your own name, rank, extra lines and PolyNametag padding',
            click: () => openOptionsDialog(),
        },
        {
            name: 'Back to the Example Name',
            icon: 'restart_alt',
            description: 'One line, with no rank and no padding',
            click: () => resetPreviewOptions(),
        },
    ]
}

function menuAnchor(event?: Event): HTMLElement | 'mouse' {
    const target = event?.target as HTMLElement | null | undefined
    const tool = target && typeof target.closest === 'function' ? target.closest('.tool') : null
    return (tool as HTMLElement | null) ?? 'mouse'
}

export function openOptionsMenu(event?: Event) {
    new Menu(menuItems()).open(menuAnchor(event))
}

export function lookOptions(): Record<string, string> {
    return Object.fromEntries(Object.entries(LOOKS).map(([id, spec]) => [id, spec.label]))
}

export function makeOptionItems(): BarItem[] {
    const always = { formats: [FORMAT_ID] }
    const look = new BarSelect(LOOK_SELECT, {
        name: 'Game Look',
        description: 'Which game version or setting to preview',
        condition: always,
        width: LOOK_WIDTH,
        options: lookOptions(),
        value: previewOptions.look,
        onChange(self: BarSelect) {
            setGameLook(self.get())
        },
    })
    const options = defineAction(OPTIONS_ACTION, {
        name: 'Preview Options',
        icon: 'tune',
        category: 'view',
        condition: always,
        click: (event?: Event) => openOptionsMenu(event),
    })
    return [look, options]
}

export function syncOptionItems() {
    const look = (BarItems as any)[LOOK_SELECT] as BarSelect | undefined
    if (look && look.get?.() !== previewOptions.look) look.set?.(previewOptions.look)
}
