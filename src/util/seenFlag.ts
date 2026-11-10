export function rememberFlag(key: string, label: string): { seen(): boolean, mark(): void } {
    let seenHere = false
    return {
        seen() {
            if (seenHere) return true
            try {
                return globalThis.localStorage?.getItem(key) === 'seen'
            } catch {
                return false
            }
        },
        mark() {
            seenHere = true
            try {
                globalThis.localStorage?.setItem(key, 'seen')
            } catch (error) {
                console.warn(`[polyplus_nameplate] could not remember the ${label}`, error)
            }
        },
    }
}
