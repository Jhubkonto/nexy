import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type { WorkHistoryRequest, WorkHistorySource } from '../shared/work-history'
import { writeManagedArtifactVersion } from './artifacts'
import { previewWorkHistory, snapshotWorkHistory, validateHistoryReferences, type HistoryBatch } from './work-history'

const SNAPSHOT_TTL_MS = 60 * 60 * 1000
const MAX_SELECTIONS = 16
const MAX_SUMMARY = 12000
const MAX_REPORT = 200000

interface Selection {
  request: WorkHistoryRequest
  sources: WorkHistorySource[]
  batches: HistoryBatch[]
  read: Set<number>
  summaries: Map<number, string>
  expiresAt: number
  expiryTimer: ReturnType<typeof setTimeout>
  savedReport?: string
}

/** Per-connection selections. No raw transcript is written to disk. */
export class WorkHistorySelections {
  private readonly selections = new Map<string, Selection>()

  constructor(private readonly db: Database.Database, private readonly now: () => number = Date.now) {}

  private get(id: string): Selection {
    const selection = this.selections.get(id)
    if (!selection || selection.expiresAt <= this.now()) {
      if (selection) clearTimeout(selection.expiryTimer)
      this.selections.delete(id)
      throw new Error('History selection has expired or does not exist')
    }
    // Sliding expiry: an actively used selection (e.g. saved in a later chat turn) stays available.
    clearTimeout(selection.expiryTimer)
    selection.expiresAt = this.now() + SNAPSHOT_TTL_MS
    selection.expiryTimer = setTimeout(() => this.selections.delete(id), SNAPSHOT_TTL_MS)
    selection.expiryTimer.unref?.()
    return selection
  }

  progress(id: string): { batchCount: number; summarized: number; remaining: number[] } {
    const selection = this.get(id)
    const remaining = selection.batches.map((_, index) => index).filter(index => !selection.summaries.has(index))
    return { batchCount: selection.batches.length, summarized: selection.summaries.size, remaining }
  }

  sources(id: string): WorkHistorySource[] {
    return structuredClone(this.get(id).sources)
  }

  preview(request: WorkHistoryRequest): WorkHistorySource[] {
    return previewWorkHistory(this.db, request)
  }

  freeze(request: WorkHistoryRequest): { selectionId: string; sources: WorkHistorySource[]; batchCount: number; expiresAt: number } {
    for (const [id, selection] of this.selections) {
      if (selection.expiresAt <= this.now()) {
        clearTimeout(selection.expiryTimer)
        this.selections.delete(id)
      }
    }
    if (this.selections.size >= MAX_SELECTIONS) throw new Error('Too many active history selections')
    let sources: WorkHistorySource[] = []
    let batches: HistoryBatch[] = []
    this.db.transaction(() => {
      sources = previewWorkHistory(this.db, request)
      batches = snapshotWorkHistory(this.db, request, sources)
    })()
    if (!batches.length) throw new Error('No matching activity selected')
    const id = randomUUID(), expiresAt = this.now() + SNAPSHOT_TTL_MS
    const expiryTimer = setTimeout(() => this.selections.delete(id), SNAPSHOT_TTL_MS)
    expiryTimer.unref?.()
    this.selections.set(id, { request: structuredClone(request), sources, batches, read: new Set(), summaries: new Map(), expiresAt, expiryTimer })
    return { selectionId: id, sources: structuredClone(sources), batchCount: batches.length, expiresAt }
  }

  readBatch(id: string, index: number): { index: number; text: string; sourceIds: string[] } {
    const selection = this.get(id)
    if (!Number.isSafeInteger(index) || index < 0 || index >= selection.batches.length) throw new Error('Invalid batch index')
    selection.read.add(index)
    const batch = selection.batches[index]
    return { index, text: batch.text, sourceIds: [...batch.sourceIds] }
  }

  submitBatch(id: string, index: number, summary: string): void {
    const selection = this.get(id)
    if (!Number.isSafeInteger(index) || !selection.read.has(index)) throw new Error('Read the batch before submitting its summary')
    if (typeof summary !== 'string' || !summary.trim() || summary.length > MAX_SUMMARY) throw new Error('Invalid batch summary')
    validateHistoryReferences(summary, selection.batches[index].sourceIds)
    const existing = selection.summaries.get(index)
    if (existing !== undefined && existing !== summary) throw new Error('Batch already has a different summary')
    selection.summaries.set(index, summary)
  }

  getSummaries(id: string): string[] {
    const selection = this.get(id)
    if (selection.summaries.size !== selection.batches.length) throw new Error('All batches must be summarized first')
    return selection.batches.map((_, index) => selection.summaries.get(index)!)
  }

  save(id: string, report: string): string {
    const selection = this.get(id)
    const summaries = this.getSummaries(id)
    if (typeof report !== 'string' || !report.trim() || report.length > MAX_REPORT) throw new Error('Invalid report')
    const allowed = new Set(summaries.flatMap(summary => [...summary.matchAll(/\[source:([^\]\r\n]+)\]/gi)].map(match => match[1])))
    validateHistoryReferences(report, allowed)
    if (selection.savedReport !== undefined) {
      if (selection.savedReport !== report) throw new Error('Selection was already saved with a different report')
      return id
    }
    const { request, sources } = selection
    const artifact = writeManagedArtifactVersion({
      projectId: null, title: `Work history ${new Date(request.start).toISOString().slice(0, 10)}`,
      kind: 'history-report', description: 'Work history report',
      files: [{ relativePath: 'report.md', mediaType: 'text/markdown', role: 'primary', content: report }],
      manifest: { workHistoryRunId: id, request, sources },
    })
    this.db.prepare("INSERT INTO work_history_runs (id, request_json, sources_json, status, progress, report, artifact_id, artifact_version_id, created_at, finished_at) VALUES (?, ?, ?, 'completed', 'Completed', ?, ?, ?, ?, ?)")
      .run(id, JSON.stringify(request), JSON.stringify(sources), report, artifact.artifactId, artifact.versionId, this.now(), this.now())
    selection.savedReport = report
    return id
  }

  close(): void {
    for (const selection of this.selections.values()) clearTimeout(selection.expiryTimer)
    this.selections.clear()
  }
}
