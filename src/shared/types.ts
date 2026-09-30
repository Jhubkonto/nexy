export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system' | 'team-activity' | 'tool-call'
  content: string
  model?: string | null
  isEdited?: boolean
  previousContent?: string | null
  timestamp: number
  attachments?: Attachment[]
  citations?: import('./citations').Citation[]
}

export type { TokenCount, TokenCountQuality, TokenCountSource, TokenUsage, TurnUsageTotal } from './token-usage'

import type { HermesProfileInfo, HermesProfileDiscovery, HermesAcpReadiness } from './hermes'
export type { HermesProfileInfo, HermesProfileDiscovery, HermesAcpReadiness } from './hermes'

export interface Attachment {
  id: string
  name: string
  path: string
  size: number
}

export interface Conversation {
  id: string
  agentId: string | null
  title: string
  kind?: 'chat' | 'project-conversation-mode'
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

// ---------------------------------------------------------------------------
// Conversation capabilities
// ---------------------------------------------------------------------------

export type CapabilityScope = 'chat' | 'project' | 'agent'
export type CapabilityTrust = 'auto' | 'always-ask' | 'block'
export type BuiltInToolKey = 'fileEdit' | 'terminal' | 'webFetch'
export type BuiltInToolApproval = 'auto' | 'always-ask' | 'disabled'

/**
 * A policy supplied by a capability scope. Omitted means that scope places no
 * restriction on the tool; a false/disabled value can only restrict narrower
 * scopes, never enable a tool an agent has not enabled for itself.
 */
export type BuiltInToolPolicy = {
  enabled: boolean
  approval: BuiltInToolApproval
}

/** Secret-free references to capabilities enabled for one conversation. */
export interface ConversationCapabilityProfile {
  version: 1
  skillIds: string[]
  mcp: Array<{ serverId: string; trust: CapabilityTrust }>
  builtInTools?: Partial<Record<BuiltInToolKey, BuiltInToolPolicy>>
}

export type CapabilityReadiness = 'ready' | 'missing' | 'invalid' | 'disconnected' | 'unsupported'

export interface CapabilityPreflightItem {
  kind: 'skill' | 'mcp' | 'model'
  id: string
  label: string
  status: CapabilityReadiness
  detail: string
  provenance: 'this-chat' | 'agent' | 'project' | 'global'
  requiredCapabilities?: string[]
}

export interface CapabilityPreflight {
  conversationId: string
  profile: ConversationCapabilityProfile
  /** The persisted profile at each editable scope, before inheritance is merged. */
  scopeProfiles: {
    chat: ConversationCapabilityProfile
    project: ConversationCapabilityProfile | null
    agent: ConversationCapabilityProfile | null
  }
  items: CapabilityPreflightItem[]
  ready: boolean
  desktopOnly: boolean
}

export interface CapabilityActivationInput {
  scope: CapabilityScope
  /** Project or agent ID when scope is not chat. Defaults to the conversation's active scope. */
  targetId?: string | null
  skillIds?: string[]
  mcp?: Array<{ serverId: string; trust?: CapabilityTrust }>
}

// ---------------------------------------------------------------------------
// Debrief
// ---------------------------------------------------------------------------

export interface DebriefSection {
  summary: string
  commandsAndTools: string[]
  reproductionGuide: string
  mentalModel: string
}

export interface Debrief {
  id: string
  conversationId: string
  projectId: string | null
  summary: string
  commandsTools: string[]
  reproductionGuide: string
  mentalModel: string
  generatedAt: number
  createdAt: number
}

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------

export interface QuizQuestion {
  id: string
  /** Question format. Defaults to 'mcq' when absent so existing stored quizzes stay valid. */
  kind?: 'mcq'
  question: string
  options: [string, string, string, string]
  correctIndex: 0 | 1 | 2 | 3
  explanation: string
  category: 'command' | 'concept' | 'sequence' | 'approach'
}

export interface QuizResult {
  questionId: string
  selectedIndex: number
  correct: boolean
}

/** Where a quiz draws its material from. */
export type QuizSource = 'conversation' | 'debrief' | 'project'

export type QuizDifficulty = 'easy' | 'medium' | 'hard'

/**
 * A quiz generation request. All fields optional so a bare `/quiz` still works with sensible
 * defaults (source 'conversation', model-chosen count, medium difficulty). Persisted alongside
 * the quiz artifact so "Regenerate" reuses the same intent.
 */
export interface QuizSpec {
  /** Material source. Defaults to 'conversation' (the raw chat transcript). */
  source?: QuizSource
  /** Optional free-text focus, e.g. "the IPC layer". Narrows whichever source is chosen. */
  topic?: string
  /** Difficulty of the generated questions. Defaults to 'medium'. */
  difficulty?: QuizDifficulty
  /** Desired number of questions (clamped 3–12). Omitted → the model picks 5–8. */
  questionCount?: number
  /** Specific question prompts to re-test (used by "re-quiz what I missed"). */
  focusQuestions?: string[]
}

export interface DebriefArtifactResult {
  debrief: Debrief
  artifactId: string
  versionId: string
}

export type StoryMood = 'problem' | 'attempt' | 'discovery' | 'resolution'

/** Narrative tone for a debrief "Story mode" retelling. Defaults to 'adventure', matching the
 * original hardcoded STORY_SYSTEM_PROMPT voice. */
export type DebriefStoryTone = 'adventure' | 'noir' | 'fable' | 'deadpan-technical'

export interface StoryBeat {
  caption: string
  mood: StoryMood
  /** Inline line-art icon for this beat, constrained to a closed SVG grammar — validated
   * client-side before render, with a mood-based emoji fallback if it fails the check. */
  svg: string
}

export interface DebriefStory {
  title: string
  beats: StoryBeat[]
}

export interface DebriefStoryResult {
  story: DebriefStory
  artifactId: string
  versionId: string
}

// ---------------------------------------------------------------------------
// Conversation Ratings
// ---------------------------------------------------------------------------

/**
 * Frozen at rating time (see messages.context_snapshot for the precedent) so a historical
 * rating stays meaningful even after the source agent/skill is renamed or deleted, or the
 * project's workflowMode later changes.
 */
export interface ConversationRatingSnapshot {
  agentId: string | null
  agentName: string | null
  model: string | null
  backend: string | null
  projectId: string | null
  projectName: string | null
  workflowMode: 'single-agent' | 'automated-delegation' | 'orchestrated' | null
  toolNames: string[]
  serverNames: string[]
  skillIds: string[]
  skillNames: string[]
  keywords: string[]
}

export interface ConversationRating {
  id: string
  conversationId: string
  rating: number
  note: string | null
  snapshot: ConversationRatingSnapshot
  createdAt: number
  updatedAt: number
}

/** Denormalized row for the RatingsPane/RatingsScreen table — one row per rated conversation. */
export interface ConversationRatingListItem {
  id: string
  conversationId: string
  conversationTitle: string
  projectId: string | null
  projectName: string | null
  rating: number
  note: string | null
  agentName: string | null
  model: string | null
  toolNames: string[]
  skillNames: string[]
  createdAt: number
  updatedAt: number
}

export interface RatingAggregate {
  label: string
  average: number
  count: number
}

export interface RatingTrendPoint {
  date: string
  average: number
  count: number
}

export interface ConversationRatingStats {
  averageByAgent: RatingAggregate[]
  averageByModel: RatingAggregate[]
  averageBySkill: RatingAggregate[]
  averageByServer: RatingAggregate[]
  averageByProject: RatingAggregate[]
  trend: RatingTrendPoint[]
}

export type BackgroundActivityKind =
  | 'project-generator'
  | 'agent-generator'
  | 'skill-generator'
  | 'scheduler-generator'
  | 'automated-workflow-generator'
  | 'automated-workflow-run'
  | 'debrief-generation'
  | 'quiz-generation'
  | 'teachback-generation'
  | 'chat'
  | 'build'
  | 'orchestration'

export interface BackgroundActivity {
  id: string
  kind: BackgroundActivityKind
  label: string
  detail?: string
  projectId?: string
  projectName?: string
  conversationId?: string
  conversationTitle?: string
  agentId?: string
  agentName?: string
  model?: string
  startedAt: number
}

export interface QuizArtifactResult {
  questions: QuizQuestion[]
  artifactId: string
  versionId: string
  /** The spec this quiz was generated from, when available (so "Regenerate" can reuse it). */
  spec?: QuizSpec
}

export type QuizCategoryBreakdown = Record<string, { correct: number; total: number }>

/** A single completed quiz run, persisted for learning history. */
export interface QuizAttempt {
  id: string
  artifactId: string
  versionId: string
  conversationId: string | null
  projectId: string | null
  score: number
  total: number
  categoryBreakdown: QuizCategoryBreakdown
  /** Prompts of the questions answered incorrectly (feeds "re-quiz what I missed"). */
  missedQuestions: string[]
  attemptedAt: number
}

export interface QuizAttemptInput {
  artifactId: string
  versionId: string
  conversationId?: string | null
  projectId?: string | null
  score: number
  total: number
  categoryBreakdown: QuizCategoryBreakdown
  missedQuestions: string[]
}

export interface TeachbackSpec {
  /** Optional concept the learner wants to explain. Defaults to the session's mental model. */
  topic?: string
}

export interface TeachbackArtifactData {
  prompt: string
  keyPoints: string[]
  sourceLabel: string
  /** Stored with the artifact so grading remains tied to the version that posed the prompt. */
  sourceMaterial: string
  spec: TeachbackSpec
  model?: string
}

export interface TeachbackArtifactResult {
  teachback: TeachbackArtifactData
  artifactId: string
  versionId: string
}

export interface TeachbackRubricDimension {
  score: number
  feedback: string
}

export interface TeachbackFeedback {
  rubric: {
    accuracy: TeachbackRubricDimension
    completeness: TeachbackRubricDimension
    clarity: TeachbackRubricDimension
  }
  strengths: string[]
  corrections: string[]
  followUpQuestions: string[]
  attemptId?: string
  prompt?: string
  turnNumber?: number
  attemptedAt?: number
}

export interface TeachbackAttempt {
  id: string
  artifactId: string
  versionId: string
  conversationId: string | null
  projectId: string | null
  parentAttemptId: string | null
  turnNumber: number
  prompt: string
  transcript: string
  feedback: TeachbackFeedback
  attemptedAt: number
}

export interface ToolConfig {
  enabled: boolean
  approval: 'auto' | 'always-ask' | 'disabled'
  instructions: string
}

/**
 * Thinking/reasoning support per provider.
 * true = full extended-thinking support
 * 'o-series-only' = only for o-series / reasoning models
 * false = not supported (thinking effort param is ignored or unsupported)
 */
export const PROVIDER_THINKING_SUPPORT: Record<string, boolean | 'o-series-only'> = {
  anthropic: true,
  openai: 'o-series-only',
  azure: 'o-series-only',
  openrouter: false,
  groq: false,
  mistral: false,
  gemini: false,
  xai: false,
}

export interface AgentConfig {
  id: string
  name: string
  icon: string
  systemPrompt: string
  /** @deprecated Agents no longer own a model. The model is a user/global concern. */
  model?: string
  temperature: number
  maxTokens: number
  contextDirectories: string[]
  contextFiles: string[]
  mcpServers: string[]
  agenticMode: boolean
  tools: { fileEdit: ToolConfig; terminal: ToolConfig; webFetch: ToolConfig }
  responseFormat: 'concise' | 'detailed' | 'code-only' | 'default'
  isDefault?: boolean
  rootDirectory?: string
  contextRules?: {
    ignoredGlobs: string[]
    autoInjectWorkspace: boolean
    autoInjectGit: boolean
  }
  memory?: string
  customCommands?: { name: string; description: string; prompt: string }[]
  backend?: 'claude-cli' | 'codex-cli' | 'hermes-cli'
  /** Hermes ACP profile selected for this agent. */
  hermesProfile?: string
  /** Model to use when backend is a CLI (e.g. 'claude-sonnet-4-6' or 'gpt-4.1'). */
  cliModel?: string
  /** How much reasoning effort the model should spend. undefined/'disabled' = provider default. */
  thinkingEffort?: 'low' | 'medium' | 'high' | 'max' | 'disabled'
  /** When true, all tool executions are approved automatically. No approval prompts are shown. Use only for fully trusted agents. */
  fullAutoApprove?: boolean
}

export interface SkillBuiltinToolConfig {
  enabled: boolean
  approval: 'auto' | 'always-ask' | 'disabled'
  instructions: string
}

export interface SkillMcpToolOverride {
  serverId: string
  toolName: string
  enabled: boolean
  approval: 'auto' | 'always-ask' | 'disabled'
  instructions: string
}

export interface SkillMcpServerTrust {
  serverId: string
  trust: 'auto' | 'always-ask' | 'block'
}

export interface SkillPackageFile {
  /** POSIX-style path relative to the package root. */
  relativePath: string
  encoding: 'utf8' | 'base64'
  content: string
  sizeBytes: number
}

/** Runtime capabilities declared by an optional skill-package manifest.json. */
export interface SkillRuntimeRequirements {
  browser?: {
    requiredCapabilities: string[]
    optionalCapabilities: string[]
  }
}

export interface SkillConfig {
  id: string
  name: string
  icon: string
  description: string
  instructions: string
  tools: { fileEdit: SkillBuiltinToolConfig; terminal: SkillBuiltinToolConfig; webFetch: SkillBuiltinToolConfig }
  mcpServers: string[]
  mcpServerTrust: SkillMcpServerTrust[]
  mcpToolOverrides: SkillMcpToolOverride[]
  knowledge: { title: string; content: string }[]
  tags: string[]
  /** Absolute package root. The directory and its SKILL.md are the canonical skill source. */
  packagePath?: string
  /** SHA-256 of every package file, used to invalidate trust when package contents change. */
  contentHash?: string
  scope?: 'user' | 'project' | 'bundled'
  source?: 'nexy' | 'filesystem' | 'codex' | 'claude' | 'hermes' | 'import'
  validationStatus?: 'valid' | 'warning' | 'invalid'
  /** Capability requirements declared by the package, if present. */
  runtimeRequirements?: SkillRuntimeRequirements
  /** Portable package contents used by sync/import/export. Never contains a host filesystem path. */
  packageFiles?: SkillPackageFile[]
  /** Losslessly retained standard/provider frontmatter that Nexy does not execute itself. */
  frontmatter?: Record<string, unknown>
  created_at?: number
  updated_at?: number
}

/**
 * A skill package found on disk in a standard location (`~/.claude/skills`, `~/.codex/skills`,
 * project `.claude/skills`, …) but not yet imported into Nexy's managed library. Read-only until imported.
 */
export interface DiscoveredSkill {
  /** Absolute path to the external package root. */
  packagePath: string
  name: string
  description: string
  icon: string
  scope: 'user' | 'project'
  source: 'filesystem' | 'codex' | 'claude' | 'hermes'
  /** Human-readable location label, e.g. `~/.claude/skills`. */
  rootLabel: string
  validationStatus: 'valid' | 'warning' | 'invalid'
  /** Validation details shown when an external package cannot be imported. */
  validationErrors?: string[]
  validationWarnings?: string[]
  /** False only when the package cannot be read. Readable packages are normalized on import. */
  importable?: boolean
  contentHash?: string
  /** True when a managed skill already has identical package contents. */
  alreadyImported: boolean
  /** Capability requirements declared by the package, if present. */
  runtimeRequirements?: SkillRuntimeRequirements
}

export interface CliInstallStatus {
  installed: boolean
  path: string | null
  version: string | null
}

export interface ProjectOrchestrationConfig {
  workflowMode: 'single-agent' | 'automated-delegation' | 'orchestrated'
  orchestrationEnabled: boolean
  maxDelegationDepth: number
  showTeamActivity: boolean
}

export interface ScopeRule {
  id: string
  description: string
  repositoryId?: string
  pathGlob?: string
}

export type ProjectSourceKind = 'workspace-root' | 'folder'

export interface ProjectSource {
  id: string
  projectId: string
  label: string
  kind: ProjectSourceKind
  localPath: string
  enabled: boolean
  isPrimary: boolean
  createdAt: number
  updatedAt: number
}

export interface ProjectRepository {
  id: string
  projectId: string
  sourceId: string
  label: string
  relativePath: string
  remoteUrl?: string | null
  branch?: string | null
  dirty?: boolean | null
  enabled: boolean
  available: boolean
  createdAt: number
  updatedAt: number
}

export interface Milestone {
  id: string
  title: string
  description?: string
  status: 'active' | 'upcoming' | 'completed'
  completedAt?: number
}

export interface ProjectVariable {
  key: string
  value: string
}

export interface ProjectWorkspaceMetadata {
  rootDirectory: string
  exists: boolean
  isLikelyCodingWorkspace: boolean
  codingMarkers: string[]
  isGitRepo: boolean
  repoRoot: string | null
  branch: string | null
  dirty: boolean
  scannedAt: number
}

export type ProjectEditSource = 'chat-tool' | 'remote-edit' | 'self-heal' | 'manual-apply' | 'code-changes' | 'cli-tool'
export type ProjectTouchedFileStatus = 'modified' | 'created' | 'deleted'

export interface ProjectEditSession {
  id: string
  projectId: string | null
  conversationId: string | null
  agentId: string | null
  title: string
  source: ProjectEditSource
  createdAt: number
  updatedAt: number
  fileCount: number
}

export interface ProjectTouchedFile {
  id: string
  sessionId: string
  sourceId: string | null
  sourceLabel: string | null
  repositoryId: string | null
  repositoryLabel: string | null
  repositoryAvailable: boolean | null
  relativePath: string
  displayPath: string
  status: ProjectTouchedFileStatus
  lastOperation: 'write' | 'create' | 'delete' | 'apply'
  branch: string | null
  commitHash: string | null
  legacyRepositoryUnknown: boolean
  firstTouchedAt: number
  lastTouchedAt: number
  diffAvailable: boolean
}

export interface ProjectConfig extends ProjectOrchestrationConfig {
  instructions: string
  rootDirectory: string
  /** Stable multi-location model. rootDirectory remains the primary source compatibility alias. */
  sources: ProjectSource[]
  repositories: ProjectRepository[]
  codingWorkspace: boolean
  workspaceInfo: ProjectWorkspaceMetadata | null
  variables: ProjectVariable[]
  instructionMode: 'prepend' | 'append' | 'replace' | 'standalone'
  instructionsEnabled: boolean
  inScope: ScopeRule[]
  outOfScope: ScopeRule[]
  milestones: Milestone[]
  // Opt-in, off by default: surfaces past highly-rated conversations from this project as an
  // additive "similar past strategies" context block (conversation-rating-system-roadmap.md §3.4).
  strategyRetrievalEnabled: boolean
  // Opt-in, off by default: lets the agent's run_terminal_command tool use a working directory
  // outside this project's rootDirectory, instead of being confined to it. Widens filesystem
  // access — can be overridden per-conversation via conversations.terminal_sandbox_override.
  terminalSandboxBypass: boolean
  /** Optional project-level fallback used when a chat and its agent have no override. */
  defaultThinkingEffort?: ThinkingEffort | null
  /** Secret-free capability defaults inherited by conversations in this project. */
  capabilityProfile?: ConversationCapabilityProfile
}

export type ThinkingEffort = 'low' | 'medium' | 'high' | 'max' | 'disabled'

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  instructions: '',
  rootDirectory: '',
  sources: [],
  repositories: [],
  codingWorkspace: false,
  workspaceInfo: null,
  variables: [],
  instructionMode: 'prepend',
  instructionsEnabled: true,
  workflowMode: 'single-agent',
  orchestrationEnabled: false,
  maxDelegationDepth: 5,
  showTeamActivity: true,
  inScope: [],
  outOfScope: [],
  milestones: [],
  strategyRetrievalEnabled: false,
  terminalSandboxBypass: false,
  defaultThinkingEffort: null,
  capabilityProfile: { version: 1, skillIds: [], mcp: [] },
}

