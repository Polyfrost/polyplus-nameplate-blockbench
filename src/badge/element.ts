import { defineElementType, ElementType } from '../elements/classes'
import { BADGE_TYPE, Channel } from '../model'

export const BADGE_CHANNELS: Channel[] = ['position', 'opacity', 'visible']
export const BADGE_NAME = 'PolyPlus badge'

export type BadgeType = ElementType

export function defineBadgeType(menu: any[]): BadgeType {
    return defineElementType({
        type: BADGE_TYPE,
        title: BADGE_NAME,
        icon: 'verified',
        channels: BADGE_CHANNELS,
        menu,
        define(target) {
            new Property(target, 'string', 'name', { default: BADGE_NAME })
            new Property(target, 'boolean', 'visibility', { default: true })
        },
    })
}
