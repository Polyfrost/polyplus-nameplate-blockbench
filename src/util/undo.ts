export function undoEdit<T>(
    aspects: object,
    label: string | ((result: T) => string),
    run: (entry: any) => T,
    finish?: (result: T) => object,
): T {
    const entry = Undo.initEdit(aspects as UndoAspects)
    let result: T
    try {
        result = run(entry)
    } catch (error) {
        Undo.cancelEdit(true)
        throw error
    }
    Undo.finishEdit(typeof label === 'function' ? label(result) : label, (finish ? finish(result) : aspects) as UndoAspects)
    return result
}

export function tryUndoEdit(aspects: object, label: string, change: (entry: any) => void | false): boolean {
    const entry = Undo.initEdit(aspects as UndoAspects)
    try {
        if (change(entry) === false) {
            Undo.cancelEdit(false)
            return false
        }
    } catch (error) {
        Undo.cancelEdit(true)
        throw error
    }
    Undo.finishEdit(label, aspects as UndoAspects)
    return true
}
