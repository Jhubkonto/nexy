import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { broadcastToMobile } from './ws-server'
import type {
  DelegationCancelResult,
  DelegationNodeCapabilities,
  DelegationNodeSnapshot,
  DelegationNodeStatus,
  DelegationRunSnapshot,
} from '../shared/delegation'

const TERMINAL_TTL_MS = 10 * 60_000
const MAX_TAIL_LENGTH = 8 * 1024
const TERMINAL = new Set<DelegationNodeStatus>(['done', 'failed', 'cancelled'])
const NONE: DelegationNodeCapabilities = { canCancel: false, canSteer: false, canViewTail: false }

interface MutableNode extends DelegationNodeSnapshot { cancel?: () => void }
interface MutableRun extends Omit<DelegationRunSnapshot, 'nodes'> { nodes: Map<string, MutableNode> }

const runs = new Map<string, MutableRun>()

function snapshot(run: MutableRun): DelegationRunSnapshot {
  const nodes = [...run.nodes.values()].map(({ cancel: _cancel, ...node }) => {
    if (!run.detailsVisible && node.parentId !== null) {
      return {
        id: node.id, parentId: node.parentId, label: 'Specialist', backend: node.backend,
        status: node.status, capabilities: node.capabilities, startedAt: node.startedAt,
        updatedAt: node.updatedAt, finishedAt: node.finishedAt,
      }
    }
    return node
  })
  return structuredClone({ ...run, nodes })
}

function publish(run: MutableRun): void {
  const payload = snapshot(run)
  // The Electron module is deliberately partial in unit tests and before app readiness.
  for (const window of BrowserWindow?.getAllWindows?.() ?? []) {
    if (!window.isDestroyed()) window.webContents.send('chat:delegation-updated', payload)
  }
  broadcastToMobile({ event: 'chat:delegation-updated', data: payload })
}

function refreshRunStatus(run: MutableRun): void {
  const nodes = [...run.nodes.values()]
  const root = nodes.find((node) => node.parentId === null)
  run.status = root?.status ?? (nodes.some((node) => node.status === 'running') ? 'running' : 'unknown')
  run.updatedAt = Date.now()
}

function prune(now = Date.now()): void {
  for (const [id, run] of runs) {
    if (TERMINAL.has(run.status) && now - run.updatedAt >= TERMINAL_TTL_MS) runs.delete(id)
  }
}

export function createDelegationRun(input: { conversationId: string; backend: string; label: string; detailsVisible?: boolean; onCancel?: () => void }): { runId: string; rootId: string } {
  prune()
  const now = Date.now()
  const runId = randomUUID()
  const rootId = randomUUID()
  const run: MutableRun = {
    id: runId, conversationId: input.conversationId, backend: input.backend, detailsVisible: input.detailsVisible !== false,
    status: 'running', startedAt: now, updatedAt: now, nodes: new Map(),
  }
  run.nodes.set(rootId, {
    id: rootId, parentId: null, label: input.label, backend: input.backend, status: 'running',
    capabilities: { ...NONE, canCancel: true }, startedAt: now, updatedAt: now, cancel: input.onCancel,
  })
  runs.set(runId, run)
  publish(run)
  return { runId, rootId }
}

export function addDelegationNode(runId: string, input: Omit<DelegationNodeSnapshot, 'startedAt' | 'updatedAt' | 'status'> & { status?: DelegationNodeStatus; onCancel?: () => void }): void {
  const run = runs.get(runId)
  if (!run) return
  const now = Date.now()
  const { onCancel, ...node } = input
  run.nodes.set(input.id, {
    ...node, status: input.status ?? 'queued', startedAt: now, updatedAt: now, cancel: onCancel,
  })
  refreshRunStatus(run)
  publish(run)
}

export function updateDelegationNode(runId: string, nodeId: string, patch: Partial<Pick<DelegationNodeSnapshot, 'status' | 'detail' | 'tail' | 'capabilities'>>): void {
  const run = runs.get(runId)
  const node = run?.nodes.get(nodeId)
  if (!run || !node) return
  if (patch.tail !== undefined) node.tail = `${node.tail ?? ''}${patch.tail}`.slice(-MAX_TAIL_LENGTH)
  if (patch.detail !== undefined) node.detail = patch.detail.slice(0, MAX_TAIL_LENGTH)
  if (patch.status !== undefined) {
    node.status = patch.status
    if (TERMINAL.has(patch.status)) node.finishedAt = Date.now()
  }
  if (patch.capabilities !== undefined) node.capabilities = patch.capabilities
  node.updatedAt = Date.now()
  refreshRunStatus(run)
  publish(run)
}

export function getDelegationRuns(conversationId?: string): DelegationRunSnapshot[] {
  prune()
  return [...runs.values()].filter((run) => !conversationId || run.conversationId === conversationId).map(snapshot)
}

export function cancelDelegationNode(nodeId: string): DelegationCancelResult {
  for (const run of runs.values()) {
    const node = run.nodes.get(nodeId)
    if (!node) continue
    if (TERMINAL.has(node.status)) return 'already-terminal'
    if (!node.capabilities.canCancel || !node.cancel) return 'unsupported'
    node.status = 'cancel-requested'
    node.updatedAt = Date.now()
    refreshRunStatus(run)
    publish(run)
    node.cancel()
    return 'accepted'
  }
  return 'not-found'
}

/** Cancels every controllable node belonging to one conversation. */
export function cancelDelegationForConversation(conversationId: string): void {
  for (const run of runs.values()) {
    if (run.conversationId !== conversationId) continue
    for (const node of run.nodes.values()) {
      if (!TERMINAL.has(node.status) && node.status !== 'cancel-requested' && node.capabilities.canCancel && node.cancel) {
        node.status = 'cancel-requested'
        node.updatedAt = Date.now()
        node.cancel()
      }
    }
    refreshRunStatus(run)
    publish(run)
  }
}

export function isDelegationNodeCancelRequested(runId: string, nodeId: string): boolean {
  return runs.get(runId)?.nodes.get(nodeId)?.status === 'cancel-requested'
}

export function resetDelegationRegistryForTest(): void { runs.clear() }
