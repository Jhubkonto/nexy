import { describe, expect, it } from 'vitest'
import { parseHistoryClaudeResponse } from '../work-history-claude'

describe('Claude CLI history response', () => {
  it('accepts only a successful response with a confirmed end of turn', () => {
    expect(parseHistoryClaudeResponse(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Work [source:a]', stop_reason: 'end_turn' }))).toEqual({ content: 'Work [source:a]', finishReason: 'end_turn' })
    for (const stop_reason of [undefined, 'max_tokens', 'tool_use']) {
      expect(() => parseHistoryClaudeResponse(JSON.stringify({ type: 'result', subtype: 'success', result: 'partial', stop_reason }))).toThrow('did not confirm')
    }
    expect(() => parseHistoryClaudeResponse(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'failure', stop_reason: 'end_turn' }))).toThrow('did not complete')
    expect(() => parseHistoryClaudeResponse('invalid')).toThrow('invalid JSON')
  })
})
