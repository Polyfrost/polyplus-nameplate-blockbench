export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

export function clampRounded(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value)))
}

export function round3(value: number): number {
    return Math.round(value * 1000) / 1000
}

export function round3Text(value: number): string {
    return String(round3(value))
}

export function finiteOr(value: unknown, fallback: number): number {
    const number = Number(value)
    return isFinite(number) ? number : fallback
}

export function decimalOr(value: unknown, fallback: number): number {
    const number = Number(value)
    return isFinite(number) ? number + 0 : fallback
}

export function decimalClamped(value: unknown, min: number, max: number, fallback: number): number {
    const number = Number(value)
    if (!isFinite(number)) return fallback
    return Math.min(max, Math.max(min, round3(number)))
}

export function wholeOr(value: unknown, fallback: number): number {
    const number = Math.round(Number(value))
    return isFinite(number) ? number + 0 : fallback
}

export function wholeOrAtLeast(value: unknown, minimum: number, fallback: number): number {
    return Math.max(minimum, wholeOr(value, fallback))
}

export function wholeClamped(value: unknown, min: number, max: number, fallback: number): number {
    const number = Math.round(Number(value))
    if (!isFinite(number)) return fallback
    return Math.min(max, Math.max(min, number))
}

export function wholeFlooredClamped(value: unknown, min: number, max: number, fallback: number): number {
    const number = Math.floor(Number(value))
    if (!isFinite(number)) return fallback
    return Math.min(max, Math.max(min, number))
}

export function integerAtLeast(value: unknown, min: number): number | null {
    const number = Number(value)
    return Number.isInteger(number) && number >= min ? number : null
}

export function presentIntegerAtLeast(value: unknown, min: number): number | null {
    if (value === null || value === undefined || value === '') return null
    return integerAtLeast(value, min)
}

export function numberIntegerAtLeast(value: unknown, min: number): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= min ? value : null
}
