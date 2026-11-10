import { registerMolangAutocomplete, unregisterMolangAutocomplete } from './autocomplete'
import { registerKeyPresetMenu, unregisterKeyPresetMenu } from './editor'
import { registerSlotMolangState, unregisterSlotMolangState } from './slots'

export { applySlotMolang, readSlotMolang, takeSlotMolang, writeSlotMolang, isSlotDriven } from './slots'
export type { SlotMolang } from './slots'
export { dataPointWithMolang, editableKeyValue, importKeyValue, keyMolang, keyValueJson, sameMolang } from './keys'
export type { KeyMolang } from './keys'
export { openSlotMolangEditor } from './editor'
export { molangProblems } from './problems'

export function registerMolang() {
    registerSlotMolangState()
    registerMolangAutocomplete()
    registerKeyPresetMenu()
}

export function unregisterMolang() {
    unregisterKeyPresetMenu()
    unregisterMolangAutocomplete()
    unregisterSlotMolangState()
}
