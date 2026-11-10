export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function pluralWord(count: number, word: string): string {
    return `${word}${count === 1 ? '' : 's'}`
}

export function plural(count: number, word: string): string {
    return `${count} ${pluralWord(count, word)}`
}

export function htmlList(items: string[], max = Infinity): string {
    const shown = items.slice(0, max).map((item) => `<li>${escapeHtml(item)}</li>`)
    if (items.length > max) shown.push(`<li>and ${items.length - max} more</li>`)
    return `<ul>${shown.join('')}</ul>`
}

export function bulletList(items: string[], max: number): string {
    const shown = items.slice(0, max).map((item) => `- ${item}`)
    if (items.length > max) shown.push(`- and ${items.length - max} more`)
    return shown.join('\n')
}

export function joinList(items: Array<string | number>, conjunction: 'and' | 'or' = 'and'): string {
    if (items.length < 2) return items.join('')
    return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`
}

export function quotedList(names: string[], conjunction: 'and' | 'or' = 'and'): string {
    return joinList(names.map((name) => `'${name}'`), conjunction)
}
