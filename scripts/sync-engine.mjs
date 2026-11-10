import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(
    process.env.NAMEPLATE_ENGINE_DIST
        ?? join(root, '..', 'PolyPlus.worktrees', 'nameplate-engine', 'nameplate-engine', 'build', 'dist', 'js', 'productionLibrary'),
)
const target = join(root, 'engine')
const entry = 'PolyPlus-nameplate-engine.js'

if (!existsSync(join(source, entry))) {
    console.error(`Engine build not found at ${source} (missing ${entry}). Build the engine or set NAMEPLATE_ENGINE_DIST.`)
    process.exit(1)
}

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })

const copied = []
for (const name of readdirSync(source)) {
    if (name.endsWith('.map')) continue
    cpSync(join(source, name), join(target, name))
    copied.push(name)
}

console.log(`Copied ${copied.length} files from ${source} to ${target}`)
for (const name of copied) console.log(`  ${name}`)
