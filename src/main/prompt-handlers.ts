import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import type { PromptLibraryEntry, PromptLibraryInput, PromptLibraryUpdate, PromptLibraryVersion, PromptVersionDiff } from '../shared/types'
import { extractPromptVariables } from '../shared/prompt-variables'

type PromptRow = {
  id: string
  title: string
  body: string
  description: string
  category: string
  tags: string
  scope: 'global' | 'project'
  project_id: string | null
  created_at: number
  updated_at: number
}

type PromptVersionRow = PromptRow & {
  prompt_id: string
  version: number
  source: string
}

export function isPromptVisibleForProject(
  prompt: { scope: string; project_id: string | null },
  projectId?: string | null,
): boolean {
  if (prompt.scope === 'global') return true
  const requestedProjectId = typeof projectId === 'string' ? projectId.trim() : ''
  const promptProjectId = typeof prompt.project_id === 'string' ? prompt.project_id.trim() : ''
  return prompt.scope === 'project' && Boolean(requestedProjectId) && promptProjectId === requestedProjectId
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (tags ?? [])
        .map((tag) => String(tag).trim())
        .filter(Boolean)
    )
  ).slice(0, 20)
}

function normalizeScope(input: Pick<PromptLibraryInput, 'scope' | 'project_id'>): {
  scope: 'global' | 'project'
  projectId: string | null
} {
  const scope = input.scope === 'project' ? 'project' : 'global'
  const projectId = scope === 'project' ? (input.project_id ?? null) : null
  if (scope === 'project' && !projectId) {
    throw new Error('Project-scoped prompts require a project')
  }
  return { scope, projectId }
}

function parseRow(row: PromptRow): PromptLibraryEntry {
  return {
    ...row,
    tags: parseTags(row.tags),
    variables: extractPromptVariables(row.body),
  }
}

function lineDiff(previous: string, current: string): Pick<PromptVersionDiff, 'addedLines' | 'removedLines'> {
  const previousLines = String(previous ?? '').split(/\r?\n/)
  const currentLines = String(current ?? '').split(/\r?\n/)
  const previousCounts = new Map<string, number>()
  const currentCounts = new Map<string, number>()
  for (const line of previousLines) previousCounts.set(line, (previousCounts.get(line) ?? 0) + 1)
  for (const line of currentLines) currentCounts.set(line, (currentCounts.get(line) ?? 0) + 1)

  const removedLines = previousLines.filter((line) => {
    const currentCount = currentCounts.get(line) ?? 0
    if (currentCount > 0) {
      currentCounts.set(line, currentCount - 1)
      return false
    }
    return line.trim().length > 0
  })
  const addedLines = currentLines.filter((line) => {
    const previousCount = previousCounts.get(line) ?? 0
    if (previousCount > 0) {
      previousCounts.set(line, previousCount - 1)
      return false
    }
    return line.trim().length > 0
  })

  return { addedLines, removedLines }
}

function buildDiff(previous: PromptVersionRow | null, current: PromptVersionRow): PromptVersionDiff {
  if (!previous) {
    return {
      titleChanged: true,
      descriptionChanged: Boolean(current.description),
      categoryChanged: true,
      tagsChanged: parseTags(current.tags).length > 0,
      scopeChanged: current.scope !== 'global',
      addedLines: String(current.body ?? '').split(/\r?\n/).filter((line) => line.trim().length > 0),
      removedLines: [],
    }
  }
  return {
    titleChanged: previous.title !== current.title,
    descriptionChanged: previous.description !== current.description,
    categoryChanged: previous.category !== current.category,
    tagsChanged: previous.tags !== current.tags,
    scopeChanged: previous.scope !== current.scope || previous.project_id !== current.project_id,
    ...lineDiff(previous.body, current.body),
  }
}

function parseVersionRow(row: PromptVersionRow, previous: PromptVersionRow | null): PromptLibraryVersion {
  return {
    ...row,
    tags: parseTags(row.tags),
    variables: extractPromptVariables(row.body),
    diff: buildDiff(previous, row),
  }
}

export function listPromptLibraryVersions(
  db: Database.Database,
  promptId: string
): PromptLibraryVersion[] {
  const rows = db.prepare(
    'SELECT * FROM prompt_library_versions WHERE prompt_id = ? ORDER BY version ASC'
  ).all(promptId) as PromptVersionRow[]

  return rows.map((row, index) => parseVersionRow(row, rows[index - 1] ?? null)).reverse()
}

