import { plainMessage } from '../checks/words'
import type { EngineIssue } from '../engine'

type Subject = (match: RegExpExecArray) => string

const MANIFEST_AT: Array<[RegExp, Subject]> = [
    [/^reactions\.(\d+)/, (m) => `Reaction ${Number(m[1]) + 1}`],
    [/^roles\.(\d+)/, (m) => `Role ${Number(m[1]) + 1}`],
    [/^roles/, () => 'Roles'],
    [/^rules/, () => 'Emote rules'],
    [/^(requirement|fallback|main)/, () => 'The emote'],
    [/^effects\.([^.]+)/, (m) => `Effect '${m[1]}'`],
    [/^emitters\.(\d+)/, (m) => `Always-on particles ${Number(m[1]) + 1}`],
    [/^trails\.(\d+)/, (m) => `Trail ${Number(m[1]) + 1}`],
    [/^particles\.([^.]+)/, (m) => `Particles '${m[1]}'`],
    [/^sounds\.([^.]+)/, (m) => `Sound '${m[1]}'`],
    [/^(archetype|leashRadius|scale|anchor|interactions)/, () => 'Pet settings'],
    [/^attach/, () => 'Attach settings'],
    [/^(controllers|animationControllers)/, () => 'Controllers'],
    [/^textures\.(\d+)/, (m) => `Picture ${Number(m[1]) + 1}`],
    [/^geometry/, () => 'The model'],
    [/^animations/, () => 'Animations'],
    [/^palettes/, () => 'The palette'],
]

const FILES: Array<[RegExp, Subject]> = [
    [/^models\//, () => 'The model'],
    [/^animations\.(.+?)(?:\.\d+)?$/, (m) => `Animation '${m[1]}'`],
    [/^animations\//, () => 'Animations'],
    [/^animation_controllers\//, () => 'Controllers'],
    [/^controllers/, () => 'Controllers'],
    [/^particles\/([^.#]+)/, (m) => `Particles '${m[1]}'`],
    [/^sounds\/([^.#]+)/, (m) => `Sound '${m[1]}'`],
    [/^textures\/fx_([^.#]+)\.png#picture/, (m) => `Effect picture '${m[1]}'`],
    [/^textures\/([^.#]+)/, (m) => `Picture '${m[1]}'`],
    [/^palettes\.json/, () => 'The palette'],
    [/^geometry\./, () => 'The model'],
]

export function issueSubject(path: string): string {
    const [file, at = ''] = path.split('#')
    if (file === 'manifest.json') {
        for (const [pattern, subject] of MANIFEST_AT) {
            const match = pattern.exec(at)
            if (match) return subject(match)
        }
        return 'The cosmetic'
    }
    for (const [pattern, subject] of FILES) {
        const match = pattern.exec(path)
        if (match) return subject(match)
    }
    return 'The cosmetic'
}

export function cosmeticIssueText(issue: EngineIssue): string {
    return `${issueSubject(issue.path)} ${plainMessage(issue.message)}`
}
