export function isTypingTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null
    if (!element || !element.tagName) return false
    const tag = element.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable
}
