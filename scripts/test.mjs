import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { engineAlias, workerSource } from './engine.mjs'

const dir = 'test'
const entries = readdirSync(dir).filter((name) => name.endsWith('.test.ts')).map((name) => join(dir, name))
const outdir = mkdtempSync(join(tmpdir(), 'polyplus-nameplate-test-'))

try {
    await build({
        entryPoints: entries,
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node20',
        outdir,
        outExtension: { '.js': '.mjs' },
        define: { define: 'undefined' },
        loader: { '.otf': 'binary', '.png': 'dataurl', '.wasm': 'binary' },
        alias: engineAlias(),
        external: ['vue'],
        plugins: [workerSource()],
        logLevel: 'warning',
    })
    const files = readdirSync(outdir).filter((name) => name.endsWith('.mjs')).map((name) => join(outdir, name))
    const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
    process.exitCode = result.status ?? 1
} finally {
    rmSync(outdir, { recursive: true, force: true })
}
