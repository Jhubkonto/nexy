export type { BackgroundActivity, BackgroundActivityKind } from '../../shared/types'

export interface Conversation {
  id: string
  agent_id: string | null
  model?: string | null
  conversation_hermes_profile?: string | null
  pinned?: number
  project_id?: string | null
  title: string
  created_at: number
  updated_at: number
  completed_at?: number | null
  thinking_effort_override?: 'low' | 'medium' | 'high' | 'max' | 'disabled' | null
  full_auto_approve_override?: number | null
  agentic_mode_override?: number | null
  terminal_sandbox_override?: number | null
  cli_mode_override?: string | null
  codex_execution_mode_override?: string | null
  rating?: number | null
  kind?: 'chat' | 'project-conversation-mode'
}

export interface Project {
  id: string
  name: string
  color: string
  default_model?: string | null
  project_hermes_profile?: string | null
  created_at: number
  updated_at: number
}

import type { AuthMode } from '../../shared/types'
export type { SkillConfig } from '../../shared/types'

export interface AuthState {
  authenticated: boolean
  mode: AuthMode
  user: null
  cliInstalled: boolean
  clis: {
    claude: boolean
    codex: boolean
    hermes?: boolean
  }
}

export interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
  action?: { label: string; onClick: () => void }
}

export interface ToolApprovalRequest {
  requestId: string
  tool: string
  args: Record<string, unknown>
  description: string
}

export interface ProjectAgent {
  agentId: string
  agentName: string
  agentIcon: string
  isPrimary: boolean
  sortOrder: number
}

export interface DeleteAgentImpact {
  agentId: string
  agentName: string
  affectedProjects: { id: string; name: string; is_primary: number }[]
  affectedConvCount: number
}

export type {
  ProjectOrchestrationConfig,
  ScopeRule,
  Milestone,
  ProjectVariable,
  ProjectConfig,
} from '../../shared/types'
export { DEFAULT_PROJECT_CONFIG } from '../../shared/types'

export type Theme = 'light' | 'dark'
export type UiStyle = 'classic' | '8bit'
export type MarkdownViewMode = 'rendered' | 'raw'
export type ActiveSectionPane = 'projects' | 'agents' | 'chats' | 'pinned' | 'skills' | 'scheduled' | 'workflows' | 'artifacts' | 'ratings' | null
export type ProjectSettingsTab = 'general' | 'scope' | 'milestones' | 'team' | 'workflow' | 'wiki' | 'artifacts' | 'capabilities'

/** Sidebar sections that surface a "new item ready" badge when background generation completes. */
export type SectionBadgeKey = 'projects' | 'agents' | 'skills' | 'scheduled' | 'workflows'

/** A finished desktop or Android build/test/package run, surfaced in the top bar (not the sidebar) since it's triggered from Settings rather than a project/agent-style list. */
export interface BuildNotification {
  id: string
  label: string
  status: 'success' | 'failed' | 'cancelled'
  platform: 'desktop' | 'android'
  timestamp: number
}
