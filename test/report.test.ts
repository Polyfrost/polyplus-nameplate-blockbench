import assert from 'node:assert/strict'
import test from 'node:test'
import { archiveProblem, archiveSize, MAX_FILE_BYTES } from '../src/checks/report'

test('a game file over the per-file cap blocks the export and is named, and files the game does not read are not held to it', () => {
    const problem = (files: Record<string, string>, binary: Record<string, Uint8Array> = {}, source = false) => archiveProblem(archiveSize(files, binary), null, source)
    assert.match(problem({ 'manifest.json': '{}' }, { 'textures/big.png': new Uint8Array(MAX_FILE_BYTES + 1) }) ?? '', /textures\/big\.png/)
    assert.equal(problem({ 'manifest.json': '{}' }, { 'textures/big.png': new Uint8Array(MAX_FILE_BYTES) }), null)
    assert.match(problem({ 'sprites/huge.json': 'x'.repeat(MAX_FILE_BYTES + 10) }) ?? '', /sprites\/huge\.json/)
    assert.equal(problem({ 'manifest.json': '{}', 'source.bbmodel': 'x'.repeat(MAX_FILE_BYTES * 2) }, {}, true), null)
})
