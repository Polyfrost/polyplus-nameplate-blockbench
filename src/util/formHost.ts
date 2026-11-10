export interface FormHost {
    readonly form: InputForm | null
    show(
        parent: HTMLElement,
        config: object,
        scope: Record<string, unknown>,
        onChange: (keys: string[], result: any) => void,
        bind?: (form: InputForm) => void,
    ): InputForm
    clear(): void
}

function formSignature(config: object, scope: Record<string, unknown>): string {
    const shape: Record<string, unknown> = { ...scope }
    for (const key of Object.keys(config)) {
        const entry = (config as any)[key]
        shape[key] = entry && typeof entry === 'object' ? entry.options ?? entry.type : entry
    }
    return JSON.stringify(shape)
}

export function createFormHost(label: string): FormHost {
    let current: InputForm | null = null
    let signature = ''

    function clear() {
        current?.node?.remove()
        try {
            current?.delete?.()
        } catch (error) {
            console.error(`[polyplus_nameplate] could not remove the ${label} form`, error)
        }
        current = null
        signature = ''
    }

    return {
        get form() {
            return current
        },
        show(parent, config, scope, onChange, bind) {
            const next = formSignature(config, scope)
            if (!current || signature !== next) {
                clear()
                const form = new InputForm(config as any)
                form.on('change', (event: any) => {
                    if (event?.cause !== 'input') return
                    onChange(Array.isArray(event.changed_keys) ? event.changed_keys : [], event.result ?? form.getResult())
                })
                bind?.(form)
                current = form
                signature = next
                parent.appendChild(form.node)
            } else if (current.node.parentNode !== parent) {
                parent.appendChild(current.node)
            }
            return current
        },
        clear,
    }
}
