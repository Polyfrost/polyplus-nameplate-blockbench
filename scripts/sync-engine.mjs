import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fallback = join(root, '..', 'plusrenderer', 'packages', 'renderer')
const target = join(root, 'engine')
const files = ['nameplate.js', 'nameplate-gl.js', 'cosmetic.js', 'plusrenderer.wasm']
const wasm = 'plusrenderer.wasm'
const sourceFile = 'source.json'

function argumentPath() {
    const args = process.argv.slice(2)
    const flag = args.findIndex((arg) => arg === '--engine')
    if (flag >= 0) return args[flag + 1]
    const inline = args.find((arg) => arg.startsWith('--engine='))
    if (inline) return inline.slice('--engine='.length)
    return args.find((arg) => !arg.startsWith('--'))
}

function git(args, cwd) {
    try {
        return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
        return null
    }
}

const source = resolve(argumentPath() ?? process.env.PLUSRENDERER_DIST ?? fallback)

const missing = files.filter((name) => !existsSync(join(source, name)))
if (missing.length) {
    console.error(`plusrenderer not found at ${source} (missing ${missing.join(', ')}). Run scripts/build-wasm.sh in plusrenderer, or pass its packages/renderer folder with --engine <path> or PLUSRENDERER_DIST.`)
    process.exit(1)
}

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
for (const name of files) cpSync(join(source, name), join(target, name))

const commit = git(['rev-parse', 'HEAD'], source)
const status = commit ? git(['status', '--porcelain'], source) : null
const info = {
    commit,
    dirty: status === null ? null : status.length > 0,
    hash: createHash('sha256').update(readFileSync(join(target, wasm))).digest('hex'),
    path: source,
    synced: new Date().toISOString(),
}
writeFileSync(join(target, sourceFile), `${JSON.stringify(info, null, 2)}\n`)

console.log(`Copied ${files.join(', ')} from ${source} to ${target}`)
console.log(`plusrenderer commit ${commit ?? 'unknown'}${info.dirty ? ' (with uncommitted changes)' : ''}, wasm sha256 ${info.hash}`)
