import { limited } from '../elements/limits'
import { currentFps, currentLoopFrames, secondsText } from '../format'
import type { Slot } from '../model'
import { pickedRgbHex } from '../palette/color'
import { readNameplate } from '../palette/state'
import { plural } from '../util/text'
import { slotTrack } from './compile'
import { focusSlot, ownColors, putKey, scopedMotion, setSlotEffect, setSlotMotion } from './edit'
import { ColorSpan, currentSpan } from './scope'
import { keysFlash, safeCycle } from './flash'
import {
    EFFECTS,
    EFFECT_ORDER,
    EffectId,
    EffectOptions,
    ONE_SHOT_EFFECTS,
    REACTION_EFFECTS,
    SPEED_NAMES,
    Speed,
    bestRainbowCount,
    buildEffect,
    effectOf,
    isCycleEffect,
    isPulseEffect,
    picksColor,
    pulseKeys,
    pulseLengths,
} from './presets'
import { colorsAt, resolveColor, resolveKeyColor } from './resolve'
import { COLOR_BASE, COLOR_EASES, CYCLE_MODES, ColorEase, EASE_NAMES, MODE_NAMES, PaletteMotion, baseColors, isBaseColor, sortKeys } from './types'

const DEFAULT_FADE_TO = '#FFFFFF'
const MIN_RAINBOW_SHADES = 2
const MIN_SHINE_SHADES = 3
const MAX_EFFECT_SHADES = 16
const DEFAULT_EFFECT_SHADES = 6

function findSlot(slotId: string): Slot | undefined {
    return readNameplate().palette.slots.find((slot) => slot.id === slotId)
}

function options<T extends string>(names: Record<T, string>, order: T[]): Record<string, string> {
    const result: Record<string, string> = {}
    for (const key of order) result[key] = names[key]
    return result
}

function slowerPulse(slot: Slot, motion: PaletteMotion, loop: number): { motion: PaletteMotion, safe: boolean } {
    const palette = readNameplate().palette
    const test = (candidate: PaletteMotion) => {
        const track = slotTrack({ ...slot, animation: candidate }, palette, loop).track
        return !track || !keysFlash(slot.id, track)
    }
    if (test(motion) || motion.kind !== 'keys') return { motion, safe: true }
    const own = motion.keys[0].colors
    const peak = motion.keys[1]?.colors ?? own
    const period = motion.keys.length > 2 ? motion.keys[2].frame : loop
    for (const length of pulseLengths(loop).filter((value) => value > period)) {
        const candidate: PaletteMotion = { kind: 'keys', keys: pulseKeys(own, peak, loop, length) }
        if (test(candidate)) return { motion: candidate, safe: true }
    }
    return { motion, safe: false }
}

function effectOptions(result: any, shades: number, shine: boolean): EffectOptions {
    return {
        effect: result.effect as EffectId,
        speed: (result.speed as Speed) ?? 'medium',
        mode: CYCLE_MODES.includes(result.mode) ? result.mode : 'forward',
        shades,
        shine,
        to: pickedRgbHex(result.to, DEFAULT_FADE_TO),
    }
}

function applyScoped(slot: Slot, result: any, span: ColorSpan) {
    const chosen = effectOptions(result, slot.ramp.length, false)
    const built = buildEffect(chosen, { ...slot, animation: scopedMotion(span.animation, slot) }, readNameplate().palette, span.length, currentFps())
    setSlotMotion(slot.id, built.motion, `${EFFECTS[chosen.effect].name} on ${slot.name} in ${span.name}`, span.animation)
    focusSlot(slot.id)
}

function chosenShades(effect: EffectId, result: any): number {
    if (effect === 'rainbow') return limited(result.rainbow_shades, MIN_RAINBOW_SHADES, MAX_EFFECT_SHADES, DEFAULT_EFFECT_SHADES, 'Rainbow shades')
    if (effect === 'shimmer' && result.shine === true) return limited(result.shine_shades, MIN_SHINE_SHADES, MAX_EFFECT_SHADES, DEFAULT_EFFECT_SHADES, 'Shine shades')
    return DEFAULT_EFFECT_SHADES
}

