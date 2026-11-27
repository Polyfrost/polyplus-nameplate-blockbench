import assert from 'node:assert/strict'
import test from 'node:test'
import type { EngineIssue, NameplateCost, NameplatePreview } from '../src/engine'
import { costSummary } from '../src/leftside/summary'
import { costReport } from '../src/preview/cost'
import { BUDGET_ISSUE_CODES, issueMessage } from '../src/engine'

function plainCost(issues: EngineIssue[], flashChecked = true): NameplateCost {
    return {
        quads: 4,
        cacheBytes: 1024,
        cpu: 0,
        states: 1,
        totalStates: 1,
        margin: 0,
        layers: [{ id: 'plate', states: 1, margin: 0 }],
        flash: null,
        flashChecked,
        flashTimes: null,
        flashPixels: null,
        issues,
        warnings: [],
        infos: [],
        materialBuildOps: null,
        fallbacks: [],
        fallbackBytes: 0,
        textCpu: 0,
        effects: [],
    } as NameplateCost
}

function previewOf(cost: NameplateCost): NameplatePreview {
    return { version: 1, cost: () => cost, analysis: () => ({ layers: [] }) } as unknown as NameplatePreview
}

const UNFINISHED: EngineIssue = { code: 'flash_unchecked', level: 'error', path: 'manifest.json', message: '', values: { checked: 12, scenarios: 40 } }

function reportOf(issues: EngineIssue[], flashChecked = true) {
    return costReport({ preview: previewOf(plainCost(issues, flashChecked)), skipped: null, issues: [], warnings: [] } as any, flashChecked)
}

test('a flash check that ran out of time blocks export instead of passing', () => {
    assert.ok(BUDGET_ISSUE_CODES.has('flash_unchecked'))
    const report = reportOf([UNFINISHED])
    const flash = report.rows.find((row) => row.id === 'flash')!
    assert.deepEqual([flash.value, flash.over, report.status, report.flashPending], ["Didn't finish", true, 'over', false])
    assert.equal(flash.note, "It checked 12 of 40 cases before it ran out of time, so it can't be exported. Use fewer or smaller layers that change, or a shorter loop.")
    assert.equal(report.headline, "The flash check didn't finish, so export is blocked. Use fewer or smaller layers that change, or a shorter loop.")
    const summary = costSummary(report)
    assert.deepEqual([summary.state, summary.text], ['over', report.headline])
    const text = issueMessage('flash_unchecked', { checked: 12, scenarios: 40 }, {})
    assert.match(text, /12 of 40.*can't be exported|can't be exported.*12 of 40/)
    assert.doesNotMatch(text, /may still flash/)
})

test('a finished flash check with no flashing still passes, and one still running says so', () => {
    const report = reportOf([])
    assert.deepEqual([report.rows.find((row) => row.id === 'flash')!.value, report.status, report.headline], ['Passes', 'ok', 'Everything is within the limits.'])
    const pending = reportOf([UNFINISHED], false)
    assert.deepEqual([pending.rows.find((row) => row.id === 'flash')!.value, pending.flashPending], ['Checking...', true])
})
