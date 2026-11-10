export interface WorkHistoryRequest {
  start: number
  end: number
  model: string
  grouping: 'project' | 'chat' | 'agent' | 'custom'
  instructions: string
  projectId?: string | null
  agentId?: string | null
  conversationIds?: string[]
}

export interface WorkHistorySource {
  id: string
  title: string
  projectId: string | null
  projectName: string | null
  agentId: string | null
  agentName: string | null
  archived: boolean
  messageCount: number
  estimatedCharacters: number
  available?: boolean
}

export interface WorkHistoryRun {
  id: string
  request: WorkHistoryRequest
  sources: WorkHistorySource[]
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  progress: string
  report: string | null
  artifactId?: string | null
  artifactVersionId?: string | null
  error: string | null
  createdAt: number
  finishedAt: number | null
}
export interface WorkHistoryCapability {
  id: 'api' | 'claude' | 'codex' | 'hermes'
  available: boolean
  reason: string
}


/** Opt-in access for CLI sessions started outside Nexy. Setup includes a secret token. */
export interface WorkHistoryExternalAccess {
  enabled: boolean
  startedAt: number | null
  setup: { claude: string; codex: string; hermes: string } | null
}

export type WorkHistoryPreset = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'custom'

export const WORK_HISTORY_PRESETS: Array<{ id: WorkHistoryPreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this-week', label: 'This week' },
  { id: 'last-week', label: 'Last week' },
  { id: 'custom', label: 'Custom' },
]

/** Local calendar date as YYYY-MM-DD. */
export function workHistoryLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Inclusive local dates for a preset (weeks run Monday–Sunday); null for 'custom'. */
export function workHistoryPresetDates(preset: WorkHistoryPreset, today: Date): { first: string; last: string } | null {
  const day = (offset: number, from = today) => { const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset); return workHistoryLocalDate(d) }
  const mondayOffset = -((today.getDay() + 6) % 7)
  switch (preset) {
    case 'today': return { first: day(0), last: day(0) }
    case 'yesterday': return { first: day(-1), last: day(-1) }
    case 'this-week': return { first: day(mondayOffset), last: day(mondayOffset + 6) }
    case 'last-week': return { first: day(mondayOffset - 7), last: day(mondayOffset - 1) }
    default: return null
  }
}

/** Half-open epoch-ms interval covering local calendar dates first..last, DST-safe. */
export function workHistoryRange(first: string, last: string): { start: number; end: number } {
  const [fy, fm, fd] = first.split('-').map(Number)
  const [ly, lm, ld] = last.split('-').map(Number)
  const start = new Date(fy, fm - 1, fd).getTime()
  const end = new Date(ly, lm - 1, ld + 1).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('The end date must not be before the start date')
  return { start, end }
}

/** Chat titles can hold markdown headings and several lines; show one clean line. */
export function cleanWorkHistoryTitle(raw: string | null | undefined): string {
  for (const line of (raw ?? '').split(/\r?\n/)) {
    const clean = line.trim().replace(/^[#>*\-\s]+/, '').trim()
    if (clean) return clean
  }
  return 'Untitled chat'
}

/** Raw `[source:ID]` citations become the cited chat's title in parentheses. */
export function workHistoryReportWithTitles(report: string, titles: Map<string, string>): string {
  return report.replace(/\[source:([^\]\r\n]+)\]/gi, (_match, id: string) => {
    const title = titles.get(id.trim())
    return `(${title ? cleanWorkHistoryTitle(title) : 'source'})`
  })
}