function apply(slot: Slot, result: any) {
    const loop = currentLoopFrames()
    const fps = currentFps()
    const effect = result.effect as EffectId
    const chosen = effectOptions(result, chosenShades(effect, result), result.shine === true)
    const built = buildEffect(chosen, slot, readNameplate().palette, loop, fps)
    let motion = built.motion
    let safe = true
    if (motion?.kind === 'cycle') {
        const checked = safeCycle(slot.id, motion, built.ramp, loop)
        safe = checked.safe
        if (checked.motion.every !== motion.every) {
            Blockbench.showQuickMessage(`Slowed down to one shade every ${checked.motion.every} frames, so it doesn't flash too fast`, 2600)
        }
        motion = checked.motion
    } else if (motion && isPulseEffect(effect)) {
        const checked = slowerPulse(slot, motion, loop)
        safe = checked.safe
        if (checked.motion !== motion) Blockbench.showQuickMessage('Slowed down so it doesn\'t flash too fast', 2600)
        motion = checked.motion
    }
    setSlotEffect(slot.id, motion, built.ramp, `${EFFECTS[effect].name} on ${slot.name}`)
    if (!safe) Blockbench.showQuickMessage('This still flashes too fast. Use shades closer in brightness. See Checks.', 3200)
    focusSlot(slot.id)
}

export function openEffectDialog(slotId: string, span: ColorSpan = currentSpan()): Dialog | undefined {
    const slot = findSlot(slotId)
    if (!slot) return
    const scoped = !!span.animation
    const loop = span.length
    const fps = currentFps()
    const order = scoped ? (span.oneShot ? ONE_SHOT_EFFECTS : REACTION_EFFECTS) : EFFECT_ORDER
    const motion = scopedMotion(span.animation, slot)
    const current = scoped && !motion ? order[0] : effectOf(motion)
    const about = scoped
        ? `Pick how '${slot.name}' changes while '${span.name}' plays (${plural(loop, 'frame')}, ${secondsText(loop, fps)}).`
        : `Pick how '${slot.name}' changes over the loop (${loop} frames, ${secondsText(loop, fps)}).`
    const form: Record<string, any> = {
        about: { type: 'info', text: about },
        effect: { type: 'select', label: 'Style', options: Object.fromEntries(order.map((id) => [id, EFFECTS[id].name])), value: current },
    }
    for (const id of order) {
        form[`help_${id}`] = { type: 'info', text: EFFECTS[id].help, condition: (values: any) => values.effect === id }
    }
    Object.assign(form, {
        speed: {
            type: 'select',
            label: 'Speed',
            options: SPEED_NAMES,
            value: 'medium',
            condition: (values: any) => isCycleEffect(values.effect) || isPulseEffect(values.effect),
            description: 'Speeds that would flash too fast are slowed down for you',
        },
        mode: {
            type: 'select',
            label: 'Direction',
            options: options(MODE_NAMES, CYCLE_MODES),
            value: motion?.kind === 'cycle' ? motion.mode : 'forward',
            condition: (values: any) => isCycleEffect(values.effect),
        },
        rainbow_shades: {
            type: 'number',
            label: 'Rainbow shades',
            step: 1,
            value: bestRainbowCount(loop, 'forward'),
            condition: (values: any) => values.effect === 'rainbow',
            description: 'More shades make smoother color changes. The number is picked to fit the loop',
        },
        shine: {
            type: 'checkbox',
            label: 'Make the shades a shine',
            value: false,
            condition: (values: any) => !scoped && values.effect === 'shimmer',
            description: 'Replaces the shades with one bright shade between darker ones, so a single highlight travels',
        },
        shine_shades: {
            type: 'number',
            label: 'Shine shades',
            step: 1,
            value: Math.max(4, Math.min(MAX_EFFECT_SHADES, slot.ramp.length)),
            condition: (values: any) => values.effect === 'shimmer' && values.shine === true,
        },
        to: { type: 'color', label: 'Color', value: scoped ? '#FF4040' : DEFAULT_FADE_TO, condition: (values: any) => picksColor(values.effect) },
        replace: {
            type: 'info',
            text: 'This replaces the shades of this color (colorways use them too). Painted pixels move to the matching new shade. Undo brings the old shades back.',
            condition: (values: any) => values.effect === 'rainbow' || (values.effect === 'shimmer' && values.shine === true),
        },
    })
    const dialog = new Dialog({
        id: 'polyplus_nameplate_color_effect',
        title: scoped ? `${slot.name} in ${span.name}` : `Animate ${slot.name}`,
        width: 460,
        form,
        onConfirm(result: any) {
            const fresh = findSlot(slotId)
            if (!fresh) return
            if (scoped) applyScoped(fresh, result, span)
            else apply(fresh, result)
        },
    } as any)
    dialog.show()
    return dialog
}

