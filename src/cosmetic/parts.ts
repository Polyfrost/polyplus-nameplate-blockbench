import type { BundlePart } from './bundle'
import { effectsPart } from './effects'
import { emotePart } from './emote'
import { petPart } from './pet'

export const BUNDLE_PARTS: BundlePart[] = [petPart, emotePart, effectsPart]
