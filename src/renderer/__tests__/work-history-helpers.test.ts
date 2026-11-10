import { describe, expect, it } from 'vitest'
import { cleanWorkHistoryTitle, workHistoryPresetDates, workHistoryRange, workHistoryReportWithTitles } from '../../shared/work-history'

describe('work history helpers', () => {
  const thursday = new Date(2026, 9, 29, 15, 30)

  it('computes presets with Monday–Sunday weeks', () => {
    expect(workHistoryPresetDates('today', thursday)).toEqual({ first: '2026-10-29', last: '2026-10-29' })
    expect(workHistoryPresetDates('yesterday', thursday)).toEqual({ first: '2026-10-28', last: '2026-10-28' })
    expect(workHistoryPresetDates('this-week', thursday)).toEqual({ first: '2026-10-26', last: '2026-11-01' })
    expect(workHistoryPresetDates('last-week', thursday)).toEqual({ first: '2026-10-19', last: '2026-10-25' })
    expect(workHistoryPresetDates('this-week', new Date(2026, 10, 1))).toEqual({ first: '2026-10-26', last: '2026-11-01' })
    expect(workHistoryPresetDates('custom', thursday)).toBeNull()
  })

  it('builds half-open local ranges and rejects reversed dates', () => {
    const { start, end } = workHistoryRange('2026-10-29', '2026-10-29')
    expect(start).toBe(new Date(2026, 9, 29).getTime())
    expect(end).toBe(new Date(2026, 9, 30).getTime())
    expect(() => workHistoryRange('2026-10-30', '2026-10-29')).toThrow()
  })

  it('cleans markdown titles and replaces citations', () => {
    expect(cleanWorkHistoryTitle('# feature/x\n\n## Review')).toBe('feature/x')
    expect(cleanWorkHistoryTitle('')).toBe('Untitled chat')
    expect(workHistoryReportWithTitles('Done [source:a], see [source:b].', new Map([['a', '## Auth']]))).toBe('Done (Auth), see (source).')
  })
})
