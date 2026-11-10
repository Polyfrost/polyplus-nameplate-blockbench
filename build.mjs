import { build } from 'esbuild'
import { statSync } from 'node:fs'

const outfile = 'dist/polyplus_nameplate.js'

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
    minify: false,
    legalComments: 'none',
    define: { define: 'undefined' },
    loader: { '.otf': 'binary', '.png': 'dataurl' },
    plugins: [blockbenchGlobals],
    logLevel: 'info',
})

console.log(`${outfile}: ${statSync(outfile).size} bytes`)
