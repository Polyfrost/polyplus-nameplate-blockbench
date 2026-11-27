interface Owner {
    id: string
    stop: () => void
}

let owner: Owner | null = null

export function claimRig(id: string, stop: () => void) {
    const previous = owner
    owner = { id, stop }
    if (previous && previous.id !== id) previous.stop()
}

export function releaseRig(id: string) {
    if (owner?.id === id) owner = null
}

export function rigOwner(): string | null {
    return owner?.id ?? null
}
