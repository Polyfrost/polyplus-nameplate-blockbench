import { build } from 'esbuild'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const ENGINE_PACKAGE = '@plusrenderer/renderer'

export const IMPORT_META_URL = JSON.stringify('https://plusrenderer.invalid/')

const WORKER_SUFFIX = '?worker'

export function engineAlias() {
    return { [ENGINE_PACKAGE]: resolve('engine') }
}

export function workerSource({ minify = false } = {}) {
    return {
        name: 'worker-source',
        setup(context) {
            context.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: resolve(args.resolveDir, args.path.slice(0, -WORKER_SUFFIX.length)),
                namespace: 'worker-source',
            }))
            context.onLoad({ filter: /.*/, namespace: 'worker-source' }, async (args) => {
                const entry = existsSync(args.path) ? args.path : `${args.path}.ts`
                const result = await build({
                    entryPoints: [entry],
                    bundle: true,
                    write: false,
                    format: 'iife',
                    platform: 'browser',
                    target: 'es2020',
                    minify,
                    legalComments: 'none',
                    define: { 'import.meta.url': IMPORT_META_URL },
                    alias: engineAlias(),
                    logLevel: 'warning',
                })
                return {
                    contents: `export default ${JSON.stringify(result.outputFiles[0].text)}`,
                    loader: 'js',
                    watchFiles: [entry],
                }
            })
        },
    }
}
