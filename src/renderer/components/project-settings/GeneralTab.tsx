import { useEffect, useState } from 'react'
import { FolderOpen, Plus, X, ChevronDown } from 'lucide-react'
import { DropdownPanel } from '../DropdownPanel'
import type { ProjectConfig } from '../../store/types'
import type { ThinkingEffort } from '../../../shared/types'
import type { AvailableModelGroup, CatalogModel, HermesProfileInfo } from '../../../shared/types'
import { ModelPicker } from '../chat/ModelPicker'
import { PROJECT_COLOR_OPTIONS, PROJECT_COLOR_HEX_REGEX } from '../../../shared/project-colors'

const INSTRUCTION_MODES: { value: ProjectConfig['instructionMode']; label: string }[] = [
  { value: 'prepend',    label: 'Prepend to agent prompt' },
  { value: 'append',    label: 'Append to agent prompt' },
  { value: 'replace',   label: 'Replace agent prompt' },
  { value: 'standalone', label: 'Standalone (ignore agent prompt)' },
]

function resolveVarHighlights(text: string, vars: Array<{ key: string; value: string }>) {
  const definedKeys = new Set(vars.map((v) => v.key))
  const parts: { text: string; type: 'text' | 'defined' | 'undefined' }[] = []
  const pattern = /\{\{([^}]+)\}\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), type: 'text' })
    parts.push({ text: m[0], type: definedKeys.has(m[1]) ? 'defined' : 'undefined' })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), type: 'text' })
  return parts
}

interface Props {
  isDraft: boolean
  name: string
  color: string
  rootDirectory: string
  sources: ProjectConfig['sources']
  repositories: ProjectConfig['repositories']
  codingWorkspace: boolean
  strategyRetrievalEnabled: boolean
  terminalSandboxBypass: boolean
  workspaceInfo: ProjectConfig['workspaceInfo']
  instructions: string
  instructionMode: ProjectConfig['instructionMode']
  instructionsEnabled: boolean
  variables: Array<{ key: string; value: string }>
  varErrors: Record<number, string>
  showModeDropdown: boolean
  hasVarErrors: boolean
  defaultModel: string | null
  projectHermesProfile: string
  hermesProfiles: HermesProfileInfo[]
  availableModelGroups: AvailableModelGroup[]
  catalogModels: CatalogModel[]
  globalDefaultModel: string | null
  onSetName: (v: string) => void
  onSetColor: (v: string) => void
  onNameBlur: () => void
  onConfirm?: () => void
  onInstructionsChange: (v: string) => void
  onRootDirChange: (v: string) => void
  onModeChange: (mode: ProjectConfig['instructionMode']) => void
  onEnabledToggle: () => void
  onBrowseDir: () => void
  onAddSource: () => void
  onRemoveSource: (sourceId: string) => void
  onRemoveRepository: (repositoryId: string) => void
  onRescanSources: () => void
  onCodingWorkspaceToggle: () => void
  onStrategyRetrievalToggle: () => void
  onTerminalSandboxBypassToggle: () => void
  onSetShowModeDropdown: (v: boolean) => void
  onAddVariable: () => void
  onRemoveVariable: (idx: number) => void
  onVarChange: (idx: number, field: 'key' | 'value', val: string) => void
  onDefaultModelChange: (model: string | null) => void
  onProjectHermesProfileChange: (profile: string) => void
  defaultThinkingEffort?: ThinkingEffort | null
  onDefaultThinkingEffortChange: (value: ThinkingEffort | null) => void
}

