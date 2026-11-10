import type { NameplateData, Slot } from '../model'
import { setBlend } from '../palette/blend'
import { resizeMove } from '../palette/refs'
import { commitShades } from '../palette/shades'
import { commit, readNameplate } from '../palette/state'
import { motionIn, writeMotion } from './reaction'
import { createListenerSet } from '../util/events'
import { cloneJson } from '../util/json'
import { undoEdit } from '../util/undo'
import { resolveKeyColor } from './resolve'
import { ColorEase, ColorKey, CycleMotion, PaletteMotion, baseColors, isBaseColor, sortKeys, toneRef } from './types'

type ColorScope = any | null

const listeners = createListenerSet<[string]>('color animation focus failed')

export function onFocusSlot(listener: (slotId: string) => void): () => void {
    return listeners.on(listener)
}

export function focusSlot(slotId: string) {
    listeners.notify(slotId)
}

function findSlot(plate: NameplateData, slotId: string): Slot | undefined {
    return plate.palette.slots.find((slot) => slot.id === slotId)
}

function setOn(slot: Slot, motion: PaletteMotion | undefined) {
    if (motion) slot.animation = cloneJson(motion)
    else delete slot.animation
}

function changeMotion(
    scope: ColorScope,
    slotId: string,
    label: string,
    change: (motion: PaletteMotion | undefined, slot: Slot) => PaletteMotion | undefined | null,
): boolean {
    let changed = false
    if (!scope) {
        commit(label, (plate) => {
            const slot = findSlot(plate, slotId)
            if (!slot) return
            const next = change(slot.animation, slot)
            if (next === null) return
            setOn(slot, next)
            changed = true
        })
        return changed
    }
    const slot = findSlot(readNameplate(), slotId)
    if (!slot) return false
    const next = change(motionIn(scope, slotId, slot.ramp.length), slot)
    if (next === null) return false
    undoEdit({ animations: [scope] }, label, () => writeMotion(scope, slotId, next))
    return true
}

export function dropMissingSlotMotion(scope: ColorScope, slotId: string): boolean {
    if (!scope || readNameplate().palette.slots.some((slot) => slot.id === slotId)) return false
    if (motionIn(scope, slotId, 1) === undefined) return false
    undoEdit({ animations: [scope] }, 'Remove color change', () => writeMotion(scope, slotId, undefined))
    return true
}

export function scopedMotion(scope: ColorScope, slot: Slot): PaletteMotion | undefined {
    return scope ? motionIn(scope, slot.id, slot.ramp.length) : slot.animation
}

export function setSlotMotion(slotId: string, motion: PaletteMotion | undefined, label = motion ? 'Animate color' : 'Stop color animation', scope: ColorScope = null): boolean {
    return changeMotion(scope, slotId, label, () => motion)
}

export function setSlotEffect(slotId: string, motion: PaletteMotion | undefined, ramp: string[] | null, label: string): boolean {
    if (!readNameplate().palette.slots.some((slot) => slot.id === slotId)) return false
    let changed = false
    commitShades(label, (plate) => {
        const slot = findSlot(plate, slotId)
        if (!slot) return null
        changed = true
        if (!ramp) return null
        const move = resizeMove(slot, slot.ramp.length, ramp.length)
        slot.ramp = ramp.slice()
        setBlend(slot, undefined)
        for (const overrides of Object.values(plate.palette.colorways)) delete overrides[slotId]
        return move
    }, {
        repaint: !!ramp,
        finish(plate) {
            const slot = findSlot(plate, slotId)
            if (slot) setOn(slot, motion)
        },
    })
    return changed
}

function editKeys(slotId: string, label: string, change: (keys: ColorKey[], slot: Slot) => ColorKey[] | null, scope: ColorScope = null) {
    changeMotion(scope, slotId, label, (motion, slot) => {
        const keys = motion?.kind === 'keys' ? motion.keys.map((key) => ({ ...key, colors: key.colors.slice() })) : []
        const next = change(keys, slot)
        if (!next) return null
        return next.length === 0 ? undefined : { kind: 'keys', keys: sortKeys(next) }
    })
}

export function ownColors(slot: Slot): string[] {
    return slot.ramp.map((_, tone) => toneRef(slot.id, tone))
}

export function putKey(slotId: string, frame: number, colors: string[] | null, ease: ColorEase, replaceFrame = frame, scope: ColorScope = null) {
    editKeys(slotId, 'Set color keyframe', (keys, slot) => {
        const old = keys.find((key) => key.frame === replaceFrame)
        const kept = keys.filter((key) => key.frame !== replaceFrame && key.frame !== frame)
        const values = colors ?? old?.colors ?? baseColors(slot.ramp.length)
        kept.push({ frame, colors: values.slice(0, Math.max(1, slot.ramp.length)), ease })
        if (!kept.some((key) => key.frame === 0)) kept.push({ frame: 0, colors: baseColors(slot.ramp.length), ease: 'step' })
        return kept
    }, scope)
}

export function setKeyBase(slotId: string, frame: number, base: boolean, scope: ColorScope = null) {
    const palette = readNameplate().palette
    editKeys(slotId, base ? 'Use base colors' : 'Use fixed colors', (keys, slot) => {
        const key = keys.find((entry) => entry.frame === frame)
        if (!key) return null
        const next = base
            ? baseColors(slot.ramp.length)
            : key.colors.map((color, tone) => (isBaseColor(color) ? resolveKeyColor(color, slot, tone, palette, null) : color))
        if (next.length === key.colors.length && next.every((color, tone) => color === key.colors[tone])) return null
        key.colors = next
        return keys
    }, scope)
}

export function removeKey(slotId: string, frame: number, scope: ColorScope = null) {
    editKeys(slotId, 'Remove color keyframe', (keys) => {
        const kept = keys.filter((key) => key.frame !== frame)
        return kept.length === keys.length ? null : kept
    }, scope)
}

export function dropLateKeys(slotId: string, loop: number, scope: ColorScope = null) {
    editKeys(slotId, scope ? 'Remove keyframes after the end' : 'Remove keyframes after the loop', (keys) => {
        const kept = keys.filter((key) => key.frame < loop)
        return kept.length === keys.length ? null : kept
    }, scope)
}

export function setCycle(slotId: string, change: (motion: CycleMotion) => void, scope: ColorScope = null) {
    changeMotion(scope, slotId, 'Change color cycle', (motion) => {
        if (motion?.kind !== 'cycle') return null
        const next: CycleMotion = { ...motion }
        change(next)
        return next
    })
}
