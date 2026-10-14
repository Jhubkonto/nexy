import { describe, expect, it } from 'vitest'
import { localPathFromHref } from '../lib/link-routing'

describe('local markdown link routing', () => {
  it('recognizes native Windows paths', () => {
    expect(localPathFromHref('C:\\Users\\Julian\\artifact.md')).toBe('C:\\Users\\Julian\\artifact.md')
    expect(localPathFromHref('C:/Users/Julian/artifact.md')).toBe('C:/Users/Julian/artifact.md')
    expect(localPathFromHref('/C:/Users/Julian/artifact%20one.md')).toBe('C:/Users/Julian/artifact one.md')
  })

  it('converts file URLs into paths', () => {
    expect(localPathFromHref('file:///C:/Users/Julian/artifact%20one.md')).toBe('C:/Users/Julian/artifact one.md')
    expect(localPathFromHref('file://server/share/artifact.md')).toBe('\\\\server\\share\\artifact.md')
  })

  it('does not intercept web or relative links', () => {
    expect(localPathFromHref('https://example.com/artifact.md')).toBeNull()
    expect(localPathFromHref('../artifact.md')).toBeNull()
  })
})
