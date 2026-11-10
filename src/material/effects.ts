import { currentBundle } from '../compile'
import { readLayers } from '../elements/read'
import { NameplateEffectInfo, NameplatePreview, NameplateTagState, stateOf } from '../engine'
import { loadFiles, previewUi } from '../preview'
import { toneHints } from './tone'

export type EffectInfo = NameplateEffectInfo

export interface EffectsView {
    preview: NameplatePreview
    loop: number
    fps: number
    variants: string[]
    effects: EffectInfo[]
}

export interface CurveSpec {
    animation: string
    kind: 'loop' | 'while' | 'shot'
    reaction?: string
    length: number
}

const cache: { files: Record<string, string> | null, view: EffectsView | null } = { files: null, view: null }

function load(files: Record<string, string>): EffectsView | null {
    const loaded = loadFiles(files)
    const preview = loaded.preview ?? loaded.draft?.() ?? null
    if (!preview) return null
    return { preview, loop: preview.loop, fps: preview.fps, variants: preview.variants, effects: preview.effects() }
}

export function effectsView(): EffectsView | null {
    try {
        const bundle = currentBundle()
        if (cache.files === bundle.files) return cache.view
        cache.files = bundle.files
        cache.view = Object.keys(bundle.files).length ? load(bundle.files) : null
        return cache.view
    } catch (error) {
        console.error('[polyplus_nameplate] reading effect details failed', error)
        cache.view = null
        return null
    }
}

export function effectInfoOf(node: any): EffectInfo | null {
    const view = effectsView()
    const id = view && node?.uuid ? readLayers().find((layer) => layer.uuid === String(node.uuid))?.id : null
    return id ? view!.effects.find((effect) => effect.layer === id) ?? null : null
}

function shownVariant(view: EffectsView): string {
    return view.variants.includes(previewUi.variant) ? previewUi.variant : view.variants[0] ?? ''
}

function shotState(preview: NameplatePreview, variant: string, animation: string): NameplateTagState | null {
    try {
        const record = preview.record()
        record.update('curve', variant, 1, [], 0, 0)
        record.update('curve', variant, 0, [], 0, 0)
        record.fire('curve', animation, 0)
        return record.update('curve', variant, 0, [], 0, 0)
    } catch {
        return null
    }
}

export function paramCurve(layer: string, param: string, spec: CurveSpec): number[] | null {
    const view = effectsView()
    if (!view) return null
    const variant = shownVariant(view)
    try {
        let state: NameplateTagState | null = null
        if (spec.kind === 'while' && spec.reaction) state = stateOf([spec.reaction])
        if (spec.kind === 'shot') state = shotState(view.preview, variant, spec.animation)
        const count = Math.max(1, Math.min(600, spec.length))
        return view.preview.paramCurve(layer, param, variant, 0, count, state)
    } catch (error) {
        console.error('[polyplus_nameplate] drawing a setting curve failed', error)
        return null
    }
}

export function curveImage(values: number[], width = 240, height = 44): string | null {
    if (typeof document === 'undefined' || values.length === 0) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const low = Math.min(...values)
    const high = Math.max(...values)
    const span = high - low || 1
    const pad = 4
    const x = (i: number) => pad + (values.length === 1 ? 0 : (i * (width - pad * 2)) / (values.length - 1))
    const y = (value: number) => height - pad - ((value - low) / span) * (height - pad * 2)
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.45)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1)
    ctx.strokeStyle = '#3e90ff'
    ctx.lineWidth = 2
    ctx.beginPath()
    values.forEach((value, i) => (i === 0 ? ctx.moveTo(x(i), y(value)) : ctx.lineTo(x(i), y(value))))
    ctx.stroke()
    try {
        return canvas.toDataURL('image/png')
    } catch {
        return null
    }
}

export function sampleToneHint(material: string): string[] {
    const bundle = currentBundle()
    return toneHints(bundle.files, bundle.binary ?? {}, material)[material] ?? []
}
