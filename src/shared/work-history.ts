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
