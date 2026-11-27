export interface EngineSource {
    commit: string | null
    dirty: boolean | null
    hash: string | null
}

export function engineSource(): EngineSource {
    return typeof ENGINE_SOURCE === 'undefined' ? { commit: null, dirty: null, hash: null } : ENGINE_SOURCE
}