export interface McpServerConfig {
  id: string
  name: string
  description?: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  imageResponses?: 'allow' | 'omit'
  sandboxProfile?: McpSandboxProfile
  enabled: boolean
}

export interface SendMessageOptions {
  attachments?: Attachment[]
  regenerate?: boolean
  agentId?: string
  model?: string
}

export interface AppSettings {
  theme: 'light' | 'dark'
  globalHotkey: string
  autoStart: boolean
  runInBackground: boolean
  autoUpdate: boolean
}

export interface ToolCall {
  id: string
  tool: string
  args: Record<string, unknown>
  status: 'pending' | 'approved' | 'denied' | 'running' | 'completed' | 'failed'
  result?: string
  error?: string
}

export interface ToolApprovalRequest {
  requestId: string
  tool: string
  args: Record<string, unknown>
  description: string
}

export type ErrorLogSource = 'main' | 'renderer' | 'unhandled'
export type ErrorLogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface ErrorLogEntry {
  id: string
  source: ErrorLogSource
  level: ErrorLogLevel
  message: string
  stack: string | null
  timestamp: number
}
export interface DiffLine {
  type: 'context' | 'added' | 'removed'
  lineNumber: { before: number | null; after: number | null }
  content: string
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface ProjectFileDiff {
  relativePath: string
  hunks: DiffHunk[]
}

// ---------------------------------------------------------------------------
// Project Generator
// ---------------------------------------------------------------------------

export interface ProjectGeneratorAgentSpec {
  role: string
  description: string
  existingAgentId?: string
  newAgent?: {
    name: string
    icon: string
    systemPrompt: string
    temperature: number
    responseFormat: 'default' | 'concise' | 'detailed' | 'code-only'
    tools?: { fileEdit: boolean; terminal: boolean; webFetch: boolean }
  }
  isLeader: boolean
}

export interface ProjectGeneratorSpec {
  version?: 1 | 2
  name: string
  color: string
  instructions: string
  rootDirectory?: string
  sources?: Array<{
    key: string
    label: string
    mode: 'attach-existing' | 'create-folder' | 'clone'
    localPath?: string
    remoteUrl?: string
    discovery: 'source-is-repository' | 'scan-children' | 'manual'
    repositories?: Array<{
      key: string
      label: string
      relativePath: string
      initializeGit?: boolean
    }>
  }>
  instructionMode?: 'prepend' | 'append' | 'replace' | 'standalone'
  variables: { key: string; value: string }[]
  inScope: { description: string; pathGlob?: string }[]
  outOfScope: { description: string; pathGlob?: string }[]
  milestones: { title: string; description?: string; status: 'active' | 'upcoming' }[]
  orchestrationEnabled: boolean
  defaultModel?: string
  agents: ProjectGeneratorAgentSpec[]
}

export interface ProjectGeneratorMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentGeneratorSpec {
  name: string
  icon: string
  systemPrompt: string
  temperature: number
  responseFormat: 'default' | 'concise' | 'detailed' | 'code-only'
  agenticMode: boolean
  tools: { fileEdit: boolean; terminal: boolean; webFetch: boolean }
  rootDirectory?: string
  contextDirectories: string[]
  memory?: string
  customCommands?: { name: string; description: string; prompt: string }[]
}

export interface WsUrlProfile {
  id: string
  label: string
  url: string
  active: boolean
}

/** Runtime identity announced by an Android companion after it connects. */
export interface ConnectedAndroidDevice {
  deviceId: string
  deviceName: string | null
  versionName: string | null
  versionCode: number | null
}

export interface AgentGeneratorMessage {
  role: 'user' | 'assistant'
  content: string
  images?: { dataUrl: string; name: string }[]
}

export interface SkillGeneratorSpec {
  name: string
  icon: string
  description: string
  instructions: string
  tools: { fileEdit: boolean; terminal: boolean; webFetch: boolean }
  toolInstructions?: Partial<Record<'fileEdit' | 'terminal' | 'webFetch', string>>
  approval?: Partial<Record<'fileEdit' | 'terminal' | 'webFetch', 'auto' | 'always-ask' | 'disabled'>>
  mcpServers?: string[]
  tags?: string[]
  knowledge?: { title: string; content: string }[]
  suggestedAgents?: string[]
}

export interface SkillGeneratorMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ScheduleGeneratorSpec {
  name: string
  prompt: string
  scheduleType: ScheduleType
  localTime: string
  weekday?: number
  monthDay?: number
  timezone: string
  agentId?: string
  projectId?: string
  /** Optional model id the fired chat should run on (same format as `ScheduledTask.model`). When
   *  omitted the task runs on the app/agent default model. */
  model?: string
  notificationPref: 'always' | 'failures_only' | 'off'
  /** Tool names the fired chat may call unattended. A scheduled run blocks any tool not listed
   *  here (see the tool-policy enforcement in tool-loop.ts), so a tool-using agent needs its tools
   *  pre-approved to do anything. */
  preApproved?: string[]
  /** Defaults to `'chat'`. `'automated_workflow'` requires `sourceRunId` — attaches an existing
   *  saved Automated Workflow run rather than authoring a new spec inline (see src/roadmap-new/). */
  targetType?: ScheduledTaskTargetType
  sourceRunId?: string
}

export interface ScheduleGeneratorMessage {
  role: 'user' | 'assistant'
  content: string
}

export type AutomatedWorkflowStepKind = 'collect' | 'model' | 'review' | 'publish'

export interface WorkflowArtifactBinding {
  /** Human-readable name used in prompts and run provenance (for example `project-notes`). */
  bindingId: string
  source:
    | { type: 'project-files'; projectSourceId: string; include: string[] }
    | { type: 'step-output'; stepId: string; outputName: string }
  required: boolean
}

export interface WorkflowDeliverableDefinition {
  name: string
  title: string
  kind: ArtifactKind
  primaryPath: string
  mediaType: string
}

export interface WorkflowPublishDestination {
  type: 'project-file'
  projectSourceId: string
  relativePath: string
  conflictPolicy: 'require-new-preview'
}

export interface WorkflowReviewSource {
  stepId: string
  outputName: string
}

export interface AutomatedWorkflowStep {
  id: string
  /** Missing means a legacy text-output model step. Legacy behavior is preserved deliberately. */
  kind?: AutomatedWorkflowStepKind
  title: string
  summary: string
  /** Alternative to `model`, not additional to it — a step is fulfilled by exactly one of the
   *  two. Agent-fulfilled: that agent's own attached skills apply. */
  agentId?: string
  agentName?: string
  /** Alternative to `agentId` — a bare-model step gets no skill augmentation at all, full stop.
   *  Skill access is strictly agent-gated; there is no "skills available to any model" case. */
  model?: string
  prompt: string
  expectedOutput: string
  dependsOnStepIds?: string[]
  /** Explicit, immutable inputs used only by managed steps. */
  inputBindings?: WorkflowArtifactBinding[]
  /** Named artifact outputs. The Markdown MVP permits one primary file per definition. */
  deliverables?: WorkflowDeliverableDefinition[]
  /** Exact upstream deliverable selected by a review step. */
  reviewSource?: WorkflowReviewSource
  /** Declared project-scoped side-effect boundary for a publish step. */
  publishDestination?: WorkflowPublishDestination
  /** Managed prompts are isolated from project instructions unless explicitly enabled. */
  includeProjectInstructions?: boolean
}

export interface AutomatedWorkflowSpec {
  title: string
  goalSummary: string
  assumptions: string[]
  steps: AutomatedWorkflowStep[]
}

export interface AutomatedWorkflowGeneratorMessage {
  role: 'user' | 'assistant'
  content: string
}

export type AutomatedWorkflowStepStatus =
  'pending' | 'running' | 'awaiting_confirmation' | 'done' | 'failed' | 'skipped' | 'cancelled'
export type AutomatedWorkflowRunStatus =
  'pending' | 'running' | 'awaiting_confirmation' | 'failed' | 'done' | 'cancelled'
export type AutomatedWorkflowConfirmationMode = 'gated' | 'auto'

/** A persisted step. `id` stays the generator's own step key (e.g. "step-1") so
 *  existing dependsOnStepIds matching logic needs no changes; `dbId` is the
 *  actual automated_workflow_run_steps primary key, used only for status mutations. */
export interface AutomatedWorkflowRunStep extends AutomatedWorkflowStep {
  dbId: string
  runId: string
  stepIndex: number
  status: AutomatedWorkflowStepStatus
  attempt: number
  output: string
  error: string | null
  conversationId: string | null
  startedAt: number | null
  completedAt: number | null
  managed?: WorkflowManagedStepState
}

export type WorkflowArtifactBindingDirection = 'input' | 'output'

export interface WorkflowArtifactBindingRecord {
  id: string
  runId: string
  stepDbId: string
  stepAttempt: number
  bindingName: string
  direction: WorkflowArtifactBindingDirection
  artifactId: string
  artifactVersionId: string
  sourceStepDbId: string | null
  staleAt: number | null
  createdAt: number
}

export type WorkflowReviewDecision = 'approved' | 'rejected'
export type WorkflowClientKind = 'desktop' | 'android'

export interface WorkflowReviewRecord {
  id: string
  runId: string
  stepDbId: string
  artifactVersionId: string
  decision: WorkflowReviewDecision
  reviewedByClient: WorkflowClientKind
  reviewedAt: number
  supersededAt: number | null
}

export interface WorkflowArtifactVersionSummary {
  id: string
  artifactId: string
  versionNumber: number
  title: string
  primaryPath: string
  mediaType: string
  sizeBytes: number
  checksum: string | null
  createdAt: number
}

export interface WorkflowManagedStepState {
  isManaged: boolean
  isStale: boolean
  currentVersion: WorkflowArtifactVersionSummary | null
  bindings: WorkflowArtifactBindingRecord[]
  latestReview: WorkflowReviewRecord | null
  publishPreview: WorkflowPublishPreview | null
  publishAction: WorkflowPublishAction | null
}

export interface WorkflowArtifactVersionContent {
  version: WorkflowArtifactVersionSummary
  content: string
  manifestJson: string
  versions: WorkflowArtifactVersionSummary[]
}

export interface WorkflowPublishPreview {
  id: string
  runId: string
  stepDbId: string
  artifactVersionId: string
  projectSourceId: string
  relativePath: string
  destinationChecksum: string | null
  diffText: string
  createdAt: number
  expiresAt: number | null
  invalidatedAt: number | null
}

export type WorkflowPublishActionStatus =
  'pending' | 'publishing' | 'published' | 'failed' | 'conflicted'

export interface WorkflowPublishAction {
  id: string
  previewId: string
  idempotencyKey: string
  status: WorkflowPublishActionStatus
  approvedByClient: WorkflowClientKind
  approvedAt: number
  startedAt: number | null
  completedAt: number | null
  resultChecksum: string | null
  error: string | null
}

export interface WorkflowSourceOption {
  projectSourceId: string
  projectId: string
  label: string
  relativePath: string
  sizeBytes: number
}

export interface WorkflowEditVersionInput {
  runId: string
  stepDbId: string
  expectedVersionId: string
  content: string
  client: WorkflowClientKind
}

export interface WorkflowReviewInput {
  runId: string
  stepDbId: string
  artifactVersionId: string
  decision: WorkflowReviewDecision
  client: WorkflowClientKind
}

export interface WorkflowPublishPreviewInput {
  runId: string
  stepDbId: string
  artifactVersionId: string
}

export interface WorkflowPublishConfirmInput {
  runId: string
  stepDbId: string
  previewId: string
  idempotencyKey: string
  client: WorkflowClientKind
}

export interface AutomatedWorkflowRunSummary {
  id: string
  /** Nullable — an Automated Workflow run is now project-optional, so it can be a truly
   *  self-contained entity (like Skills/Scheduled tasks) rather than mandatorily project-scoped. */
  projectId: string | null
  title: string
  goalSummary: string
  model: string | null
  status: AutomatedWorkflowRunStatus
  confirmationMode: AutomatedWorkflowConfirmationMode
  currentStepId: string | null
  // Named lastError, not error — a top-level `error: string` property on an IPC return value
  // collides with isApiError()'s duck-typing check (shared/types.ts's isApiError treats any
  // object with a string `error` field as a failed call and gets silently discarded by callers).
  lastError: string | null
  stepCounts: {
    total: number
    pending: number
    running: number
    awaitingConfirmation: number
    done: number
    failed: number
    skipped: number
  }
  createdAt: number
  updatedAt: number
  /** Back-link to the reusable spec this run was created from — null for runs created before
   *  templates existed. Lets a terminal run offer "Run again" without re-describing the goal. */
  templateId: string | null
}

export interface AutomatedWorkflowRunDetail extends AutomatedWorkflowRunSummary {
  assumptions: string[]
  steps: AutomatedWorkflowRunStep[]
}

/** A reusable workflow spec, decoupled from run (execution) history — created automatically
 *  alongside a run's first generation, so a terminal run can spawn a fresh run from the same
 *  steps via "Run again" without going back through the AI generator. */
export interface AutomatedWorkflowTemplateSummary {
  id: string
  projectId: string | null
  title: string
  goalSummary: string
  model: string | null
  stepCount: number
  createdAt: number
  updatedAt: number
}

export interface AutomatedWorkflowTemplateDetail extends AutomatedWorkflowTemplateSummary {
  assumptions: string[]
  steps: AutomatedWorkflowStep[]
}

export type ArtifactKind =
  | 'document' | 'code' | 'ui' | 'data'
  | 'prompt' | 'agent-config' | 'plan' | 'bundle' | 'other'
  | 'debrief' | 'quiz' | 'teachback'

export type ArtifactStatus = 'draft' | 'generating' | 'ready' | 'exported' | 'archived' | 'failed'

export type ArtifactExportFormat = 'markdown' | 'html' | 'json' | 'zip' | 'raw-files'

export interface ArtifactSpec {
  title: string
  kind: ArtifactKind
  scope: { type: 'global' | 'project'; projectId?: string }
  intendedUse: string
  audience?: string
  outputFiles: {
    path: string
    mediaType: string
    role: 'primary' | 'supporting' | 'preview' | 'source'
    description?: string
  }[]
  sourceContext: {
    useProjectInstructions: boolean
    useProjectWiki: boolean
    useConversationContext: boolean
    referencedFiles: string[]
  }
  acceptanceCriteria: string[]
  exportFormats: ArtifactExportFormat[]
}

export interface ArtifactFile {
  id: string
  versionId: string
  relativePath: string
  absolutePath: string
  mediaType: string
  role: string
  sizeBytes: number | null
  checksum: string | null
}

export interface ArtifactVersion {
  id: string
  artifactId: string
  versionNumber: number
  title: string
  notes: string | null
  specJson: string | null
  manifestJson: string
  sourceConversationId: string | null
  sourceMessageId: string | null
  createdByAgentIds: string | null
  createdAt: number
  files?: ArtifactFile[]
}

export interface ArtifactRow {
  id: string
  projectId: string | null
  conversationId: string | null
  title: string
  kind: ArtifactKind
  description: string | null
  storageRoot: string
  currentVersionId: string | null
  status: ArtifactStatus
  errorMessage: string | null
  createdAt: number
  updatedAt: number
  currentVersion?: ArtifactVersion
}

export interface ArtifactGeneratorMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ArtifactGeneratorRun {
  id: string
  artifactId: string | null
  title: string
  status: string
  specJson: string | null
  createdAt: number
  updatedAt: number
}

export interface ArtifactPromotionRequest {
  conversationId: string
  messageId: string
  title: string
  kind: Extract<ArtifactKind, 'document' | 'prompt' | 'plan' | 'code' | 'other'>
  scope: { type: 'global' | 'project'; projectId?: string }
  filePath: string
}

export interface ArtifactPromotionResult {
  artifactId: string
  versionId: string
  title: string
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type AuthMode = 'byok' | 'none'

export interface AuthStatus {
  authenticated: boolean
  mode: AuthMode
  user: null
  cliInstalled?: boolean
  clis?: {
    claude: boolean
    codex: boolean
    hermes?: boolean
  }
}

// ---------------------------------------------------------------------------
// Database row shapes (snake_case — returned directly from SQLite handlers)
// ---------------------------------------------------------------------------

export interface ConversationRow {
  id: string
  agent_id: string | null
  project_id: string | null
  title: string
  model: string | null
  conversation_hermes_profile?: string | null
  pinned: number
  created_at: number
  updated_at: number
  completed_at: number | null
  thinking_effort_override: 'low' | 'medium' | 'high' | 'max' | 'disabled' | null
  full_auto_approve_override: number | null
  agentic_mode_override: number | null
  terminal_sandbox_override: number | null
  cli_mode_override: CliModeOverride | null
  codex_execution_mode_override: CodexExecutionModeOverride | null
  rating: number | null
  kind: 'chat' | 'project-conversation-mode'
  capability_profile_json?: string | null
}

// ---------------------------------------------------------------------------
// CLI backend modes
// ---------------------------------------------------------------------------

export type CliBackend = 'claude-cli' | 'codex-cli' | 'hermes-cli'

/**
 * Per-conversation permission/sandbox mode override. One column holds either family — the
 * picker/commands only offer the values valid for the chat's active backend:
 * - Provider chats: 'plan' enables Nexy's read-only planning tool loop
 * - Claude Code `--permission-mode`: 'plan' | 'acceptEdits' | 'bypassPermissions'
 * - Codex `--sandbox`: 'read-only' | 'workspace-write' | 'danger-full-access'
 * null/absent = the backend's default behavior.
 */
export type CliModeOverride =
  | 'plan' | 'acceptEdits' | 'bypassPermissions'
  | 'read-only' | 'workspace-write' | 'danger-full-access'

export const CLAUDE_CLI_MODES: CliModeOverride[] = ['plan', 'acceptEdits', 'bypassPermissions']
export const CODEX_CLI_MODES: CliModeOverride[] = ['read-only', 'workspace-write', 'danger-full-access']

/** Codex collaboration/execution mode, independent of approval and sandbox controls. */
export type CodexExecutionModeOverride = 'plan'
export const CODEX_EXECUTION_MODES: CodexExecutionModeOverride[] = ['plan']

export interface MessageRow {
  id: string
  conversation_id: string
  role: string
  content: string
  model: string | null
  is_edited: number
  previous_content: string | null
  timestamp: number
  timeline_order: number
  tool_calls: string | null
  attachments: string | null
  context_snapshot: string | null
  thinking_blocks: string | null
  text_segments: string | null
  user_inputs: string | null
  citations: string | null
}

export interface ConversationExportAttachment {
  id?: string
  name?: string
  path?: string
  size?: number
  type?: string
  [key: string]: unknown
}

export interface ConversationExportContextRef {
  key?: string
  token?: string
  value?: string
  label?: string
  [key: string]: unknown
}

export interface ConversationExportToolCall {
  id?: string
  name?: string
  server?: string
  args?: unknown
  result?: unknown
  success?: boolean
  summary: string
  [key: string]: unknown
}

export interface ConversationExportProject {
  id: string
  name: string
  color: string
  default_model: string | null
  project_hermes_profile: string | null
  created_at: number
  updated_at: number
}

export interface ConversationExportAgent {
  id: string
  name: string | null
  icon: string | null
  backend: string | null
  cli_model: string | null
  is_default: boolean
  created_at: number
  updated_at: number
}

export interface ConversationExportMessage {
  id: string
  role: string
  content: string
  model: string | null
  timestamp: number
  is_edited: boolean
  previous_content: string | null
  attachments: ConversationExportAttachment[]
  context_refs: ConversationExportContextRef[]
  context_snapshot: unknown
  tool_call: ConversationExportToolCall | null
  citations?: import('./citations').Citation[]
}

export interface ConversationExportV1 {
  schema: 'nexy.conversation.v1'
  exported_at: number
  conversation: ConversationRow
  project: ConversationExportProject | null
  agent: ConversationExportAgent | null
  messages: ConversationExportMessage[]
}

export type ConversationExportPackFormat = 'json' | 'markdown' | 'context-bundle'

export interface ConversationExportPackOptions {
  format: ConversationExportPackFormat
}

export interface ConversationExportPack {
  format: ConversationExportPackFormat
  conversation_id: string
  file_name: string
  mime_type: string
  content: string
}

export interface ConversationImportOptions {
  targetConversationId?: string | null
}

export interface ConversationImportResult {
  conversation: ConversationRow
  message_count: number
  imported_into_existing: boolean
}

export interface ConversationForkOptions {
  model?: string | null
  conversationHermesProfile?: string | null
  agentId?: string | null
  projectId?: string | null
  cutoffTimestamp?: number | null
}

export interface ConversationForkResult {
  conversation: ConversationRow
  message_count: number
  rewritten_message_count: number
  compressed_message_count: number
  omitted_message_count: number
}

export interface RendererErrorInput {
  message: string
  stack?: string | null
  level?: Extract<ErrorLogLevel, 'error' | 'warn'>
}

export interface NewContentConversation {
  conversationId: string
  title: string
  projectId: string | null
  projectName: string | null
  agentId: string | null
  agentName: string | null
  preview: string | null
  newContentAt: number
}

export type ConversationPageScope =
  | { type: 'all' }
  | { type: 'pinned' }
  | { type: 'project'; id: string | null }
  | { type: 'agent'; id: string }

export interface ConversationPageRequest {
  requestId?: string
  scope?: ConversationPageScope
  query?: string
  limit?: number
  cursor?: string | null
}

export interface ConversationPage {
  requestId: string
  items: ConversationRow[]
  totalCount: number
  nextCursor: string | null
  hasMore: boolean
}

export interface StructuredConversationSummary {
  goals: string[]
  decisions: string[]
  constraints: string[]
  filesTouched: string[]
  commandsRun: string[]
  openQuestions: string[]
  nextActions: string[]
  recentContextNotes: string[]
}

export interface ConversationCompressionPreview {
  conversation_id: string
  has_summary: boolean
  summarized_message_count: number
  retained_message_count: number
  omitted_message_count: number
  estimated_tokens_before: number
  estimated_tokens_after: number
  target_budget: number
  strategy: string | null
  updated_at: number | null
  sections: StructuredConversationSummary | null
}

export interface ConversationCompressionDraft {
  conversation_id: string
  summarized_message_count: number
  retained_message_count: number
  omitted_message_count: number
  estimated_tokens_before: number
  estimated_tokens_after: number
  target_budget: number
  strategy: string
  sections: StructuredConversationSummary
}

export interface ConversationCompressionSaveInput {
  conversationId: string
  summarizedMessageCount: number
  retainedMessageCount: number
  estimatedTokensBefore: number
  targetBudget: number
  strategy: string
  sections: StructuredConversationSummary
}

export interface ContextInspectorRefSnapshot {
  token: string
  key: string
  estimatedTokens: number
}

export interface ContextInspectorAttachmentSnapshot {
  name: string
  size: number
  estimatedTokens: number
}

/** Live composer/draft breakdown for the focused desktop window, relayed to the Android companion. */
export interface ContextInspectorSnapshot {
  conversationId: string | null
  model: string
  systemPrompt: string
  systemPromptTokens: number
  contextRefs: ContextInspectorRefSnapshot[]
  attachments: ContextInspectorAttachmentSnapshot[]
  imageCount: number
  historyMessageCount: number
  currentInputTokens: number
  totalTokens: number
  maxTokens: number
  nextRequest?: { inputTokens: number; quality: string; source: string; model?: string | null }
  turnTotal?: { inputTokens: number; outputTokens: number; requestCount: number; quality: string; source: string; complete: boolean }
}

export interface KnowledgeFile {
  id: string
  agent_id: string
  file_path: string
  inject_mode: string
  sort_order: number
  created_at: number
  updated_at: number
}

export interface WikiEntry {
  id: string
  project_id: string
  title: string
  body: string
  tags: string[]
  source_conversation_id: string | null
  source_message_id: string | null
  superseded_by: string | null
  created_at: number
  updated_at: number
}

export interface WikiCandidate {
  title: string
  body: string
  tags: string[]
  matchingEntryId: string | null
  matchingEntryTitle: string | null
  supersededEntryId: string | null
  supersededEntryTitle: string | null
}

export interface WikiExtractionResult {
  candidates: WikiCandidate[]
}

export interface ProjectWikiMcpConnection {
  projectId: string
  url: string
  token: string
  command: string
  args: string[]
  env: Record<string, string>
}

export interface ProjectWikiMcpStatus {
  projectId: string
  running: boolean
  url: string | null
  stdio: { command: string; args: string[]; env: Record<string, string> } | null
}

// ---------------------------------------------------------------------------
// Build orchestrator
// ---------------------------------------------------------------------------

export type BuildCommandName = 'typecheck' | 'test' | 'build' | 'package'
export type BuildStatus = 'running' | 'success' | 'failed' | 'cancelled'

export interface WorkspaceInfo {
  path: string
  branch: string | null
  commitSha: string | null
  dirty: boolean
  version: string | null
  isGitRepo: boolean
  /** Whether a package.json exists at the path — false usually means the path points at the wrong folder. */
  hasPackageJson: boolean
}

export interface BuildRecord {
  id: string
  workspacePath: string
  commitSha: string | null
  branch: string | null
  version: string | null
  versionCode: number | null
  platform: string
  command: BuildCommandName | AndroidBuildCommandName
  status: BuildStatus
  exitCode: number | null
  artifactPaths: string[]
  artifactChecksums: Record<string, string>
  logTail: string
  startedAt: number
  finishedAt: number | null
  mobileInitiated: boolean
}

export interface PreflightCheck {
  label: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
}

export interface PreflightResult {
  checks: PreflightCheck[]
}

export interface LocalUpdateFeed {
  feedPath: string
  feedUrl: string
  port: number
  running: boolean
}

export interface PublishedEntry {
  version: string
  publishedAt: number
  installerName: string
  installerSize: number
  platform: string
  isBackup: boolean
}

// ---------------------------------------------------------------------------
// Android build and distribution
// ---------------------------------------------------------------------------

export type AndroidBuildCommandName =
  | 'test'
  | 'assembleDebug'
  | 'assembleRelease'
  | 'bundleRelease'

export interface AndroidWorkspaceInfo {
  path: string
  branch: string | null
  commitSha: string | null
  dirty: boolean
  versionCode: number | null
  versionName: string | null
  isGitRepo: boolean
  /** Whether a Gradle wrapper exists at the path — false usually means this isn't the android/ folder. */
  hasGradleProject: boolean
}

export interface AndroidSigningConfig {
  keystorePath: string
  keystorePassword: string
  keyAlias: string
  keyPassword: string
  generated?: boolean
}

export interface AndroidFirebaseClientStatus {
  configured: boolean
  projectId?: string
  packageName?: string
}

export interface AdbDevice {
  serial: string
  state: 'device' | 'offline' | 'unauthorized' | 'unknown'
  model: string | null
  product: string | null
}

export interface AndroidUpdateManifest {
    versionCode: number
    versionName: string
    commitSha: string | null
    buildId?: string | null
    sourceDirty?: boolean
    builtAt?: number | null
    changelog: string
  checksum: string
  artifactUrl: string
  artifactUrls?: string[]
  publishedAt: number
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export type ScheduleType = 'one-time' | 'daily' | 'weekdays' | 'weekly' | 'monthly'
export type ScheduledRunStatus = 'pending' | 'running' | 'approval_required' | 'success' | 'failed' | 'skipped'
export type ScheduledRunTrigger = 'scheduled' | 'manual'
export type SchedulerNotificationPref = 'always' | 'failures_only' | 'off'

export interface ScheduledTaskToolPolicy {
  preApproved: string[]
  alwaysAsk: string[]
  neverAllow: string[]
}

export type ScheduledTaskTargetType = 'chat' | 'automated_workflow'

/** One Automated Workflow spec attached to a schedule. `workflowSpecJson` freezes a copy of the
 *  spec at attach time (a `JSON.stringify`d `AutomatedWorkflowSpec`) so the schedule's behavior
 *  doesn't silently change or break if `sourceRunId`'s original run is later edited or discarded —
 *  `sourceRunId` is kept only as an optional back-link for UI convenience. `confirmationMode`
 *  defaults to `'auto'` here (unlike everywhere else in the app, which defaults to `'gated'`) since
 *  an unattended, timer-fired workflow has no human present to approve a gated pause. */
export interface ScheduledTaskWorkflowSpec {
  workflowSpecJson: string
  sourceRunId: string | null
  confirmationMode: AutomatedWorkflowConfirmationMode
}

export interface ScheduledTask {
  id: string
  name: string
  prompt: string
  enabled: boolean
  agentId: string | null
  projectId: string | null
  model: string | null
  conversationId: string | null
  scheduleType: ScheduleType
  localTime: string
  weekday: number | null
  monthDay: number | null
  timezone: string
  toolPolicy: ScheduledTaskToolPolicy
  notificationPref: SchedulerNotificationPref
  nextRunAt: number | null
  lastRunAt: number | null
  /** Defaults to `'chat'` — every existing scheduled task keeps firing a plain chat message
   *  unchanged. `'automated_workflow'` fires the attached `workflowSpecs` instead (one or many,
   *  run sequentially). */
  targetType: ScheduledTaskTargetType
  workflowSpecs: ScheduledTaskWorkflowSpec[]
  createdAt: number
  updatedAt: number
}

export interface ScheduledRun {
  id: string
  taskId: string
  scheduledAt: number | null
  startedAt: number | null
  finishedAt: number | null
  status: ScheduledRunStatus
  error: string | null
  conversationId: string | null
  messageId: string | null
  triggerSource: ScheduledRunTrigger
  /** Ids of every `automated_workflow_runs` row spawned by this run, in execution order. `null`
   *  for a `targetType: 'chat'` run (or any run that hasn't spawned a workflow). */
  workflowRunIds: string[] | null
  createdAt: number
}

export interface ScheduledTaskCreateInput {
  name: string
  prompt: string
  enabled?: boolean
  agentId?: string | null
  projectId?: string | null
  model?: string | null
  scheduleType: ScheduleType
  localTime: string
  weekday?: number | null
  monthDay?: number | null
  timezone: string
  toolPolicy?: Partial<ScheduledTaskToolPolicy>
  notificationPref?: SchedulerNotificationPref
  targetType?: ScheduledTaskTargetType
  workflowSpecs?: ScheduledTaskWorkflowSpec[]
}

export interface ScheduledTaskUpdateInput {
  name?: string
  prompt?: string
  agentId?: string | null
  projectId?: string | null
  model?: string | null
  scheduleType?: ScheduleType
  localTime?: string
  weekday?: number | null
  monthDay?: number | null
  timezone?: string
  toolPolicy?: Partial<ScheduledTaskToolPolicy>
  notificationPref?: SchedulerNotificationPref
  targetType?: ScheduledTaskTargetType
  workflowSpecs?: ScheduledTaskWorkflowSpec[]
}

// ---------------------------------------------------------------------------
// Prompt library
// ---------------------------------------------------------------------------

export type PromptScope = 'global' | 'project'

export interface PromptLibraryEntry {
  id: string
  title: string
  body: string
  description: string
  category: string
  tags: string[]
  variables: string[]
  scope: PromptScope
  project_id: string | null
  created_at: number
  updated_at: number
}

export interface PromptLibraryInput {
  title: string
  body: string
  description?: string
  category?: string
  tags?: string[]
  scope?: PromptScope
  project_id?: string | null
}

export interface PromptLibraryUpdate {
  title?: string
  body?: string
  description?: string
  category?: string
  tags?: string[]
  scope?: PromptScope
  project_id?: string | null
}

export interface PromptVersionDiff {
  titleChanged: boolean
  descriptionChanged: boolean
  categoryChanged: boolean
  tagsChanged: boolean
  scopeChanged: boolean
  addedLines: string[]
  removedLines: string[]
}

export interface PromptLibraryVersion {
  id: string
  prompt_id: string
  version: number
  title: string
  body: string
  description: string
  category: string
  tags: string[]
  variables: string[]
  scope: PromptScope
  project_id: string | null
  source: string
  created_at: number
  diff: PromptVersionDiff
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectRow {
  id: string
  name: string
  color: string
  default_model: string | null
  project_hermes_profile: string | null
  config: ProjectConfig
  created_at: number
  updated_at: number
}

export interface ProjectAgent {
  agentId: string
  agentName: string
  agentIcon: string
  isPrimary: boolean
  sortOrder: number
}

// ---------------------------------------------------------------------------
// Agent operations
// ---------------------------------------------------------------------------

export interface AffectedProject {
  id: string
  name: string
  is_primary: number
}

export interface DeleteAgentPreflight {
  affectedProjects: AffectedProject[]
  affectedConvCount: number
}

export interface DeleteAgentResult {
  success: boolean
  reason?: string
  affectedProjects?: AffectedProject[]
  affectedConvCount?: number
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export type McpSandboxNetworkPolicy = 'blocked' | 'allowed'
export type McpSandboxChildProcessPolicy = 'blocked' | 'allowed'
export type McpSandboxFilesystemAccess = 'read-only' | 'read-write'

export interface McpSandboxFilesystemGrant {
  path: string
  access: McpSandboxFilesystemAccess
}

export interface McpSandboxProfile {
  version: 1
  network: McpSandboxNetworkPolicy
  childProcesses: McpSandboxChildProcessPolicy
  filesystem: McpSandboxFilesystemGrant[]
  memoryLimitMiB: 512
  maxProcesses: 1 | 8
  startupTimeoutMs: 15000
  gracefulShutdownTimeoutMs: 2000
  hardTerminationTimeoutMs: 5000
  maxDiagnosticBytes: 65536
}

export type McpSandboxStatus = 'sandboxed' | 'starting' | 'unavailable' | 'failed' | 'stopped'

export interface McpSandboxRuntimeStatus {
  status: McpSandboxStatus
  backend?: string
  helperVersion?: string
  helperPid?: number
  serverPid?: number
  diagnostics?: string
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  serverId: string
  serverName: string
}

export interface McpServerWithStatus extends McpServerConfig {
  status: 'connecting' | 'connected' | 'error' | 'disconnected'
  error?: string
  toolCount: number
  resourceCount: number
  promptCount: number
  /** True for Nexy-owned in-process bridges such as Desktop Navigator. */
  managed?: boolean
  capabilities?: Record<string, unknown>
  serverVersion?: { name: string; version: string }
  instructions?: string
  sandbox?: McpSandboxRuntimeStatus
}

export interface McpServerStatus {
  status: 'connecting' | 'connected' | 'error' | 'disconnected'
  error?: string
  tools: McpTool[]
  resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>
  prompts: Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>
  capabilities?: Record<string, unknown>
  serverVersion?: { name: string; version: string }
  instructions?: string
  sandbox?: McpSandboxRuntimeStatus
  /** True for Nexy-owned in-process bridges such as Desktop Navigator. */
  managed?: boolean
}

export interface McpToolOverrideRow {
  agent_id: string
  server_id: string
  tool_name: string
  enabled: number
  approval: string
  instructions: string
}

export interface McpCallResult {
  success: boolean
  result?: string
  error?: string
}

export interface McpTestResult {
  ok: boolean
  tools?: { name: string; description?: string }[]
  error?: string
  sandbox?: McpSandboxRuntimeStatus
}

export interface McpRegistryEnvRequirement {
  key: string
  label: string
  helpUrl?: string
  secret?: boolean
}

export interface McpRegistryInstallConfig {
  command: string
  args: string[]
  requiredEnv: McpRegistryEnvRequirement[]
}

export interface McpRegistryServer {
  name: string
  title?: string
  description: string
  version: string
  docsUrl?: string
  repositoryUrl?: string
  status: 'active' | 'deprecated' | 'deleted'
  statusMessage?: string
  publishedAt?: string
  updatedAt?: string
  isLatest: boolean
  transport: 'stdio' | 'remote' | 'unknown'
  install?: McpRegistryInstallConfig
}

export interface McpRegistrySearchResult {
  servers: McpRegistryServer[]
  fetchedAt: number
  stale: boolean
}

// ---------------------------------------------------------------------------
// Files / directories
// ---------------------------------------------------------------------------

export interface DirectoryEntry {
  name: string
  relativePath: string
  type: 'file' | 'dir'
}

export interface ContextFileResult {
  path: string
  content: string
  truncated: boolean
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export interface ProviderInfo {
  name: string
  label: string
  apiKeySettingKey: string
  models: string[]
  configured: boolean
}

export interface ProviderTestResult {
  valid: boolean
  error?: string
}

export type CredentialKind = 'api-key' | 'token' | 'password' | 'secret-file' | 'env-bundle'

/** Metadata returned to the renderer. Secret payloads are intentionally absent. */
export interface CredentialMetadata {
  id: string
  name: string
  kind: CredentialKind
  provider: string | null
  fingerprint: string | null
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
  revokedAt: number | null
}

export interface CredentialCreateInput {
  name: string
  kind: CredentialKind
  provider?: string | null
  value: string
}

export interface CredentialUpdateInput {
  name?: string
  provider?: string | null
  value?: string
  revoked?: boolean
}

export type CredentialApprovalMode = 'auto' | 'always-ask'

/** Secret-free permission metadata for a vault record. */
export interface CredentialBindingMetadata {
  id: string
  credentialId: string
  projectId: string | null
  agentId: string | null
  capability: string
  approvalMode: CredentialApprovalMode
  expiresAt: number | null
  createdAt: number
  updatedAt: number
}

export interface CredentialBindingCreateInput {
  credentialId: string
  projectId?: string | null
  agentId?: string | null
  capability: string
  approvalMode?: CredentialApprovalMode
  expiresAt?: number | null
}

export interface CredentialBindingUpdateInput {
  projectId?: string | null
  agentId?: string | null
  capability?: string
  approvalMode?: CredentialApprovalMode
  expiresAt?: number | null
}

export interface AvailableModelEntry {
  id: string
  label: string
  /** Present only for Claude Code's full-ID candidates; a local CLI request verifies them on first use. */
  source?: 'cli-menu-confirmed' | 'legacy-candidate' | 'validated'
}
export interface AvailableModelGroup {
  sourceKey: string
  sourceLabel: string
  sourceType: 'cli' | 'provider'
  models: AvailableModelEntry[]
}

export interface CatalogModel {
  id: string
  name: string
  vendor: string
  capabilities: string[]
  contextWindow?: number
  /** Premium request multiplier returned by the /models API (e.g. 0, 0.33, 1, 3). */
  multiplier?: number
}

// ---------------------------------------------------------------------------
// IPC return-type map — every invoke channel mapped to its concrete return type
// ---------------------------------------------------------------------------

export type IpcReturnMap = {
  // Agent
  'agent:add-knowledge-file': KnowledgeFile | null
  'agent:create': AgentConfig
  'agent:delete': DeleteAgentResult
  'agent:delete-preflight': DeleteAgentPreflight
  'agent:duplicate': AgentConfig | null
  'agent:export': boolean
  'agent:get': AgentConfig | null
  'agent:get-mcp-tool-overrides': McpToolOverrideRow[]
  'agent:get-mcp-server-trust': { server_id: string; trust: string }[]
  'agent:assign-mcp-server': { assigned: boolean; trust: string }
  'agent:import': AgentConfig | null
  'agent:list': AgentConfig[]
  'agent:list-knowledge-files': KnowledgeFile[]
  'agent:remove-knowledge-file': boolean
  'agent:set-mcp-tool-override': boolean
  'agent:set-mcp-server-trust': boolean
  'agent:update': AgentConfig
  'agent:update-knowledge-inject-mode': boolean
  // Skill
  'skill:attach-to-agent': boolean
  'skill:create': SkillConfig
  'skill:delete': boolean
  'skill:duplicate': SkillConfig | null
  'skill:export': boolean
  'skill:export-md': boolean
  'skill:get': SkillConfig | null
  'skill:get-agent-links': { skill_id: string; sort_order: number }[]
  'skill:get-agent-usage': { skill_id: string; agent_count: number }[]
  'skill:discover': DiscoveredSkill[]
  'skill:import': SkillConfig | null
  'skill:import-discovered': SkillConfig | null
  'skill:library-updated': void
  'skill:list': SkillConfig[]
  'skill:reorder-for-agent': boolean
  'skill:update': SkillConfig
  // App
  'app:check-updates': { updateAvailable: boolean; currentVersion?: string; latestVersion?: string }
  'app:download-update': void
  'app:get-setting': string | null
  'app:get-settings': Record<string, string>
  'app:get-theme': string
  'app:get-runtime-info': { isPackaged: boolean }
  'app:get-version': string
  'app:install-update': void
  'app:save-text-file': string | null
  'app:set-auto-start': boolean
  'app:set-setting': boolean
  'app:set-theme': boolean
  // Auth
  'auth:login-byok': { success: boolean }
  'auth:logout': void
  'auth:status': AuthStatus
  // Chat
  'chat:new': void
  'chat:get-active-turn': import('./chat-turn-types').ActiveChatTurnSnapshot | null
  'chat:get-pending-user-inputs': import('./chat-turn-types').UserInputRequest[]
  'chat:respond-user-input': boolean
  'chat:send-message': void
  'chat:stop-generation': void
  'chat:get-emergency-stop': { active: boolean; activatedAt: number | null }
  'chat:activate-emergency-stop': { active: boolean; activatedAt: number | null }
  'chat:resume-conversations': { active: boolean; activatedAt: number | null }
  'chat:emergency-stop-changed': void
  'chat:stream-error': void
  'chat:stream-response': void
  'chat:cli-tool-start': void
  'chat:cli-tool-end': void
  'chat:cli-cost': void
  'chat:tool-call-event': void
  'chat:team-activity': void
  'chat:team-step-stream': void
  'chat:activity': void
  'chat:activity-global': void
  'chat:turn-event': void
  'android:log': void
  'chat:stream-model': void
  'chat:thinking-delta': void
  'chat:thinking-end': void
  'chat:wiki-injected': { count: number }
  'chat:remote-message': void
  // CLI
  'cli:check': CliInstallStatus
  'cli:status': CliInstallStatus
  'cli:detect-all': Record<string, CliInstallStatus>
  'cli:get-models': { id: string; label: string }[]
  'hermes:list-profiles': HermesProfileInfo[]
  'hermes:profile-discovery': HermesProfileDiscovery
  'hermes:validate-home': import('./hermes').HermesHomeValidation
  'hermes:acp-readiness': HermesAcpReadiness
  // Context
  'context:git': string
  'context:git-diff': string
  'context:read-file': ContextFileResult
  'context:workspace-summary': string
  'context:request-inspector-snapshot': void
  'context:inspector-snapshot-reply': void
  // Conversation
  'conversation:create': ConversationRow
  'conversation:compression-preview': ConversationCompressionPreview
  'conversation:prepare-compression-summary': ConversationCompressionDraft
  'conversation:save-compression-summary': ConversationCompressionPreview
  'conversation:delete': boolean
  'conversation:export-json': ConversationExportV1
  'conversation:export-pack': ConversationExportPack
  'conversation:fork': ConversationForkResult
  'conversation:import-json': ConversationImportResult | null
  'conversation:get-messages': MessageRow[]
  'conversation:insert-message': MessageRow
  'conversation:list': ConversationRow[]
  'conversation:list-page': ConversationPage
  'conversation:rename': boolean
  'conversation:search': ConversationRow[]
  'conversation:set-model': boolean
  'conversation:set-mode': boolean
  'conversation:set-pinned': boolean
  'conversation:get-capabilities': ConversationCapabilityProfile
  'conversation:set-capabilities': ConversationCapabilityProfile
  'capabilities:resolve': CapabilityPreflight
  'capabilities:activate': ConversationCapabilityProfile
  'conversation:update-context': boolean
  'conversation:generate-debrief': DebriefArtifactResult
  'conversation:start-debrief-generation': { artifactId: string }
  'conversation:get-debrief': DebriefArtifactResult | null
  'conversation:generate-debrief-story': DebriefStoryResult
  'conversation:mark-complete': boolean
  'conversation:mark-incomplete': boolean
  'conversation:generate-quiz': QuizArtifactResult
  'conversation:start-quiz-generation': { artifactId: string }
  'conversation:get-quiz': QuizArtifactResult | null
  'quiz:record-attempt': QuizAttempt
  'quiz:get-attempts': QuizAttempt[]
  'conversation:generate-teachback': TeachbackArtifactResult
  'conversation:start-teachback-generation': { artifactId: string }
  'conversation:grade-teachback': TeachbackFeedback
  'teachback:get-attempts': TeachbackAttempt[]
  // Ratings
  'rating:submit': ConversationRating
  'rating:get': ConversationRating | null
  'rating:delete': boolean
  'rating:list': ConversationRatingListItem[]
  'rating:get-stats': ConversationRatingStats
  // Activity
  'activity:list': BackgroundActivity[]
  'activity:changed': void
  'activity:dismiss': boolean
  'activity-badge:set-viewed-conversation': number
  'activity-badge:get-count': number
  'activity-badge:get-unseen-conversations': string[]
  'activity-badge:get-new-content': NewContentConversation[]
  'activity-badge:mark-all-read': number
  'activity-badge:changed': void
  // Debug
  'debug:set-enabled': boolean
  'debug:log': void
  // Errors
  'errors:clear': boolean
  'errors:get-log-path': string | null
  'errors:get-recent': ErrorLogEntry[]
  'errors:get-renderer-console': ErrorLogEntry[]
  'errors:record-renderer': ErrorLogEntry
  'errors:new': void
  // Pushed when a conversation's messages changed outside the renderer that has it open.
  'chat:messages-updated': void
  // Project Git workbench (independent of the retired Code Changes workflow)
  'project-git:list-repos': Array<{ relativePath: string; branch: string; dirty: boolean }>
  'project-git:list-repo-files': string[]
  'project-git:list-changed-files': Array<{ relativePath: string; staged: boolean }>
  'project-git:resolve-repo':
    | { ok: true; repoRoot: string; relativePath: string }
    | { ok: false; reason: 'no-repo' | 'ambiguous'; candidates?: string[] }
  'project-git:list-branches': { current: string; local: string[]; remote: string[] }
  'project-git:checkout-branch': { ok: boolean; error?: string }
  'project-git:new-branch': { ok: boolean; error?: string }
  'project-git:fetch': { ok: boolean; error?: string }
  'project-git:merge-branch': {
    ok: boolean
    conflicted: boolean
    conflictedFiles?: Array<{ relativePath: string; content: string }>
    error?: string
    summary?: string
  }
  'project-git:init-repo': { ok: boolean; error?: string }
  'project-git:detect-credentials': {
    remoteUrl: string | null
    host: string | null
    protocol: 'ssh' | 'https' | null
    methods: Array<{
      type: 'gh-cli' | 'glab-cli' | 'tea-cli' | 'ssh-key' | 'credential-helper'
      label: string
      detail: string
      available: boolean
    }>
  }
  'project-git:pull': {
    ok: boolean
    conflicted: boolean
    conflictedFiles?: Array<{ relativePath: string; content: string }>
    error?: string
    summary?: string
  }
  'project-git:push': { ok: boolean; error?: string }
  'project-git:commit': { ok: boolean; error?: string }
  'project-git:discard-file': { ok: boolean; error?: string }
  'project-git:stage-files': { ok: boolean; error?: string }
  'project-git:unstage-files': { ok: boolean; error?: string }
  'project-git:stash': { ok: boolean; error?: string }
  'project-git:stash-pop': { ok: boolean; error?: string }
  'project-git:stash-count': number
  'project-git:delete-branch': { ok: boolean; error?: string }
  'project-git:file-diff': { diff: string; binary: boolean }
  // Deeplink (push-only)
  'deeplink:open-agent': void
  'deeplink:open-chat': void
  // File
  'file:add-recent-dir': string[]
  'file:get-cwd': string
  'file:get-recent-dirs': string[]
  'file:open-dialog': Attachment[]
  'file:open-directory-dialog': string[]
  'file:set-cwd': boolean
  // FS
  'fs:list-directory': DirectoryEntry[]
  'fs:read-file': string
  'fs:write-file': boolean
  // MCP
  'mcp:add-server': McpServerConfig
  'mcp:call-tool': McpCallResult
  'mcp:get-server-status': McpServerStatus
  'mcp:list-servers': McpServerWithStatus[]
  'mcp:list-tools': McpTool[]
  'mcp:list-tools-for-agent': McpTool[]
  'mcp:remove-server': boolean
  'mcp:restart-server': boolean
  'mcp:server-status-changed': void
  'mcp:test-server': McpTestResult
  'mcp:search-registry': McpRegistrySearchResult
  'mcp:update-server': McpServerConfig | null
  // Model
  'model:list-catalog': CatalogModel[]
  'model:catalog-updated': { models: CatalogModel[]; changeSummary?: string }
  'model:list-available': AvailableModelGroup[]
  'model:cli-models-updated': void
  // Message
  'message:delete': void
  'message:delete-after': void
  // Project
  'project:add-agent': boolean
  'project:create': ProjectRow
  'project:delete': boolean
  'project:duplicate': ProjectRow | null
  'project:export': boolean
  'project:get-config': ProjectConfig
  'project:get-capabilities': ConversationCapabilityProfile
  'project:set-capabilities': ConversationCapabilityProfile
  'project:inspect-workspace': ProjectWorkspaceMetadata | null
  'project:list-sources': { sources: ProjectSource[]; repositories: ProjectRepository[] }
  'project:add-source': { sources: ProjectSource[]; repositories: ProjectRepository[] }
  'project:remove-source': { sources: ProjectSource[]; repositories: ProjectRepository[] }
  'project:remove-repository': { sources: ProjectSource[]; repositories: ProjectRepository[] }
  'project:rescan-sources': { sources: ProjectSource[]; repositories: ProjectRepository[] }
  'project:list': ProjectRow[]
  'project:list-agents': ProjectAgent[]
  'project:remove-agent': boolean
  'project:rename': boolean
  'project:reorder-agents': boolean
  'project:set-conversation': boolean
  'project:set-default-model': boolean
  'project:set-primary-agent': boolean
  'project:update-config': boolean
  'automated-workflow-generator:chat': { started: boolean }
  'automated-workflow-generator:token': void
  'automated-workflow-generator:spec-ready': void
  'automated-workflow-generator:done': { hasSpec: boolean }
  'automated-workflow-generator:error': { message: string }
  'automated-workflow-generator:get-model': string
  'automated-workflow-generator:set-model': void
  'automated-workflow-runs:save-spec': AutomatedWorkflowRunDetail
  'automated-workflow-runs:list': AutomatedWorkflowRunSummary[]
  'automated-workflow-runs:list-all': AutomatedWorkflowRunSummary[]
  'automated-workflow-runs:get': AutomatedWorkflowRunDetail | null
  'automated-workflow-runs:update-step-status': AutomatedWorkflowRunDetail | null
  'automated-workflow-runs:discard': boolean
  'automated-workflow-runs:changed': void
  'automated-workflow-runs:start': AutomatedWorkflowRunDetail | null
  'automated-workflow-runs:confirm-step': AutomatedWorkflowRunDetail | null
  'automated-workflow-runs:retry-step': AutomatedWorkflowRunDetail | null
  'automated-workflow-runs:skip-step': AutomatedWorkflowRunDetail | null
  'automated-workflow-runs:abort': AutomatedWorkflowRunDetail | null
  'automated-workflow-runs:set-confirmation-mode': AutomatedWorkflowRunDetail | null
  'automated-workflow-runs:run-again': AutomatedWorkflowRunDetail | null
  'automated-workflow-runs:step-stream': void
  'automated-workflow-managed:list-sources': WorkflowSourceOption[]
  'automated-workflow-managed:get-version': WorkflowArtifactVersionContent | null
  'automated-workflow-managed:get-bindings': WorkflowArtifactBindingRecord[]
  'automated-workflow-managed:edit-version': AutomatedWorkflowRunDetail
  'automated-workflow-managed:review': AutomatedWorkflowRunDetail
  'automated-workflow-managed:regenerate': AutomatedWorkflowRunDetail | null
  'automated-workflow-managed:create-preview': WorkflowPublishPreview
  'automated-workflow-managed:confirm-publish': WorkflowPublishAction
  'automated-workflow-templates:list': AutomatedWorkflowTemplateSummary[]
  'automated-workflow-templates:get': AutomatedWorkflowTemplateDetail | null
  'automated-workflow-templates:delete': boolean
  // Scheduler
  'scheduler:list': ScheduledTask[]
  'scheduler:get': ScheduledTask | null
  'scheduler:create': { task: ScheduledTask; warnings: string[] }
  'scheduler:update': { task: ScheduledTask; warnings: string[] }
  'scheduler:delete': boolean
  'scheduler:set-enabled': ScheduledTask
  'scheduler:run-now': ScheduledRun
  'scheduler:resume-run': ScheduledRun
  'scheduler:list-runs': ScheduledRun[]
  'scheduler:list-workflow-templates': AutomatedWorkflowRunSummary[]
  'scheduler:task-updated': void
  'scheduler:task-deleted': void
  'scheduler:run-updated': void
  // Prompt library
  'prompt:create': PromptLibraryEntry
  'prompt:delete': boolean
  'prompt:list-versions': PromptLibraryVersion[]
  'prompt:list': PromptLibraryEntry[]
  'prompt:rollback': PromptLibraryEntry
  'prompt:update': PromptLibraryEntry
  // Build orchestrator
  'build:get-workspace-info': WorkspaceInfo
  'build:set-workspace-path': WorkspaceInfo
  'build:start-command': { buildId: string }
  'build:cancel-command': boolean
  'build:get-records': BuildRecord[]
  'build:run-preflight': PreflightResult
  'build:launch-dev': { launched: boolean; error?: string }
  'build:log-chunk': void
  'build:command-done': void
  'build:get-feed-info': LocalUpdateFeed | null
  'build:set-feed-path': LocalUpdateFeed
  'build:publish-update': { published: boolean; version?: string; error?: string }
  'build:list-published': PublishedEntry[]
  'build:rollback-update': { launched: boolean; error?: string }
  // Android build and distribution
  'android:get-workspace-info': AndroidWorkspaceInfo
  'android:set-workspace-path': AndroidWorkspaceInfo
  'android:start-command': { buildId: string }
  'android:cancel-command': boolean
  'android:get-records': BuildRecord[]
  'android:get-signing-config': AndroidSigningConfig | null
  'android:set-signing-config': boolean
  'android:validate-signing-config': { valid: boolean; checks: PreflightCheck[] }
  'android:list-adb-devices': AdbDevice[]
  'android:install-apk': { success: boolean; error?: string }
  'android:publish-update': { published: boolean; manifest?: AndroidUpdateManifest; error?: string; warning?: string }
  'android:get-update-manifest': AndroidUpdateManifest | null
  'android:get-publish-history': AndroidUpdateManifest[]
  'android:restore-version': { restored: boolean; manifest?: AndroidUpdateManifest; error?: string }
  'android:save-fcm-service-account': { saved: boolean; error?: string }
  'android:get-fcm-config-status': { configured: boolean; projectId?: string; clientEmail?: string }
  'android:verify-fcm-config': { configured: boolean; authenticated: boolean; projectId?: string; clientEmail?: string; error?: string }
  'android:get-firebase-client-status': AndroidFirebaseClientStatus
  'android:import-firebase-client': { saved: boolean; canceled: boolean; status?: AndroidFirebaseClientStatus; error?: string }
  'android:log-chunk': void
  'android:command-done': void
  // WebSocket mobile companion
  'ws:start': { port: number; token: string; qrDataUrl: string | null; pairingUrl?: string | null; secure?: boolean }
  'ws:stop': boolean
  'ws:status': { enabled: boolean; port: number | null; token: string | null; localIp: string; connectedClients: number; devices: ConnectedAndroidDevice[]; qrDataUrl: string | null; pairingUrl?: string | null; externalUrl?: string | null; secure?: boolean }
  'ws:regenerate-token': { token: string; qrDataUrl: string | null; pairingUrl?: string | null; secure?: boolean }
  'ws:wakelock-enabled': boolean
  'ws:set-wakelock-enabled': boolean
  'ws:auto-start-enabled': boolean
  'ws:set-auto-start-enabled': boolean
  'ws:client-count': number
  // Wiki
  'wiki:create-entry': WikiEntry
  'wiki:delete-entry': boolean
  'wiki:extract-learnings': WikiExtractionResult
  'wiki:list-entries': WikiEntry[]
  'wiki:update-entry': WikiEntry
  'wiki:mcp-start': ProjectWikiMcpConnection
  'wiki:mcp-stop': boolean
  'wiki:mcp-status': ProjectWikiMcpStatus
  // Provider
  'credential:list': CredentialMetadata[]
  'credential:create': CredentialMetadata
  'credential:update': CredentialMetadata
  'credential:delete': boolean
  'credential-binding:list': CredentialBindingMetadata[]
  'credential-binding:create': CredentialBindingMetadata
  'credential-binding:update': CredentialBindingMetadata
  'credential-binding:delete': boolean
  'provider:get-azure-endpoint': string
  'provider:has-key': boolean
  'provider:list': ProviderInfo[]
  'provider:remove-key': boolean
  'provider:set-azure-endpoint': boolean
  'provider:set-key': boolean
  'provider:test-key': ProviderTestResult
  'provider:key-handoff-confirm': boolean
  'provider:key-handoff-request': void
  'provider:key-handoff-sent': void
  // Screen / Clipboard
  'clipboard:auto-focus': void
  'clipboard:read-content': { type: 'image'; dataUrl: string } | { type: 'text'; text: string } | null
  'clipboard:read-image': { dataUrl: string } | null
  'overlay:get-screenshot': string
  'screen:capture': { dataUrl: string; windowLabel?: string } | { error: string }
  'screen:capture-window': { dataUrl: string } | { error: string }
  'screen:check-permission': 'granted' | 'denied' | 'prompt'
  'screen:ocr-image': { text: string } | { error: string }
  'voice:get-status': { executablePath: string; modelPath: string; ready: boolean }
  'voice:install-local': { installed: boolean; executablePath: string; modelPath: string } | { error: string }
  'voice:transcribe': { text: string } | { error: string }
  // Tool
  'tool:approval-response': boolean
  'tool:auto-approved': void
  'tool:request-approval': void
  'tool:approval-resolved': void
  // Project generator
  'project-generator:chat': { started: boolean }
  'project-generator:token': void
  'project-generator:spec-ready': void
  'project-generator:done': void
  'project-generator:error': { message: string }
  'project-generator:get-model': string
  'project-generator:set-model': void
  // Agent generator
  'agent-generator:chat': { started: boolean }
  'agent-generator:token': void
  'agent-generator:spec-ready': void
  'agent-generator:done': void
  'agent-generator:error': { message: string }
  'agent-generator:get-model': string
  'agent-generator:set-model': void
  // Skill generator
  'skill-generator:chat': { started: boolean }
  'skill-generator:token': void
  'skill-generator:spec-ready': void
  'skill-generator:done': void
  'skill-generator:error': { message: string }
  'skill-generator:get-model': string
  'skill-generator:set-model': void
  // Scheduler generator
  'scheduler-generator:chat': { started: boolean }
  'scheduler-generator:token': void
  'scheduler-generator:spec-ready': void
  'scheduler-generator:done': void
  'scheduler-generator:error': { message: string }
  'scheduler-generator:get-model': string
  'scheduler-generator:set-model': void
  // Artifact
  'artifact:list': ArtifactRow[]
  'artifact:get': ArtifactRow | null
  'artifact:list-versions': ArtifactVersion[]
  'artifact:get-version': ArtifactVersion | null
  'artifact:delete': { deleted: boolean }
  'artifact:delete-version': { deleted: boolean }
  'artifact:move-to-project': { ok: boolean }
  'artifact:promote-message': ArtifactPromotionResult
  'artifact:export': { exportPath: string }
  'artifact:download': { canceled: boolean; downloadPath?: string }
  'artifact:open-folder': { ok: boolean }
  'artifact:get-file-content': { content: string }
  'app:open-path': { ok: boolean; error?: string }
  'artifact-generator:chat': { started: boolean }
  'artifact-generator:generate': { started: boolean }
  'artifact-generator:get-runs': ArtifactGeneratorRun[]
  'artifact-generator:get-storage-root': { path: string }
  'artifact-generator:set-storage-root': { ok: boolean }
  'artifact-generator:token': void
  'artifact-generator:spec-ready': void
  'artifact-generator:file-event': void
  'artifact-generator:done': { hasSpec: boolean }
  // Updater (push-only)
  'updater:download-progress': void
  'updater:error': void
  'updater:no-update': void
  'updater:update-available': void
  'updater:update-downloaded': void
  // Window
  'window:close': void
  'window:edit-action': void
  'window:is-maximized': boolean
  'window:maximize': void
  'window:maximize-change': void
  'window:minimize': void
  'window:zoom': void
}

/** Resolves the concrete return type for a given IPC channel. */
export type ApiError = { error: string }
export function isApiError(result: unknown): result is ApiError {
  return typeof result === 'object' && result !== null && 'error' in result && typeof (result as Record<string, unknown>).error === 'string'
}
export type IpcReturn<C extends IpcChannels> = C extends keyof IpcReturnMap ? IpcReturnMap[C] : never

export type IpcChannels =
  | 'agent:add-knowledge-file'
  | 'agent:create'
  | 'agent:delete'
  | 'agent:delete-preflight'
  | 'agent:duplicate'
  | 'agent:export'
  | 'agent:get'
  | 'agent:get-mcp-tool-overrides'
  | 'agent:get-mcp-server-trust'
  | 'agent:assign-mcp-server'
  | 'agent:import'
  | 'agent:list'
  | 'agent:list-knowledge-files'
  | 'agent:remove-knowledge-file'
  | 'agent:set-mcp-tool-override'
  | 'agent:set-mcp-server-trust'
  | 'agent:update'
  | 'agent:update-knowledge-inject-mode'
  | 'skill:attach-to-agent'
  | 'skill:create'
  | 'skill:delete'
  | 'skill:duplicate'
  | 'skill:export'
  | 'skill:export-md'
  | 'skill:get'
  | 'skill:get-agent-links'
  | 'skill:get-agent-usage'
  | 'skill:discover'
  | 'skill:import'
  | 'skill:import-discovered'
  | 'skill:library-updated'
  | 'skill:list'
  | 'skill:reorder-for-agent'
  | 'skill:update'
  | 'app:check-updates'
  | 'app:download-update'
  | 'app:get-setting'
  | 'app:get-settings'
  | 'app:get-theme'
  | 'app:get-runtime-info'
  | 'app:get-version'
  | 'app:install-update'
  | 'app:save-text-file'
  | 'app:set-auto-start'
  | 'app:set-setting'
  | 'app:set-theme'
  | 'auth:login-byok'
  | 'auth:logout'
  | 'auth:status'
  | 'chat:new'
  | 'chat:send-message'
  | 'chat:stop-generation'
  | 'chat:get-emergency-stop'
  | 'chat:activate-emergency-stop'
  | 'chat:resume-conversations'
  | 'chat:emergency-stop-changed'
  | 'chat:stream-error'
  | 'chat:stream-response'
  | 'chat:cli-tool-start'
  | 'chat:cli-tool-end'
  | 'chat:cli-cost'
  | 'chat:tool-call-event'
  | 'chat:team-activity'
  | 'chat:team-step-stream'
  | 'chat:activity'
  | 'chat:activity-global'
  | 'chat:turn-event'
  | 'android:log'
  | 'chat:stream-model'
  | 'chat:thinking-delta'
  | 'chat:thinking-end'
  | 'chat:wiki-injected'
  | 'chat:remote-message'
  | 'chat:get-active-turn'
  | 'chat:get-pending-user-inputs'
  | 'chat:respond-user-input'
  | 'clipboard:auto-focus'
  | 'clipboard:read-content'
  | 'clipboard:read-image'
  | 'cli:check'
  | 'cli:status'
  | 'cli:detect-all'
  | 'cli:get-models'
  | 'hermes:list-profiles'
  | 'hermes:profile-discovery'
  | 'hermes:validate-home'
  | 'hermes:acp-readiness'
  | 'context:git'
  | 'context:git-diff'
  | 'context:read-file'
  | 'context:workspace-summary'
  | 'context:request-inspector-snapshot'
  | 'context:inspector-snapshot-reply'
  | 'conversation:create'
  | 'conversation:compression-preview'
  | 'conversation:prepare-compression-summary'
  | 'conversation:save-compression-summary'
  | 'conversation:delete'
  | 'conversation:export-json'
  | 'conversation:export-pack'
  | 'conversation:fork'
  | 'conversation:import-json'
  | 'conversation:get-messages'
  | 'conversation:insert-message'
  | 'conversation:list'
  | 'conversation:list-page'
  | 'conversation:rename'
  | 'conversation:search'
  | 'conversation:set-model'
  | 'conversation:set-mode'
  | 'conversation:set-pinned'
  | 'conversation:get-capabilities'
  | 'conversation:set-capabilities'
  | 'capabilities:resolve'
  | 'capabilities:activate'
  | 'conversation:update-context'
  | 'conversation:generate-debrief'
  | 'conversation:start-debrief-generation'
  | 'conversation:get-debrief'
  | 'conversation:generate-debrief-story'
  | 'conversation:mark-complete'
  | 'conversation:mark-incomplete'
  | 'conversation:completed'
  | 'conversation:incompleted'
  | 'conversation:generate-quiz'
  | 'conversation:start-quiz-generation'
  | 'conversation:get-quiz'
  | 'quiz:record-attempt'
  | 'quiz:get-attempts'
  | 'conversation:generate-teachback'
  | 'conversation:start-teachback-generation'
  | 'conversation:grade-teachback'
  | 'teachback:get-attempts'
  | 'rating:submit'
  | 'rating:get'
  | 'rating:delete'
  | 'rating:list'
  | 'rating:get-stats'
  | 'rating:updated'
  | 'activity:list'
  | 'activity:changed'
  | 'activity:dismiss'
  | 'activity-badge:set-viewed-conversation'
  | 'activity-badge:get-count'
  | 'activity-badge:get-unseen-conversations'
  | 'activity-badge:get-new-content'
  | 'activity-badge:mark-all-read'
  | 'activity-badge:changed'
  | 'artifact:updated'
  | 'debug:set-enabled'
  | 'debug:log'
  | 'errors:clear'
  | 'errors:get-log-path'
  | 'errors:get-recent'
  | 'errors:get-renderer-console'
  | 'errors:record-renderer'
  | 'errors:new'
  | 'chat:messages-updated'
  | 'project-git:list-repos'
  | 'project-git:list-repo-files'
  | 'project-git:list-changed-files'
  | 'project-git:resolve-repo'
  | 'project-git:list-branches'
  | 'project-git:checkout-branch'
  | 'project-git:new-branch'
  | 'project-git:fetch'
  | 'project-git:merge-branch'
  | 'project-git:init-repo'
  | 'project-git:detect-credentials'
  | 'project-git:pull'
  | 'project-git:push'
  | 'project-git:commit'
  | 'project-git:discard-file'
  | 'project-git:stage-files'
  | 'project-git:unstage-files'
  | 'project-git:stash'
  | 'project-git:stash-pop'
  | 'project-git:stash-count'
  | 'project-git:delete-branch'
  | 'project-git:file-diff'
  | 'deeplink:open-agent'
  | 'deeplink:open-chat'
  | 'file:add-recent-dir'
  | 'file:get-cwd'
  | 'file:get-recent-dirs'
  | 'file:open-dialog'
  | 'file:open-directory-dialog'
  | 'file:set-cwd'
  | 'fs:list-directory'
  | 'fs:read-file'
  | 'fs:write-file'
  | 'mcp:add-server'
  | 'mcp:call-tool'
  | 'mcp:get-server-status'
  | 'mcp:list-servers'
  | 'mcp:list-tools'
  | 'mcp:list-tools-for-agent'
  | 'mcp:remove-server'
  | 'mcp:restart-server'
  | 'mcp:server-status-changed'
  | 'mcp:test-server'
  | 'mcp:search-registry'
  | 'mcp:update-server'
  | 'model:list-catalog'
  | 'model:catalog-updated'
  | 'model:list-available'
  | 'model:cli-models-updated'
  | 'message:delete'
  | 'message:delete-after'
  | 'project:add-agent'
  | 'project:create'
  | 'project:delete'
  | 'project:duplicate'
  | 'project:export'
  | 'project:get-config'
  | 'project:get-capabilities'
  | 'project:set-capabilities'
  | 'project:inspect-workspace'
  | 'project:list-sources'
  | 'project:add-source'
  | 'project:remove-source'
  | 'project:remove-repository'
  | 'project:rescan-sources'
  | 'project:list'
  | 'project:list-agents'
  | 'project:remove-agent'
  | 'project:rename'
  | 'project:reorder-agents'
  | 'project:set-conversation'
  | 'project:set-default-model'
  | 'project:set-primary-agent'
  | 'project:update-config'
  | 'automated-workflow-generator:chat'
  | 'automated-workflow-generator:token'
  | 'automated-workflow-generator:spec-ready'
  | 'automated-workflow-generator:done'
  | 'automated-workflow-generator:error'
  | 'automated-workflow-generator:get-model'
  | 'automated-workflow-generator:set-model'
  | 'automated-workflow-runs:save-spec'
  | 'automated-workflow-runs:list'
  | 'automated-workflow-runs:list-all'
  | 'automated-workflow-runs:get'
  | 'automated-workflow-runs:update-step-status'
  | 'automated-workflow-runs:discard'
  | 'automated-workflow-runs:changed'
  | 'automated-workflow-runs:start'
  | 'automated-workflow-runs:confirm-step'
  | 'automated-workflow-runs:retry-step'
  | 'automated-workflow-runs:skip-step'
  | 'automated-workflow-runs:abort'
  | 'automated-workflow-runs:set-confirmation-mode'
  | 'automated-workflow-runs:run-again'
  | 'automated-workflow-runs:step-stream'
  | 'automated-workflow-managed:list-sources'
  | 'automated-workflow-managed:get-version'
  | 'automated-workflow-managed:get-bindings'
  | 'automated-workflow-managed:edit-version'
  | 'automated-workflow-managed:review'
  | 'automated-workflow-managed:regenerate'
  | 'automated-workflow-managed:create-preview'
  | 'automated-workflow-managed:confirm-publish'
  | 'automated-workflow-templates:list'
  | 'automated-workflow-templates:get'
  | 'automated-workflow-templates:delete'
  | 'scheduler:list'
  | 'scheduler:get'
  | 'scheduler:create'
  | 'scheduler:update'
  | 'scheduler:delete'
  | 'scheduler:set-enabled'
  | 'scheduler:run-now'
  | 'scheduler:resume-run'
  | 'scheduler:list-runs'
  | 'scheduler:list-workflow-templates'
  | 'scheduler:task-updated'
  | 'scheduler:task-deleted'
  | 'scheduler:run-updated'
  | 'prompt:create'
  | 'prompt:delete'
  | 'prompt:list-versions'
  | 'prompt:list'
  | 'prompt:rollback'
  | 'prompt:update'
  | 'credential:list'
  | 'credential:create'
  | 'credential:update'
  | 'credential:delete'
  | 'credential-binding:list'
  | 'credential-binding:create'
  | 'credential-binding:update'
  | 'credential-binding:delete'
  | 'provider:get-azure-endpoint'
  | 'provider:has-key'
  | 'provider:list'
  | 'provider:remove-key'
  | 'provider:set-azure-endpoint'
  | 'provider:set-key'
  | 'provider:test-key'
  | 'provider:key-handoff-confirm'
  | 'provider:key-handoff-request'
  | 'provider:key-handoff-sent'
  | 'overlay:get-screenshot'
  | 'screen:capture'
  | 'screen:capture-window'
  | 'screen:check-permission'
  | 'screen:ocr-image'
  | 'voice:get-status'
  | 'voice:install-local'
  | 'voice:transcribe'
  | 'tool:approval-response'
  | 'tool:auto-approved'
  | 'tool:request-approval'
  | 'tool:approval-resolved'
  | 'updater:download-progress'
  | 'updater:error'
  | 'updater:no-update'
  | 'updater:update-available'
  | 'updater:update-downloaded'
  | 'window:close'
  | 'window:edit-action'
  | 'window:is-maximized'
  | 'window:maximize'
  | 'window:maximize-change'
  | 'window:minimize'
  | 'window:zoom'
  | 'wiki:create-entry'
  | 'wiki:delete-entry'
  | 'wiki:extract-learnings'
  | 'wiki:list-entries'
  | 'wiki:update-entry'
  | 'wiki:mcp-start'
  | 'wiki:mcp-stop'
  | 'wiki:mcp-status'
  | 'build:get-workspace-info'
  | 'build:set-workspace-path'
  | 'build:start-command'
  | 'build:cancel-command'
  | 'build:get-records'
  | 'build:run-preflight'
  | 'build:launch-dev'
  | 'build:log-chunk'
  | 'build:command-done'
  | 'build:get-feed-info'
  | 'build:set-feed-path'
  | 'build:publish-update'
  | 'build:list-published'
  | 'build:rollback-update'
  | 'android:get-workspace-info'
  | 'android:set-workspace-path'
  | 'android:start-command'
  | 'android:cancel-command'
  | 'android:get-records'
  | 'android:get-signing-config'
  | 'android:set-signing-config'
  | 'android:validate-signing-config'
  | 'android:list-adb-devices'
  | 'android:install-apk'
  | 'android:publish-update'
  | 'android:get-update-manifest'
  | 'android:get-publish-history'
  | 'android:restore-version'
  | 'android:save-fcm-service-account'
  | 'android:get-fcm-config-status'
  | 'android:verify-fcm-config'
  | 'android:get-firebase-client-status'
  | 'android:import-firebase-client'
  | 'android:log-chunk'
  | 'android:command-done'
  | 'ws:start'
  | 'ws:stop'
  | 'ws:status'
  | 'ws:regenerate-token'
  | 'ws:wakelock-enabled'
  | 'ws:set-wakelock-enabled'
  | 'ws:auto-start-enabled'
  | 'ws:set-auto-start-enabled'
  | 'ws:client-count'
  | 'project-generator:chat'
  | 'project-generator:token'
  | 'project-generator:spec-ready'
  | 'project-generator:done'
  | 'project-generator:error'
  | 'project-generator:get-model'
  | 'project-generator:set-model'
  | 'agent-generator:chat'
  | 'agent-generator:token'
  | 'agent-generator:spec-ready'
  | 'agent-generator:done'
  | 'agent-generator:error'
  | 'agent-generator:get-model'
  | 'agent-generator:set-model'
  | 'skill-generator:chat'
  | 'skill-generator:token'
  | 'skill-generator:spec-ready'
  | 'skill-generator:done'
  | 'skill-generator:error'
  | 'skill-generator:get-model'
  | 'skill-generator:set-model'
  | 'scheduler-generator:chat'
  | 'scheduler-generator:token'
  | 'scheduler-generator:spec-ready'
  | 'scheduler-generator:done'
  | 'scheduler-generator:error'
  | 'scheduler-generator:get-model'
  | 'scheduler-generator:set-model'
  | 'artifact:list'
  | 'artifact:get'
  | 'artifact:list-versions'
  | 'artifact:get-version'
  | 'artifact:delete'
  | 'artifact:delete-version'
  | 'artifact:export'
  | 'artifact:download'
  | 'artifact:open-folder'
  | 'artifact:promote-message'
  | 'artifact:get-file-content'
  | 'app:open-path'
  | 'artifact-generator:chat'
  | 'artifact-generator:generate'
  | 'artifact-generator:get-runs'
  | 'artifact-generator:get-storage-root'
  | 'artifact-generator:set-storage-root'
  | 'artifact:move-to-project'
  | 'artifact-generator:token'
  | 'artifact-generator:spec-ready'
  | 'artifact-generator:file-event'
  | 'artifact-generator:done'
