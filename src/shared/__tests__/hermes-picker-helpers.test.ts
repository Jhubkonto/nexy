import { describe, expect, it } from 'vitest'
import {
  HERMES_DEFAULT_PROFILE,
  hermesProfileLabel,
  hermesSourceKey,
  parseHermesSourceKey,
  resolveEffectiveHermesProfile,
} from '../hermes'

describe('hermes model picker helpers', () => {
  it('builds and parses profile group source keys', () => {
    expect(hermesSourceKey('localllm')).toBe('hermes-cli:localllm')
    expect(hermesSourceKey('default')).toBe('hermes-cli:default')
    expect(parseHermesSourceKey('hermes-cli:localllm')).toBe('localllm')
    expect(parseHermesSourceKey('hermes-cli:default')).toBe('default')
  })

  it('returns null for non-Hermes source keys', () => {
    expect(parseHermesSourceKey('claude-cli')).toBeNull()
    expect(parseHermesSourceKey('openrouter')).toBeNull()
    expect(parseHermesSourceKey('hermes-cli:')).toBeNull()
    expect(parseHermesSourceKey('')).toBeNull()
  })

  it('labels default and named profiles distinctly', () => {
    expect(hermesProfileLabel('default', true)).toBe('Hermes · Default')
    expect(hermesProfileLabel('localllm', false)).toBe('Hermes · localllm')
    expect(hermesProfileLabel('localllm-iso')).toBe('Hermes · localllm-iso')
  })

  it('resolves profile precedence: conversation → agent → default', () => {
    expect(resolveEffectiveHermesProfile('conv-profile', 'agent-profile')).toBe('conv-profile')
    expect(resolveEffectiveHermesProfile(null, 'agent-profile')).toBe('agent-profile')
    expect(resolveEffectiveHermesProfile(undefined, '')).toBe(HERMES_DEFAULT_PROFILE)
    expect(resolveEffectiveHermesProfile('  ', null)).toBe(HERMES_DEFAULT_PROFILE)
  })
})