export function GeneralTab({
  isDraft, name, color, rootDirectory, sources, repositories, codingWorkspace, strategyRetrievalEnabled, terminalSandboxBypass, workspaceInfo,
  instructions, instructionMode, instructionsEnabled,
  variables, varErrors, showModeDropdown, hasVarErrors,
  defaultModel, projectHermesProfile, hermesProfiles, availableModelGroups, catalogModels, globalDefaultModel,
  onSetName, onSetColor, onNameBlur, onConfirm,
  onInstructionsChange, onRootDirChange, onModeChange, onEnabledToggle, onBrowseDir, onAddSource, onRemoveSource, onRemoveRepository, onRescanSources, onCodingWorkspaceToggle,
  onStrategyRetrievalToggle, onTerminalSandboxBypassToggle, onSetShowModeDropdown, onAddVariable, onRemoveVariable, onVarChange,
  onDefaultModelChange, onProjectHermesProfileChange, defaultThinkingEffort = null, onDefaultThinkingEffortChange,
}: Props) {
  const selectedModeLabel = INSTRUCTION_MODES.find((m) => m.value === instructionMode)?.label ?? instructionMode
  const highlightParts = resolveVarHighlights(instructions, variables)
  const [customHex, setCustomHex] = useState(color.startsWith('#') ? color : '')
  useEffect(() => { setCustomHex(color.startsWith('#') ? color : '') }, [color])

  return (
    <>
      {/* Name */}
      <div>
        <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Name</label>
        <input
          autoFocus={isDraft}
          value={name}
          onChange={(e) => onSetName(e.target.value)}
          onBlur={onNameBlur}
          onKeyDown={isDraft ? (e) => { if (e.key === 'Enter' && !hasVarErrors) onConfirm?.() } : undefined}
          placeholder={isDraft ? 'Project name…' : undefined}
          className="mt-1 w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
          aria-label="Project name"
        />
      </div>

      {/* Color */}
      <div>
        <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Color</label>
        <div className="mt-1.5 flex gap-2 flex-wrap">
          {PROJECT_COLOR_OPTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => { setCustomHex(''); onSetColor(c.value) }}
              style={{ backgroundColor: c.hex }}
              className={`w-5 h-5 rounded-full border border-black/10 ${color === c.value ? 'ring-2 ring-offset-2 ring-nexy-accent' : ''}`}
              aria-label={`Color ${c.value}`}
              aria-pressed={color === c.value}
              title={c.value}
            />
          ))}
          <label className={`flex h-6 items-center gap-1 rounded-md border px-1.5 ${color.startsWith('#') ? 'border-nexy-accent' : 'border-gray-200 dark:border-gray-600'}`} title="Custom hex color">
            <input
              type="color"
              value={PROJECT_COLOR_HEX_REGEX.test(color) ? color : '#3478D4'}
              onChange={(e) => onSetColor(e.target.value.toUpperCase())}
              className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0"
              aria-label="Choose custom color"
            />
            <input
              value={customHex}
              onChange={(e) => {
                const value = e.target.value.toUpperCase()
                if (/^#?[0-9A-F]{0,6}$/.test(value)) {
                  const normalized = value && !value.startsWith('#') ? `#${value}` : value
                  setCustomHex(normalized)
                  if (PROJECT_COLOR_HEX_REGEX.test(normalized)) onSetColor(normalized)
                }
              }}
              placeholder="#HEX"
              maxLength={7}
              className="w-14 bg-transparent text-[10px] font-mono text-gray-600 outline-none dark:text-gray-300"
              aria-label="Custom hex color"
            />
          </label>
        </div>
      </div>

      {!isDraft && (
        <div>
          <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            Default model
          </label>
          <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
            Pre-selected for new chats in this project. Falls back to the Nexy default if it becomes unavailable.
          </p>
          <div className="mt-1">
            <ModelPicker
              value={defaultModel ?? 'default'}
              availableGroups={availableModelGroups}
              catalogModels={catalogModels}
              globalDefaultModel={globalDefaultModel ?? undefined}
              buttonClassName="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-800 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
              menuClassName="left-0"
              onSelectDefault={() => onDefaultModelChange(null)}
              onSelectAvailableModel={(_group, model) => onDefaultModelChange(model.id)}
            />
          </div>
          {availableModelGroups.some((group) => group.sourceKey === 'hermes-cli' && group.models.some((model) => model.id === defaultModel)) && (
            <select
              aria-label="Project Hermes profile"
              value={projectHermesProfile}
              onChange={(event) => onProjectHermesProfileChange(event.target.value)}
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="">Default profile</option>
              {hermesProfiles.map((profile) => <option key={profile.name} value={profile.name}>{profile.name}</option>)}
            </select>
          )}
        </div>
      )}

      {!isDraft && (
        <div>
          <label htmlFor="project-default-thinking-effort" className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            Default thinking effort
          </label>
          <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
            Used for new chats in this project unless the chat overrides it.
          </p>
          <select
            id="project-default-thinking-effort"
            aria-label="Default thinking effort"
            value={defaultThinkingEffort ?? ''}
            onChange={(e) => onDefaultThinkingEffortChange((e.target.value || null) as ThinkingEffort | null)}
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          >
            <option value="">Agent default</option>
            <option value="disabled">Disabled</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="max">Max</option>
          </select>
        </div>
      )}

      {/* Sources */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{isDraft ? 'Primary source' : 'Sources & repositories'}</label>
          {!isDraft && (
            <div className="flex gap-1">
              <button type="button" onClick={onRescanSources} className="text-[10px] text-nexy-accent hover:underline">Rescan</button>
              <button type="button" onClick={onAddSource} className="text-[10px] text-nexy-accent hover:underline">+ Add folder</button>
            </div>
          )}
        </div>
        <div className="mt-1 flex gap-1">
          <input
            value={rootDirectory}
            onChange={(e) => onRootDirChange(e.target.value)}
            placeholder="e.g. /home/user/my-project"
            className="flex-1 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400 truncate"
            aria-label="Primary source directory"
          />
          <button
            type="button"
            onClick={onBrowseDir}
            className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400"
            aria-label="Browse directory"
            title="Browse"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
        </div>
        {!isDraft && sources.length > 0 && (
          <div className="mt-2 space-y-2">
            {sources.map((source) => {
              const sourceRepos = repositories.filter((repo) => repo.sourceId === source.id)
              return (
                <div key={source.id} className="rounded-nexy-sm border border-nexy-border bg-nexy-recessed px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-nexy-text">{source.label}{source.isPrimary ? ' · primary' : ''}</p>
                      <p className="truncate font-mono text-[10px] text-nexy-muted">{source.localPath}</p>
                    </div>
                    {sources.length > 1 && <button type="button" onClick={() => onRemoveSource(source.id)} aria-label={`Remove ${source.label}`} className="text-nexy-muted hover:text-red-500"><X className="h-3.5 w-3.5" /></button>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {sourceRepos.length === 0 ? (
                      <span className="text-[10px] text-nexy-muted">No Git repositories discovered</span>
                    ) : sourceRepos.map((repo) => (
                      <span key={repo.id} className="inline-flex items-center gap-1 rounded-nexy-sm border border-nexy-border bg-nexy-raised py-0.5 pl-1.5 pr-1 text-[10px] text-nexy-text">
                        <span>{repo.label} · {repo.available ? (repo.branch ?? 'Git') : 'unavailable'}{repo.dirty ? ' · changes' : ''}</span>
                        <button
                          type="button"
                          onClick={() => onRemoveRepository(repo.id)}
                          aria-label={`Remove ${repo.label} repository from project`}
                          title="Remove from Nexy (files stay on disk)"
                          className="rounded-sm text-nexy-muted hover:text-red-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-nexy-accent"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {workspaceInfo && (
          <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] dark:border-gray-700 dark:bg-gray-900/30">
            <p className="font-medium text-gray-700 dark:text-gray-200">
              {workspaceInfo.exists ? 'Workspace detected' : 'Workspace path not found'}
            </p>
            <p className="mt-1 text-gray-500 dark:text-gray-400">
              {workspaceInfo.isGitRepo
                ? `Git repo · ${workspaceInfo.branch ?? 'detached'} · ${workspaceInfo.dirty ? 'dirty' : 'clean'}`
                : workspaceInfo.exists
                  ? 'No git repository detected'
                  : 'Choose a valid directory to enable repo detection'}
            </p>
            {workspaceInfo.codingMarkers.length > 0 && (
              <p className="mt-1 text-gray-500 dark:text-gray-400">
                Coding markers: {workspaceInfo.codingMarkers.join(', ')}
              </p>
            )}
          </div>
        )}
        {(workspaceInfo?.isLikelyCodingWorkspace || codingWorkspace) && (
          <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/20">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium text-blue-700 dark:text-blue-300">Software workspace</p>
                <p className="mt-1 text-[10px] text-blue-700/80 dark:text-blue-300/80">
                  {codingWorkspace
                    ? 'Coding-focused repo and diff affordances stay enabled for this project.'
                    : 'This directory looks like a codebase. Enable coding-focused repo and diff affordances for this project.'}
                </p>
              </div>
              <button
                type="button"
                onClick={onCodingWorkspaceToggle}
                className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${codingWorkspace ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                aria-label={codingWorkspace ? 'Disable software workspace mode' : 'Enable software workspace mode'}
                role="switch"
                aria-checked={codingWorkspace}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${codingWorkspace ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Instructions</label>
          <button
            type="button"
            onClick={onEnabledToggle}
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${instructionsEnabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
            aria-label={instructionsEnabled ? 'Disable instructions' : 'Enable instructions'}
            role="switch"
            aria-checked={instructionsEnabled}
          >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${instructionsEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        <div className="mb-2">
          <DropdownPanel
            open={showModeDropdown}
            onClose={() => onSetShowModeDropdown(false)}
            width="w-full"
            trigger={
              <button
                type="button"
                onClick={() => onSetShowModeDropdown(!showModeDropdown)}
                className="w-full flex items-center justify-between text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                aria-label="Instruction mode"
              >
                <span>{selectedModeLabel}</span>
                <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
              </button>
            }
          >
            {INSTRUCTION_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => onModeChange(m.value)}
                className={`w-full text-left text-xs px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 ${instructionMode === m.value ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300'}`}
              >
                {m.label}
              </button>
            ))}
          </DropdownPanel>
        </div>

        <textarea
          value={instructions}
          onChange={(e) => onInstructionsChange(e.target.value)}
          placeholder="e.g. This is a React TypeScript project. Use functional components."
          rows={4}
          className={`w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-2 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none font-mono ${!instructionsEnabled ? 'opacity-50' : ''}`}
          disabled={!instructionsEnabled}
          aria-label="Project instructions"
        />

        {instructions && variables.length > 0 && (
          <div className="mt-1 text-[10px] font-mono leading-relaxed break-all text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-900 rounded p-2 max-h-20 overflow-y-auto">
            {highlightParts.map((p, i) =>
              p.type === 'text' ? (
                <span key={i}>{p.text}</span>
              ) : (
                <span
                  key={i}
                  className={p.type === 'defined' ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-red-500 dark:text-red-400 font-semibold'}
                  title={p.type === 'defined' ? 'Defined variable' : 'Undefined variable'}
                >
                  {p.text}
                </span>
              )
            )}
          </div>
        )}
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Supports <code className="bg-gray-100 dark:bg-gray-700 px-0.5 rounded">{'{{VARIABLE}}'}</code> substitution</p>
      </div>

      {/* Variables */}
      <div>
        <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Variables</label>
        <div className="mt-1 space-y-1.5">
          {variables.map((v, idx) => (
            <div key={idx} className="flex gap-1 items-start">
              <div className="flex-1 flex flex-col">
                <input
                  value={v.key}
                  onChange={(e) => onVarChange(idx, 'key', e.target.value.toUpperCase())}
                  placeholder="KEY_NAME"
                  className={`text-xs bg-white dark:bg-gray-700 border rounded-lg px-2 py-1.5 font-mono text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 ${varErrors[idx] ? 'border-red-400 focus:ring-red-400' : 'border-gray-200 dark:border-gray-600 focus:ring-blue-400'}`}
                  aria-label={`Variable key ${idx + 1}`}
                />
                {varErrors[idx] && <p className="text-[10px] text-red-500 mt-0.5">{varErrors[idx]}</p>}
              </div>
              <input
                value={v.value}
                onChange={(e) => onVarChange(idx, 'value', e.target.value)}
                placeholder="value"
                className="flex-[2] text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                aria-label={`Variable value ${idx + 1}`}
              />
              <button
                type="button"
                onClick={() => onRemoveVariable(idx)}
                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                aria-label={`Remove variable ${v.key || idx + 1}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={onAddVariable}
            className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
            aria-label="Add variable"
          >
            <Plus className="w-3.5 h-3.5" />
            Add variable
          </button>
        </div>
      </div>

      {/* Similar past strategies (rating-based LLM retrieval) */}
      <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">Use proven approaches from this project</p>
            <p className="mt-1 text-[11px] leading-4 text-gray-500 dark:text-gray-400">
              When you send a message, Nexy compares it with conversations you rated in this project. If it finds a
              match, it gives the model a short hint about how that conversation was set up.
            </p>
          </div>
          <button
            type="button"
            onClick={onStrategyRetrievalToggle}
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${strategyRetrievalEnabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
            aria-label={strategyRetrievalEnabled ? 'Disable similar past strategies' : 'Enable similar past strategies'}
            role="switch"
            aria-checked={strategyRetrievalEnabled}
          >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${strategyRetrievalEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
          </button>
        </div>
        <div className="mt-2.5 border-t border-gray-100 pt-2.5 text-[10px] leading-4 text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <p>
            <span className="font-medium text-gray-600 dark:text-gray-300">How it matches:</span> project, agent, model,
            and words shared with your new message. Matching happens locally and uses up to five best matches.
          </p>
          <p className="mt-1">
            <span className="font-medium text-gray-600 dark:text-gray-300">What the model sees:</span> the rating, agent,
            tools, and optional note — not the old conversation or its full answer.
          </p>
          <p className="mt-1">
            <span className="font-medium text-gray-600 dark:text-gray-300">Why use it:</span> recurring work can start
            from approaches that worked well before. It adds a small amount of context to matching requests and is off
            by default.
          </p>
        </div>
      </div>

      {/* Terminal sandbox bypass */}
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 dark:border-amber-900 dark:bg-amber-950/20">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Allow terminal commands outside project root</p>
            <p className="mt-1 text-[10px] text-amber-700/80 dark:text-amber-400/80">
              Lets the agent's terminal tool run commands with a working directory outside this project's root
              directory. Off by default — enabling this lets agent-run shell commands read/write anywhere on this
              machine. Can be overridden per-chat.
            </p>
          </div>
          <button
            type="button"
            onClick={onTerminalSandboxBypassToggle}
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${terminalSandboxBypass ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'}`}
            aria-label={terminalSandboxBypass ? 'Disable terminal sandbox bypass' : 'Enable terminal sandbox bypass'}
            role="switch"
            aria-checked={terminalSandboxBypass}
          >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${terminalSandboxBypass ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </div>
    </>
  )
}
