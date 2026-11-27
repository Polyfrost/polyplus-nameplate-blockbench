import { NAMEPLATE_DATA_VERSION } from '../model'
import { isRecord } from '../util/json'

type Migration = (raw: Record<string, any>) => Record<string, any>

const MIGRATIONS: readonly Migration[] = [
    (raw) => raw,
]

export function savedDataVersion(raw: unknown): number {
    const version = isRecord(raw) ? raw.version : undefined
    return typeof version === 'number' && Number.isInteger(version) && version >= 0 ? version : 0
}

export function isNewerData(raw: unknown): boolean {
    return savedDataVersion(raw) > NAMEPLATE_DATA_VERSION
}

export function migrateNameplate(raw: unknown): Record<string, any> {
    if (!isRecord(raw)) return { version: NAMEPLATE_DATA_VERSION }
    const from = savedDataVersion(raw)
    if (from >= NAMEPLATE_DATA_VERSION) return raw
    let data = raw
    for (let version = from; version < NAMEPLATE_DATA_VERSION; version++) data = MIGRATIONS[version](data)
    return { ...data, version: NAMEPLATE_DATA_VERSION }
}

export function extraKeys(raw: unknown, known: ReadonlySet<string>): {} {
    if (!isRecord(raw)) return {}
    const extra: Record<string, unknown> = {}
    for (const key of Object.keys(raw)) if (!known.has(key)) extra[key] = raw[key]
    return extra
}
