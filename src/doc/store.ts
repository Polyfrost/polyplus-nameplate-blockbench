import type { NameplateData } from '../model'
import type { FlagsState } from '../flags/types'
import type { MaterialsState } from '../material/types'
import type { SlotMolang } from '../molang/slots'
import { MATERIALS_ASPECT } from '../material/types'
import { notifyNameplateChanged, readNameplate } from '../palette/state'
import { FLAGS_ASPECT, notifyFlagsChanged, readFlags, writeFlags } from '../flags/state'
import { notifyMaterialsChanged, readMaterials, writeMaterials } from '../material/state'
import { readSlotMolang, SLOT_MOLANG_ASPECT, writeSlotMolang } from '../molang/slots'
import { hasProject } from '../util/project'
import { undoEdit } from '../util/undo'

export interface Doc {
    nameplate: NameplateData
    flags: FlagsState
    materials: MaterialsState
    slotMolang: SlotMolang
}

export type Section = keyof Doc

interface SectionStore<T> {
    aspect: string
    read(): T
    write(value: T): void
    notify(): void
}

const STORES: { [K in Section]: SectionStore<Doc[K]> } = {
    nameplate: {
        aspect: 'nameplate',
        read: readNameplate,
        write: (value) => {
            Project.nameplate = value
        },
        notify: notifyNameplateChanged,
    },
    flags: { aspect: FLAGS_ASPECT, read: readFlags, write: writeFlags, notify: notifyFlagsChanged },
    materials: { aspect: MATERIALS_ASPECT, read: readMaterials, write: writeMaterials, notify: notifyMaterialsChanged },
    slotMolang: { aspect: SLOT_MOLANG_ASPECT, read: readSlotMolang, write: writeSlotMolang, notify: () => {} },
}

export interface DocEdit<R> {
    label: string | ((result: R) => string)
    aspects?: Record<string, unknown>
    finish?: (result: R) => object
}

export function editDoc<K extends Section, R>(sections: K[], edit: DocEdit<R>, change: (doc: Pick<Doc, K>, save: any) => R): R | undefined {
    if (!hasProject()) return undefined
    const doc = {} as Pick<Doc, K>
    const aspects: Record<string, unknown> = { ...(edit.aspects ?? {}) }
    for (const section of sections) {
        const store = STORES[section] as SectionStore<Doc[K]>
        doc[section] = store.read()
        store.write(doc[section])
        aspects[store.aspect] = true
    }
    const result = undoEdit(aspects, edit.label, (save) => {
        const value = change(doc, save)
        for (const section of sections) (STORES[section] as SectionStore<Doc[K]>).write(doc[section])
        return value
    }, edit.finish ? (value) => ({ ...edit.finish!(value), ...Object.fromEntries(sections.map((section) => [STORES[section].aspect, true])) }) : undefined)
    for (const section of sections) STORES[section].notify()
    return result
}
