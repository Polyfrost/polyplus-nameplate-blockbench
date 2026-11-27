import { registerEffects } from './effectsDialog'
import { registerEmote } from './emote'
import { registerPet } from './pet'

export const KIND_REGISTRATIONS: Array<() => () => void> = [registerPet, registerEffects, registerEmote]
