export type FormConfig = Record<string, FormElementOptions | '_'>

export function heading(text: string): FormElementOptions {
    return { type: 'info', text: `**${text}**` }
}

export function note(text: string, condition?: (result: any) => boolean): FormElementOptions {
    return { type: 'info', text, condition: condition as any }
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

export interface PictureFields {
    textureOptions: Record<string, string>
    importDescription: string
    framesDescription: string
    onImport(): void
    onPaint(): void
}

export function pictureFields(fields: PictureFields): FormConfig {
    return {
        picture_title: heading('Picture'),
        texture: { type: 'select', label: 'Picture', options: fields.textureOptions },
        import_picture: { type: 'buttons', buttons: ['Import picture...'], click: () => fields.onImport(), description: fields.importDescription },
        frames: { type: 'number', label: 'Frames', step: 1, value: 1, condition: (result: any) => !!result?.texture, description: fields.framesDescription },
        paint: { type: 'buttons', buttons: ['Paint this picture'], condition: (result: any) => !!result?.texture, click: () => fields.onPaint() },
    }
}
