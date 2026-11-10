import { pictureName, removePictures, unusedPictures } from '../elements/pictures'
import type { Problem } from '../export/issues'
import { removeButton } from './helpers'

export function unusedPictureProblems(): Problem[] {
    return unusedPictures().map((texture) => ({
        level: 'warning',
        code: 'unused_picture',
        text: `Picture '${pictureName(texture)}' isn't used by any layer.`,
        target: null,
        designerOnly: true,
        buttons: [removeButton(() => removePictures([texture]))],
    }))
}
