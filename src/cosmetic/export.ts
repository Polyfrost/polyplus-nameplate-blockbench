import { describe } from '../engine'
import { buildZip } from '../export/zip'
import { messageBox } from '../util/dialogs'
import { hasProject } from '../util/project'
import { htmlList, plural } from '../util/text'
import { hasErrors } from './build'
import { currentBuild, refreshChecks } from './checks'
import { readCosmetic } from './state'
import { cosmeticIssueText } from './where'

const TITLE = 'Export Cosmetic'
const MAX_LISTED = 25
const RESOURCE_ID = 'polyplus_cosmetic_bundle'

export async function exportCosmetic() {
    if (!hasProject()) return
    let built
    try {
        built = currentBuild()
    } catch (error) {
        messageBox({ title: TITLE, icon: 'error', message: describe(error), buttons: ['Close'] })
        return
    }
    refreshChecks()
    if (!built.load) {
        messageBox({ title: TITLE, icon: 'hourglass_empty', message: 'The engine is still starting. Try again in a moment.', buttons: ['Close'] })
        return
    }
    if (hasErrors(built.issues)) {
        const errors = built.issues.filter((issue) => (issue.level ?? 'error') === 'error').map(cosmeticIssueText)
        messageBox({ title: TITLE, icon: 'error', message: `Fix ${plural(errors.length, 'error')} to export.${htmlList(errors, MAX_LISTED)}`, buttons: ['Close'], width: 640 })
        return
    }
    let content: Blob
    try {
        content = await buildZip(built.files, built.binary)
    } catch (error) {
        messageBox({ title: TITLE, icon: 'error', message: describe(error), buttons: ['Close'] })
        return
    }
    Blockbench.export({
        type: 'PolyPlus Cosmetic',
        extensions: ['zip'],
        name: readCosmetic().id,
        resource_id: RESOURCE_ID,
        savetype: 'zip',
        content,
    } as any)
}
