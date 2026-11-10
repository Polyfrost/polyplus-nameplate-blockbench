import { limited, limitedPair } from '../elements/limits'
import { LIMITS } from '../motion/types'
import { FormConfig, Part, Values } from '../schema/form'
import { heading } from '../util/form'

export interface WidthRange {
    min: number
    max: number | null
    texture?: string
}

export interface RangesOptions {
    prefix: string
    read(node: any): WidthRange[]
    onDescription: string
    pictures?: (node: any, index: number) => Record<string, string>
    fallback: 'previous' | 'current'
}

const RANGE_DESCRIPTION = 'Name width in px. 0 in the second box means no upper limit'

export function widthRanges(options: RangesOptions): Part & { from(node: any, result: Values): WidthRange[] } {
    const { prefix, read } = options
    const key = (name: string) => `${prefix}_${name}`
    const on = key('on')
    const count = key('count')
    const range = (index: number) => `${prefix}_${index}_range`
    const picture = (index: number) => `${prefix}_${index}_texture`

    function from(node: any, result: Values): WidthRange[] {
        if (!result[on]) return []
        const current = read(node)
        const total = limited(result[count], 1, LIMITS.breakpoints, 1, 'Ranges')
        const list: WidthRange[] = []
        for (let index = 0; index < total; index++) {
            const value = result[range(index)]
            let min: number
            let below: number
            if (options.fallback === 'previous') {
                const previous = list[index - 1]
                const fallback: [number, number] = current[index] ? [current[index].min, current[index].max ?? 0] : [previous?.max ?? 0, 0]
                const pair = Array.isArray(value) ? value : fallback
                min = limited(pair[0], 0, LIMITS.width, fallback[0], 'Name width')
                below = limited(pair[1], 0, LIMITS.width, fallback[1], 'Name width')
            } else {
                ;[min, below] = value === undefined ? [current[index]?.min ?? 0, current[index]?.max ?? 0] : limitedPair(value, 0, LIMITS.width, `Range ${index + 1}`)
            }
            if (options.fallback === 'previous') {
                list.push({ min, max: below > 0 ? below : null })
                continue
            }
            const texture = result[picture(index)]
            list.push({ min, max: below > 0 ? below : null, texture: typeof texture === 'string' ? texture : (current[index]?.texture ?? '') })
        }
        return list
    }

    return {
        from,
        config(node) {
            const config: FormConfig = {
                [key('title')]: heading('Name width'),
                [on]: { type: 'checkbox', label: 'Only for some name widths', style: 'toggle_switch', value: false, description: options.onDescription } as any,
                [count]: { type: 'number', label: 'Ranges', step: 1, value: 1, condition: (result: Values) => !!result?.[on] },
            }
            const total = Math.max(1, Math.min(LIMITS.breakpoints, read(node).length || 1))
            for (let index = 0; index < total; index++) {
                const shown = (result: Values) => !!result?.[on] && Number(result?.[count] ?? 1) > index
                config[range(index)] = {
                    type: 'vector',
                    label: `Range ${index + 1}: from, below`,
                    dimensions: 2,
                    step: 1,
                    force_step: true,
                    value: [0, 0],
                    condition: shown,
                    description: RANGE_DESCRIPTION,
                } as any
                if (options.pictures) {
                    config[picture(index)] = {
                        type: 'select',
                        label: `Range ${index + 1}: picture`,
                        options: options.pictures(node, index),
                        condition: shown,
                        description: 'Needs the same number of frames',
                    }
                }
            }
            return config
        },
        values(node) {
            const ranges = read(node)
            const values: Values = { [on]: ranges.length > 0, [count]: Math.max(1, ranges.length) }
            ranges.forEach((entry, index) => {
                values[range(index)] = [entry.min, entry.max ?? 0]
                if (options.fallback === 'current') values[picture(index)] = entry.texture
            })
            return values
        },
        owns: (candidate) => candidate.startsWith(`${prefix}_`),
    }
}
