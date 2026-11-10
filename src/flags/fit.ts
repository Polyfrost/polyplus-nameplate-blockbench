export function fitBands(weights: number[], rows: number): number[] | null {
    const bands = weights.length
    if (bands === 0 || rows < bands) return null

    const total = weights.reduce((sum, weight) => sum + weight, 0)
    const fitted = new Array<number>(bands).fill(0)
    const remainders = new Array<number>(bands).fill(0)
    let assigned = 0
    for (let i = 0; i < bands; i++) {
        const quota = weights[i] * rows
        fitted[i] = Math.floor(quota / total)
        remainders[i] = quota % total
        assigned += fitted[i]
    }

    for (let left = rows - assigned; left > 0; left--) {
        let best = 0
        for (let i = 1; i < bands; i++) {
            if (remainders[i] > remainders[best]) best = i
        }
        fitted[best]++
        remainders[best] = -1
    }

    for (let i = 0; i < bands; i++) {
        if (fitted[i] !== 0) continue
        let donor = 0
        for (let j = 1; j < bands; j++) {
            if (fitted[j] > fitted[donor]) donor = j
        }
        fitted[donor]--
        fitted[i] = 1
    }
    return fitted
}

export function fitSymmetric(weights: number[], rows: number): number[] | null {
    const bands = weights.length
    const pairs = Math.floor(bands / 2)
    const odd = bands % 2 === 1
    if (bands === 0 || rows < bands || (!odd && rows % 2 === 1)) return fitBands(weights, rows)
    if (pairs === 0) return [rows]

    let middle = 0
    if (odd) {
        const total = weights.reduce((sum, weight) => sum + weight, 0)
        middle = Math.max(1, Math.floor((weights[pairs] * rows) / total))
        if ((rows - middle) % 2 !== 0) middle++
        while (rows - middle < 2 * pairs && middle - 2 >= 1) middle -= 2
        if (rows - middle < 2 * pairs) return fitBands(weights, rows)
    }

    const half = fitBands(weights.slice(0, pairs), (rows - middle) / 2)
    if (!half) return fitBands(weights, rows)
    return weights.map((_, i) => {
        if (i < pairs) return half[i]
        if (odd && i === pairs) return middle
        return half[bands - 1 - i]
    })
}

export function fittedRows(
    weights: number[],
    rows: number,
    symmetric: boolean,
    overrides: Record<string, number[]>,
): number[] | null {
    const override = overrides[String(rows)]
    if (override && override.length === weights.length) return override.slice()
    return symmetric ? fitSymmetric(weights, rows) : fitBands(weights, rows)
}

export function bandAt(fitted: number[], row: number): number {
    let end = 0
    for (let band = 0; band < fitted.length; band++) {
        end += fitted[band]
        if (row < end) return band
    }
    return fitted.length - 1
}

export function chevronStripe(column: number, row: number, rows: number, width: number, stripes: number): number {
    const depth = Math.min(row, rows - 1 - row)
    const stripe = Math.floor((column - depth) / width)
    return column < depth + stripes * width ? Math.max(stripe, 0) : -1
}

export function circlePart(column: number, row: number, columns: number, rows: number, width: number): number {
    const outer = rows - 2
    if (outer < 2) return -1
    const dx = 2 * column + 1 - columns
    const dy = 2 * row + 1 - rows
    const distance = dx * dx + dy * dy
    const inner = Math.max(outer - 2 * width, 0)
    if (distance > outer * outer) return -1
    return distance > inner * inner ? 0 : 1
}
