import assert from 'node:assert/strict'
import test from 'node:test'
import { issueMessage } from '../src/engine'
import { molangIssueText } from '../src/molang/probe'

const FORMULA_CODES = [
    'molang', 'molang_empty', 'molang_unexpected', 'molang_too_long', 'molang_too_deep', 'molang_too_big', 'molang_unterminated',
    'molang_character', 'molang_string', 'molang_value', 'molang_uncalled', 'molang_unknown_name', 'molang_not_query',
    'molang_unknown_query', 'molang_query_place', 'molang_assign', 'molang_variable_name', 'molang_variables',
    'molang_unknown_function', 'molang_unknown_math', 'molang_param_call', 'molang_arguments', 'molang_cost',
    'molang_constant', 'molang_unknown_root', 'molang_unsupported',
]

test('formula codes read as a sentence with and without the engine giving names', () => {
    for (const code of FORMULA_CODES) {
        const message = issueMessage(code, {}, {})
        assert.ok(message, code)
        const text = molangIssueText({ path: '', code, level: 'error', values: {}, names: {}, message }, 'channel')
        assert.match(text, /^([A-Z]|q\.).*\.$/, code)
        assert.ok(!/''|q\. is not|math\. is not|^\( \)|than 0\b|\b0 work|more than 0\b/.test(text), `${code}: ${text}`)
    }
})

