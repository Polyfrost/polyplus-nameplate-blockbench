import type { CosmeticData, CosmeticKind } from './data'

export interface PanelButton {
    action: string
    label: string
    icon: string
    kinds?: CosmeticKind[]
}

export interface HostOption {
    value: number
    label: string
}

export interface HostControl {
    name: string
    label: string
    kinds: CosmeticKind[]
    options?: HostOption[]
    choices?: (data: CosmeticData) => HostOption[]
    initial?: number
    min?: number
    max?: number
    step?: number
    toggle?: boolean
    shown?: (data: CosmeticData, host: Readonly<Record<string, number>>) => boolean
}

export interface SettingsForm {
    form: Record<string, unknown>
    save(form: Record<string, any>, data: CosmeticData): void
}

export type SettingsSection = (data: CosmeticData) => SettingsForm

export const PANEL_BUTTONS: PanelButton[] = [
    { action: 'polyplus_cosmetic_settings', label: 'Settings', icon: 'settings' },
    { action: 'polyplus_cosmetic_reactions', label: 'Reactions', icon: 'bolt' },
    { action: 'polyplus_cosmetic_spring', label: 'Spring', icon: 'waves' },
    { action: 'polyplus_cosmetic_colors', label: 'Colors', icon: 'palette' },
    { action: 'polyplus_cosmetic_export', label: 'Export', icon: 'archive' },
]

export const HOST_CONTROLS: HostControl[] = []

export const SETTINGS_SECTIONS: SettingsSection[] = []

export function hostOptions(control: HostControl, data: CosmeticData): HostOption[] | undefined {
    return control.choices ? control.choices(data) : control.options
}

export function isHostShown(control: HostControl, data: CosmeticData, host: Readonly<Record<string, number>>): boolean {
    return !control.shown || control.shown(data, host)
}

export function shownHostControls(kind: CosmeticKind, data: CosmeticData, host: Readonly<Record<string, number>>): HostControl[] {
    return HOST_CONTROLS.filter((control) => control.kinds.includes(kind) && isHostShown(control, data, host))
}

export function isDiscreteHost(name: string): boolean {
    return HOST_CONTROLS.some((control) => control.name === name && (!!control.toggle || !!control.options || !!control.choices))
}

export function hostInitial(name: string, kind: CosmeticKind | null = null): number {
    const control = HOST_CONTROLS.find((candidate) => candidate.name === name && candidate.initial !== undefined && (!kind || candidate.kinds.includes(kind)))
    return control?.initial ?? 0
}

export function addTo<T>(list: T[], ...items: T[]): () => void {
    list.push(...items)
    return () => {
        for (const item of items) {
            const at = list.indexOf(item)
            if (at >= 0) list.splice(at, 1)
        }
    }
}
