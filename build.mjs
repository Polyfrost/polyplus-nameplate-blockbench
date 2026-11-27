import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { engineAlias, IMPORT_META_URL, workerSource } from './scripts/engine.mjs'
import { encodeZ85 } from './scripts/z85.mjs'

const dev = process.argv.includes('--dev')
const outfile = 'dist/polyplus_nameplate.js'
const wasmFile = 'engine/plusrenderer.wasm'
const wasm = readFileSync(wasmFile)
const packed = deflateSync(wasm, { level: 9 })
const packedText = encodeZ85(packed)
const STORE_LIMIT = 2_000_000

function engineSource() {
    const hash = createHash('sha256').update(wasm).digest('hex')
    let recorded = null
    try {
        recorded = JSON.parse(readFileSync('engine/source.json', 'utf8'))
    } catch {
        recorded = null
    }
    const matches = recorded?.hash === hash
    return {
        commit: matches ? recorded.commit ?? null : null,
        dirty: matches ? recorded.dirty ?? null : null,
        hash,
    }
}

const engine = engineSource()

const packedEngine = {
    name: 'packed-engine',
    setup(context) {
        context.onLoad({ filter: /plusrenderer\.wasm$/ }, () => ({
            contents: `import { decodeZ85 } from './src/engine/z85'\nexport default decodeZ85(${JSON.stringify(packedText)}, ${packed.length})`,
            loader: 'js',
            resolveDir: resolve('.'),
        }))
    },
}

const blockbenchGlobals = {
    name: 'blockbench-globals',
    setup(context) {
        context.onResolve({ filter: /^vue$/ }, () => ({ path: 'Vue', namespace: 'blockbench-global' }))
        context.onLoad({ filter: /.*/, namespace: 'blockbench-global' }, (args) => ({
            contents: `module.exports = window.${args.path}`,
            loader: 'js',
        }))
    },
}

await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outfile,
    minify: !dev,
    keepNames: true,
    legalComments: 'none',
    define: {
        define: 'undefined',
        ENGINE_SOURCE: JSON.stringify(engine),
        ENGINE_WASM: JSON.stringify({ deflated: true, size: wasm.length }),
        'import.meta.url': IMPORT_META_URL,
    },
    loader: { '.otf': 'binary', '.png': 'dataurl', '.wasm': 'binary' },
    alias: engineAlias(),
    plugins: [packedEngine, blockbenchGlobals, workerSource({ minify: !dev })],
    logLevel: 'info',
})

const total = statSync(outfile).size
console.log(`${outfile}: ${total} bytes${dev ? ', not minified' : ''} (plusrenderer.wasm ${wasm.length} bytes, ${packed.length} deflated, ${packedText.length} as text)`)
if (total > STORE_LIMIT) console.warn(`${outfile} is over the ${STORE_LIMIT} byte Blockbench store limit`)
console.log(`engine: plusrenderer commit ${engine.commit ?? 'unknown'}, wasm sha256 ${engine.hash}`)
