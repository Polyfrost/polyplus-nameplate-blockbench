import { normalizeFlags } from './compile'
import { cloneJson } from '../util/json'
import { defineProjectState } from '../util/projectState'
import { emptyFlags, FlagsState } from './types'

export const FLAGS_PROPERTY = 'nameplate_flags'
export const FLAGS_ASPECT = 'nameplate_flags'

const store = defineProjectState<FlagsState>({
    property: FLAGS_PROPERTY,
    aspect: FLAGS_ASPECT,
    listenerFailure: 'flag listener failed',
    empty: emptyFlags,
    parse: (raw) => normalizeFlags(cloneJson(raw ?? emptyFlags())),
})

export const readFlags = store.read
export const writeFlags = store.write
export const onFlagsChanged = store.on
export const notifyFlagsChanged = store.notify
export const registerFlagsState = store.register
export const unregisterFlagsState = store.unregister

export function commitFlags(label: string, change: (state: FlagsState) => void): boolean {
    return store.commit(label, change, { compare: true })
}
