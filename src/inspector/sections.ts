import { noteLimit } from '../elements/limits'
import { element } from '../util/dom'

export type FormConfig = Record<string, FormElementOptions | '_'>
export type Result = Record<string, any>

export interface SectionRule {
    id: string
    title: string
}

export interface SectionPlan {
    lead: SectionRule
    headings: Record<string, SectionRule>
    order: string[]
}

export interface FormSection {
    id: string
    title: string
    config: FormConfig
}

const MEMORY_KEY = 'polyplus_nameplate_inspector_sections'

let fallback: Record<string, boolean> = {}
let initialized = false

function memory(): any {
    return typeof StateMemory !== 'undefined' ? StateMemory : null
}

function stored(): Record<string, boolean> {
    const api = memory()
    if (!api) return fallback
    try {
        if (!initialized) {
            api.init(MEMORY_KEY, 'object')
            initialized = true
        }
        const value = api[MEMORY_KEY]
        return value && typeof value === 'object' ? value : {}
    } catch (error) {
        console.error('[polyplus_nameplate] could not read the inspector sections', error)
        return fallback
    }
}

export function isSectionOpen(key: string): boolean {
    return stored()[key] !== false
}

export function setSectionOpen(key: string, open: boolean) {
    const api = memory()
    const next = { ...stored(), [key]: open }
    if (!api) {
        fallback = next
        return
    }
    try {
        api[MEMORY_KEY] = next
        api.save(MEMORY_KEY)
    } catch (error) {
        fallback = next
        console.error('[polyplus_nameplate] could not save the inspector sections', error)
    }
}

function headingText(entry: FormElementOptions): string {
    return String((entry as any).text ?? '').replace(/\*\*/g, '').trim()
}

export function splitConfig(config: FormConfig, plan: SectionPlan): FormSection[] {
    const sections: FormSection[] = []
    const byId = new Map<string, FormSection>()
    let current: FormSection | null = null
    const open = (rule: SectionRule): FormSection => {
        const existing = byId.get(rule.id)
        if (existing) return existing
        const section: FormSection = { id: rule.id, title: rule.title, config: {} }
        byId.set(rule.id, section)
        sections.push(section)
        return section
    }
    for (const key of Object.keys(config)) {
        const entry = config[key]
        if (typeof entry === 'object' && entry.type === 'info' && (key.endsWith('_title') || key in plan.headings)) {
            const rule = plan.headings[key] ?? { id: key.replace(/_title$/, ''), title: headingText(entry) || key }
            const existed = byId.has(rule.id)
            current = open(rule)
            if (existed) current.config[key] = entry
            continue
        }
        if (!current) current = open(plan.lead)
        current.config[key] = entry
    }
    const rank = (id: string) => {
        const at = plan.order.indexOf(id)
        return at < 0 ? plan.order.length : at
    }
    return sections
        .map((section, index) => ({ section, index }))
        .sort((a, b) => rank(a.section.id) - rank(b.section.id) || a.index - b.index)
        .map((entry) => entry.section)
        .filter((section) => Object.keys(section.config).length > 0)
}

export function signatureOf(sections: FormSection[], prefix: string): string {
    const shape: Record<string, unknown> = {}
    for (const section of sections) {
        for (const key of Object.keys(section.config)) {
            const entry = section.config[key] as any
            shape[`${section.id}/${key}`] = entry && typeof entry === 'object' ? entry.options ?? entry.type : entry
        }
    }
    return `${prefix}|${JSON.stringify(shape)}`
}

function typedNumber(text: string): number {
    const parser = (globalThis as any).NumSlider?.MolangParser
    return parser ? Number(parser.parse(text)) : Number(text)
}

function noteRangeLimits(form: InputForm) {
    form.node.addEventListener('input', (event: Event) => {
        for (const element of Object.values<any>((form as any).form_data ?? {})) {
            const input = element?.numeric_input?.node?.querySelector('input')
            if (!input || input !== event.target) continue
            const { min, max, label, limit_advice: advice } = element.options
            noteLimit(typedNumber(input.value), min, max, String(label ?? ''), advice)
        }
    }, true)
}

export interface SectionView {
    node: HTMLElement
    body: HTMLElement
    extra: HTMLElement
}

export function sectionElement(key: string, title: string): SectionView {
    const node = document.createElement('div')
    node.className = 'np-section'
    node.setAttribute('section', key)
    const head = element('div', 'np-section-head', node)
    head.tabIndex = 0
    const arrow = element('i', '', head)
    element('span', 'np-section-title', head, title)
    const body = element('div', 'np-section-body', node)
    const extra = element('div', 'np-section-extra', body)
    const show = (open: boolean) => {
        node.classList.toggle('np-section-closed', !open)
        arrow.className = `icon-open-state fa ${open ? 'fa-angle-down' : 'fa-angle-right'}`
        body.style.display = open ? '' : 'none'
    }
    const toggle = () => {
        const open = node.classList.contains('np-section-closed')
        setSectionOpen(key, open)
        show(open)
    }
    head.addEventListener('click', toggle)
    head.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        toggle()
    })
    show(isSectionOpen(key))
    return { node, body, extra }
}

export class SectionedForm {
    readonly forms = new Map<string, InputForm>()
    readonly views = new Map<string, SectionView>()
    readonly node: HTMLElement
    private onChange: (changed: string[], result: Result) => void

    constructor(sections: FormSection[], scope: string, onChange: (changed: string[], result: Result) => void) {
        this.onChange = onChange
        this.node = document.createElement('div')
        this.node.className = 'np-sections'
        for (const section of sections) {
            const view = sectionElement(`${scope}.${section.id}`, section.title)
            const form = new InputForm(this.wrap(section.config) as any)
            form.on('change', (event: any) => {
                if (event?.cause !== 'input') return
                const changed: string[] = Array.isArray(event.changed_keys) ? event.changed_keys : []
                const result = { ...this.result(), ...(event.result ?? form.getResult()) }
                this.refreshOthers(form)
                this.onChange(changed, result)
            })
            noteRangeLimits(form)
            view.body.insertBefore(form.node, view.extra)
            this.node.appendChild(view.node)
            this.forms.set(section.id, form)
            this.views.set(section.id, view)
        }
        this.updateAll()
    }

    private wrap(config: FormConfig): FormConfig {
        const wrapped: FormConfig = {}
        for (const key of Object.keys(config)) {
            const entry = config[key]
            const condition = typeof entry === 'object' ? (entry as any).condition : undefined
            wrapped[key] = typeof condition === 'function'
                ? { ...(entry as any), condition: (result?: Result) => condition({ ...this.result(), ...(result ?? {}) }) }
                : entry
        }
        return wrapped
    }

    result(): Result {
        const merged: Result = {}
        for (const form of this.forms.values()) Object.assign(merged, form.getResult())
        return merged
    }

    setValues(values: Result) {
        for (const form of this.forms.values()) form.setValues(values, false)
        this.updateAll()
    }

    updateAll() {
        for (const form of this.forms.values()) form.update(form.getResult())
    }

    private refreshOthers(source: InputForm) {
        for (const form of this.forms.values()) if (form !== source) form.update(form.getResult())
    }

    extra(id: string): HTMLElement | null {
        return this.views.get(id)?.extra ?? null
    }

    delete() {
        for (const form of this.forms.values()) {
            try {
                form.delete()
            } catch (error) {
                console.error('[polyplus_nameplate] could not remove an inspector form', error)
            }
        }
        this.forms.clear()
        this.views.clear()
        this.node.remove()
    }
}
