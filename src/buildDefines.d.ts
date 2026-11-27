declare const ENGINE_SOURCE: {
    commit: string | null
    dirty: boolean | null
    hash: string | null
}

declare const ENGINE_WASM: {
    deflated: boolean
    size: number
}

declare module '*?worker' {
    const source: string
    export default source
}
