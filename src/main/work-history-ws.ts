import type Database from 'better-sqlite3'
import type { WorkHistoryRequest } from '../shared/work-history'
import { previewWorkHistory, listWorkHistoryRuns, getWorkHistoryRun, cancelWorkHistoryRun, startWorkHistoryRun, workHistoryCapabilities } from './work-history'

/** Each response includes the caller's request ID, including failures. */
export function handleWorkHistoryCommand(db: Database.Database, command: string, data: Record<string, unknown>): {
  event: string
  data: { requestId: string; operation: string; result?: unknown; error?: string }
} {
  const requestId = typeof data.requestId === 'string' ? data.requestId : ''
  try {
    if (!requestId) throw new Error('A request ID is required')
    let result: unknown
    switch (command) {
      case 'work-history:preview': result = previewWorkHistory(db, data.request as WorkHistoryRequest); break
      case 'work-history:start':
        if (typeof data.runId !== 'string') throw new Error('A run ID is required')
        result = startWorkHistoryRun(db, data.request as WorkHistoryRequest, data.runId); break
      case 'work-history:capabilities': result = workHistoryCapabilities(); break
      case 'work-history:list': result = listWorkHistoryRuns(db); break
      case 'work-history:get': result = getWorkHistoryRun(db, typeof data.id === 'string' ? data.id : ''); break
      case 'work-history:cancel': result = cancelWorkHistoryRun(typeof data.id === 'string' ? data.id : ''); break
      default: throw new Error('Unknown work history operation')
    }
    return { event: 'work-history:result', data: { requestId, operation: command, result } }
  } catch (error) {
    return { event: 'work-history:result', data: { requestId, operation: command, error: error instanceof Error ? error.message : String(error) } }
  }
}
