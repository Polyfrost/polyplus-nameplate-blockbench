export type FormConfig = Record<string, FormElementOptions | '_'>
export type Values = Record<string, any>
export type Shown = (result: Values) => boolean

export interface Part {
    config(node: any): FormConfig
    values?(node: any): Values
    owns?(key: string): boolean
    apply?(node: any, key: string, result: Values, context?: any): void
}

type Dynamic<T> = T | ((node: any) => T)

function resolve<T>(value: Dynamic<T>, node: any): T {
    return typeof value === 'function' ? (value as (node: any) => T)(node) : value
}

export interface FieldOptions {
    input: Dynamic<FormElementOptions>
    get(node: any): unknown
    set?(node: any, value: any, result: Values, context?: any): void
}

export function field(key: string, options: FieldOptions): Part {
    return {
        config: (node) => ({ [key]: resolve(options.input, node) }),
        values: (node) => ({ [key]: options.get(node) }),
        owns: (candidate) => candidate === key,
        apply(node, _key, result, context) {
            options.set?.(node, result[key], result, context)
        },
    }
}

export function heading(key: string, text: string): Part {
    return { config: () => ({ [key]: { type: 'info', text: `**${text}**` } }) }
}

export function note(key: string, text: Dynamic<string>, condition?: Shown): Part {
    return { config: (node) => ({ [key]: { type: 'info', text: resolve(text, node), condition: condition as any } }) }
}

export function fixed(config: Dynamic<FormConfig>): Part {
    return { config: (node) => resolve(config, node) }
}

export function when(test: (node: any) => boolean, ...parts: Part[]): Part {
    const inner = group(...parts)
    return {
        config: (node) => (test(node) ? inner.config(node) : {}),
        values: (node) => (test(node) ? inner.values!(node) : {}),
        owns: inner.owns,
        apply: (node, key, result, context) => {
            if (test(node)) inner.apply!(node, key, result, context)
        },
    }
}

export function group(...parts: Part[]): Part {
    return {
        config(node) {
            const config: FormConfig = {}
            for (const part of parts) Object.assign(config, part.config(node))
            return config
        },
        values(node) {
            const values: Values = {}
            for (const part of parts) if (part.values) Object.assign(values, part.values(node))
            return values
        },
        owns: (key) => parts.some((part) => !!part.owns?.(key)),
        apply(node, key, result, context) {
            for (const part of parts) {
                if (part.owns?.(key)) {
                    part.apply?.(node, key, result, context)
                    return
                }
            }
        },
    }
}

export function custom(owns: (key: string) => boolean, config: (node: any) => FormConfig, values: (node: any) => Values, apply: (node: any, key: string, result: Values, context?: any) => void): Part {
    return { config, values, owns, apply }
}

export function labeled(values: readonly string[], labels: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {}
    for (const value of values) result[value] = labels[value] ?? value
    return result
}

export function withCurrent<T>(options: Record<string, T>, current: string, label: string): Record<string, T | string> {
    if (!current || current in options) return options
    return { [current]: label, ...options }
}

export function isDisplayKey(key: string): boolean {
    return key.endsWith('_title') || key.endsWith('_note')
}