function chosenColors(slot: Slot, result: any, original: string[]): string[] {
    if (result.own === true) return baseColors(slot.ramp.length)
    const palette = readNameplate().palette
    return slot.ramp.map((_, tone) => {
        const before = original[Math.min(tone, original.length - 1)] ?? COLOR_BASE
        const shown = resolveKeyColor(before, slot, tone, palette, null)
        const picked = pickedRgbHex(result[`tone_${tone}`], shown)
        return picked === shown ? before : picked
    })
}

function shownColors(slot: Slot, frame: number, loop: number, span: ColorSpan): string[] {
    const palette = readNameplate().palette
    const own = ownColors(slot)
    const shown = colorsAt(palette, slot, scopedMotion(span.animation, slot), frame, loop, null)
    return shown.map((color, tone) => (resolveColor(own[tone], palette, null) === color ? COLOR_BASE : color))
}

function isOwn(slot: Slot, colors: string[]): boolean {
    const own = ownColors(slot)
    return slot.ramp.every((_, tone) => {
        const color = colors[Math.min(tone, colors.length - 1)]
        return isBaseColor(color) || color === own[tone]
    })
}

export function openKeyDialog(slotId: string, frame: number, span: ColorSpan = currentSpan()): Dialog | undefined {
    const slot = findSlot(slotId)
    if (!slot) return
    const loop = span.length
    if (frame !== 0 && loop < 2) return
    const motion = scopedMotion(span.animation, slot)
    const keys = motion?.kind === 'keys' ? sortKeys(motion.keys) : []
    const existing = keys.find((key) => key.frame === frame)
    const palette = readNameplate().palette
    const original = existing?.colors ?? shownColors(slot, frame, loop, span)
    const usesOwn = isOwn(slot, original)
    const form: Record<string, any> = {
        about: {
            type: 'info',
            text: (existing
                ? `The colors of '${slot.name}' at frame ${frame}.`
                : `Add a keyframe: the colors '${slot.name}' has at frame ${frame}. Between keyframes the colors jump or fade.`) +
                (span.animation ? ` This keyframe belongs to '${span.name}', frames 0 to ${loop - 1}.` : ''),
        },
    }
    if (frame !== 0) {
        form.frame = { type: 'number', label: 'Frame', step: 1, value: frame }
        form.ease = {
            type: 'select',
            label: 'From the keyframe before',
            options: options(EASE_NAMES, COLOR_EASES),
            value: existing?.ease ?? 'linear',
            description: 'Jump switches at this frame. Fade blends evenly. Smooth fade starts and ends slowly',
        }
    }
    form.own = {
        type: 'checkbox',
        label: "Base: each colorway's own colors",
        value: usesOwn,
        description: 'Each colorway keeps its own colors at this keyframe',
    }
    slot.ramp.forEach((_, tone) => {
        form[`tone_${tone}`] = {
            type: 'color',
            label: `Shade ${tone + 1}`,
            value: resolveKeyColor(original[Math.min(tone, original.length - 1)] ?? COLOR_BASE, slot, tone, palette, null),
            condition: (values: any) => values.own !== true,
        }
    })
    const dialog = new Dialog({
        id: 'polyplus_nameplate_color_key',
        title: existing ? `Edit Keyframe at Frame ${frame}` : `Add Keyframe at Frame ${frame}`,
        width: 420,
        form,
        onConfirm(result: any) {
            const fresh = findSlot(slotId)
            if (!fresh) return
            const target = frame === 0 ? 0 : limited(result.frame, 1, loop - 1, frame, 'Frame')
            const ease: ColorEase = frame === 0 ? existing?.ease ?? 'step' : COLOR_EASES.includes(result.ease) ? result.ease : 'linear'
            putKey(slotId, target, chosenColors(fresh, result, original), ease, existing ? frame : target, span.animation)
        },
    } as any)
    dialog.show()
    return dialog
}
