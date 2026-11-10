import { isNameplateActive } from '../format'
import { labelFor, MolangName, NAMEPLATE_FUNCTIONS, NAMEPLATE_QUERIES } from './catalog'

interface AutocompleteResult {
    text: string
    label?: string
    overlap: number
    priority?: number
}

const CONTEXT_ID = 'polyplus_nameplate'

let context: any = null
let restore: (() => void) | null = null

function api(): any {
    return (globalThis as any).MolangAutocomplete
}

function namespace(Namespace: any, id: string, shorthand: string | undefined, names: MolangName[]): any {
    const created = new Namespace({ id, shorthand })
    for (const name of names) created.addQuery({ id: name.id, arguments: name.arguments })
    return created
}

function variables(pattern: RegExp, text: string, incomplete: string): Array<{ id: string }> {
    const found = new Set<string>()
    for (const match of text.match(pattern) ?? []) {
        const name = match.split('.')[1]
        if (name && name !== incomplete) found.add(name)
    }
    return Array.from(found).map((id) => ({ id }))
}

function buildContext(): any {
    const { Context, Namespace } = api()
    const created = new Context({ id: CONTEXT_ID })
    created.addRootToken({ id: 'return' })
    created.addNamespace(namespace(Namespace, 'query', 'q', NAMEPLATE_QUERIES))
    created.addNamespace(namespace(Namespace, 'math', undefined, NAMEPLATE_FUNCTIONS))
    created.addNamespace(
        new Namespace({ id: 'variable', shorthand: 'v' }).addQueryGetter('nameplate_variables', (text: string, incomplete: string) =>
            variables(/\b(?:v|variable)\.(\w+)/gi, String(text ?? ''), incomplete),
        ),
    )
    created.addNamespace(
        new Namespace({ id: 'temp', shorthand: 't' }).addQueryGetter('nameplate_temps', (text: string, incomplete: string) =>
            variables(/\b(?:t|temp)\.(\w+)/gi, String(text ?? ''), incomplete),
        ),
    )
    return created
}

const LABELS = new Map<string, string>()

function describe(results: AutocompleteResult[]): AutocompleteResult[] {
    return results.map((result) => {
        const id = result.text.replace(/\(\)$/, '')
        const label = LABELS.get(id)
        return label ? { ...result, label } : result
    })
}

export function nameplateAutocomplete(text: string, position: number): AutocompleteResult[] {
    if (!context) return []
    return describe(context.autocomplete(text, position) ?? [])
}

export function registerMolangAutocomplete() {
    if (context) return
    const molang = api()
    if (!molang?.Context || !molang?.Namespace || !molang?.KeyframeContext) return
    LABELS.clear()
    for (const name of [...NAMEPLATE_QUERIES, ...NAMEPLATE_FUNCTIONS]) LABELS.set(name.id, labelFor(name))
    context = buildContext()
    const keyframes = molang.KeyframeContext
    const had = Object.prototype.hasOwnProperty.call(keyframes, 'autocomplete')
    const original = keyframes.autocomplete
    keyframes.autocomplete = function (this: any, text: string, position: number) {
        if (isNameplateActive()) return nameplateAutocomplete(text, position)
        return original.call(this, text, position)
    }
    restore = () => {
        if (had) keyframes.autocomplete = original
        else delete keyframes.autocomplete
    }
}

export function unregisterMolangAutocomplete() {
    restore?.()
    restore = null
    context?.delete?.()
    context = null
    LABELS.clear()
}
