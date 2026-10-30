/** A provider-neutral, safe-to-render view of work delegated during a chat turn. */
export type DelegationNodeStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'cancel-requested'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'unknown'

export interface DelegationNodeCapabilities {
  canCancel: boolean
  canSteer: boolean
  canViewTail: boolean
}

export interface DelegationNodeSnapshot {
  id: string
  parentId: string | null
  label: string
  task?: string
  backend: string
  status: DelegationNodeStatus
  capabilities: DelegationNodeCapabilities
  startedAt: number
  updatedAt: number
  finishedAt?: number
  detail?: string
  tail?: string
}

export interface DelegationRunSnapshot {
  id: string
  conversationId: string
  backend: string
  detailsVisible: boolean
  status: DelegationNodeStatus
  startedAt: number
  updatedAt: number
  nodes: DelegationNodeSnapshot[]
}

export type DelegationCancelResult = 'accepted' | 'unsupported' | 'already-terminal' | 'not-found'