function recordPromptVersion(db: Database.Database, promptId: string, source = 'manual'): void {
  const row = db.prepare('SELECT * FROM prompt_library_entries WHERE id = ?').get(promptId) as PromptRow | undefined
  if (!row) return
  const nextVersion = ((db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM prompt_library_versions WHERE prompt_id = ?').get(promptId) as { version: number }).version ?? 0) + 1
  db.prepare(
    `INSERT INTO prompt_library_versions
      (id, prompt_id, version, title, body, description, category, tags, scope, project_id, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    promptId,
    nextVersion,
    row.title,
    row.body,
    row.description,
    row.category,
    row.tags,
    row.scope,
    row.project_id,
    source,
    Date.now(),
  )
}

export function insertPromptLibraryEntry(
  db: Database.Database,
  input: PromptLibraryInput
): PromptLibraryEntry {
  const title = String(input.title ?? '').trim().slice(0, 200)
  const body = String(input.body ?? '')
  if (!title) throw new Error('Prompt title is required')
  if (!body.trim()) throw new Error('Prompt body is required')

  const { scope, projectId } = normalizeScope(input)
  const id = randomUUID()
  const now = Date.now()

  db.prepare(
    'INSERT INTO prompt_library_entries (id, title, body, description, category, tags, scope, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    title,
    body,
    String(input.description ?? '').trim().slice(0, 500),
    String(input.category ?? 'Custom').trim().slice(0, 80) || 'Custom',
    JSON.stringify(normalizeTags(input.tags)),
    scope,
    projectId,
    now,
    now,
  )

  recordPromptVersion(db, id, 'manual-create')
  return parseRow(db.prepare('SELECT * FROM prompt_library_entries WHERE id = ?').get(id) as PromptRow)
}

export function updatePromptLibraryEntry(
  db: Database.Database,
  id: string,
  fields: PromptLibraryUpdate
): PromptLibraryEntry {
  const row = db.prepare('SELECT * FROM prompt_library_entries WHERE id = ?').get(id) as PromptRow | undefined
  if (!row) throw new Error('Prompt not found')

  const nextScope = normalizeScope({
    scope: fields.scope ?? row.scope,
    project_id: fields.project_id !== undefined ? fields.project_id : row.project_id,
  })
  const title = fields.title !== undefined ? String(fields.title).trim().slice(0, 200) : row.title
  const body = fields.body !== undefined ? String(fields.body) : row.body
  if (!title) throw new Error('Prompt title is required')
  if (!body.trim()) throw new Error('Prompt body is required')

  db.prepare(
    `UPDATE prompt_library_entries
     SET title = ?, body = ?, description = ?, category = ?, tags = ?, scope = ?, project_id = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    title,
    body,
    fields.description !== undefined ? String(fields.description).trim().slice(0, 500) : row.description,
    fields.category !== undefined ? (String(fields.category).trim().slice(0, 80) || 'Custom') : row.category,
    fields.tags !== undefined ? JSON.stringify(normalizeTags(fields.tags)) : row.tags,
    nextScope.scope,
    nextScope.projectId,
    Date.now(),
    id,
  )

  recordPromptVersion(db, id, 'manual-edit')
  return parseRow(db.prepare('SELECT * FROM prompt_library_entries WHERE id = ?').get(id) as PromptRow)
}

export function rollbackPromptLibraryEntry(
  db: Database.Database,
  promptId: string,
  version: number
): PromptLibraryEntry {
  const snapshot = db.prepare(
    'SELECT * FROM prompt_library_versions WHERE prompt_id = ? AND version = ?'
  ).get(promptId, version) as PromptVersionRow | undefined
  if (!snapshot) throw new Error('Prompt version not found')

  db.prepare(
    `UPDATE prompt_library_entries
     SET title = ?, body = ?, description = ?, category = ?, tags = ?, scope = ?, project_id = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    snapshot.title,
    snapshot.body,
    snapshot.description,
    snapshot.category,
    snapshot.tags,
    snapshot.scope,
    snapshot.project_id,
    Date.now(),
    promptId,
  )

  recordPromptVersion(db, promptId, `rollback-v${version}`)
  return parseRow(db.prepare('SELECT * FROM prompt_library_entries WHERE id = ?').get(promptId) as PromptRow)
}

export function registerPromptHandlers(): void {
  const db = getDatabase()

  safeHandle('prompt:list', (_event, projectId?: string | null) => {
    const rows = db.prepare(
      `SELECT * FROM prompt_library_entries
       ORDER BY category COLLATE NOCASE ASC, updated_at DESC`
    ).all() as PromptRow[]
    return rows.filter((row) => isPromptVisibleForProject(row, projectId)).map(parseRow)
  })

  safeHandle('prompt:create', (_event, input: PromptLibraryInput) => {
    return insertPromptLibraryEntry(db, input)
  })

  safeHandle('prompt:list-versions', (_event, promptId: string) => {
    return listPromptLibraryVersions(db, promptId)
  })

  safeHandle('prompt:rollback', (_event, promptId: string, version: number) => {
    return rollbackPromptLibraryEntry(db, promptId, version)
  })

  safeHandle('prompt:update', (_event, id: string, fields: PromptLibraryUpdate) => {
    return updatePromptLibraryEntry(db, id, fields)
  })

  safeHandle('prompt:delete', (_event, id: string) => {
    db.prepare('DELETE FROM prompt_library_entries WHERE id = ?').run(id)
    return true
  })
}
