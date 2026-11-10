import { currentFps, loopFrames } from '../animate/dialog'
import type { NameplateData, VariantData } from '../model'
import { readNameplate } from '../palette/state'
import {
    applyBadgeKeys,
    applyTextKeys,
    badgeConfig,
    badgeValues,
    DIALOG_BADGE_KEYS,
    DIALOG_TEXT_KEYS,
    FormConfig,
    INHERIT,
    Result,
    textConfig,
    textValues,
} from './form'
import { openLetterProgram } from './program'
import { plateText, readBadgeOverride, readTextOverride, StyledVariant, TextMode, variantBadge, variantText } from './types'

const OWN = 'style_own'

function withValues(config: FormConfig, values: Result): FormConfig {
    for (const key of Object.keys(config)) {
        const entry = config[key]
        if (entry && typeof entry === 'object' && key in values) (entry as any).value = values[key]
    }
    return config
}

function editDialogProgram(inheritedMode: TextMode) {
    const dialog = (Dialog as any).open
    if (!dialog) return
    const form = dialog.getFormResult() as Result
    const fps = currentFps()
    openLetterProgram({
        mode: form.ts_mode === INHERIT ? inheritedMode : form.ts_mode,
        source: String(form.ts_motion ?? ''),
        fps,
        length: loopFrames(fps),
        reaction: false,
        variant: String(form.name ?? ''),
        switchMode: true,
        save: (source, mode) => dialog.setFormValues({ ts_motion: source ?? '', ...(mode ? { ts_mode: mode } : {}) }, false),
    })
}

export function variantStyleForm(plate: NameplateData, variant: VariantData | null): FormConfig {
    const own = variant as StyledVariant | null
    const text = variantText(plate as any, own)
    const badge = variantBadge(plate as any, own)
    const ownText = own?.text ?? null
    const ownBadge = own?.badge ?? null
    const shown = (result: Result) => !!result?.[OWN]
    const inheritedMode = plateText(plate as any).mode
    const config: FormConfig = {
        [OWN]: {
            type: 'checkbox',
            label: 'Own name text and badge',
            style: 'toggle_switch',
            value: !!(ownText && Object.keys(ownText).length) || !!(ownBadge && Object.keys(ownBadge).length),
            description: 'On: this variant can change the name color, shadow, outline, letters or badge',
        } as FormElementOptions,
        ...textConfig(text, ownText, { inherit: true, shown, inheritedMode, editProgram: () => editDialogProgram(inheritedMode) }),
        ...badgeConfig(badge, ownBadge, { inherit: true, shown }),
    }
    return withValues(config, { ...textValues(text, ownText, true), ...badgeValues(badge, ownBadge, true) })
}

export function variantStyleFrom(result: Result, previous: VariantData | null): StyledVariant {
    if (!result?.[OWN]) return {}
    const plate = readNameplate()
    const before = (previous ?? null) as StyledVariant | null
    const text: Record<string, any> = { ...readTextOverride(before?.text) }
    const badge: Record<string, any> = { ...readBadgeOverride(before?.badge) }
    applyTextKeys(text, DIALOG_TEXT_KEYS, result, true)
    const badgeKeys = [...DIALOG_BADGE_KEYS]
    if (result.bs_decoration === 'shadow' || result.bs_decoration === 'outline') badgeKeys.push('bs_deco_mode')
    applyBadgeKeys(badge, badgeKeys, result, true, variantBadge(plate as any, before))
    const style: StyledVariant = {}
    if (Object.keys(text).length) style.text = readTextOverride(text)
    if (Object.keys(badge).length) style.badge = readBadgeOverride(badge)
    return style
}
