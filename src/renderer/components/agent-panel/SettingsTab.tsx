import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Folder, FileText, Plus, ExternalLink, AlertTriangle } from 'lucide-react'
import type { AgentConfig, HermesProfileInfo, HermesProfileDiscovery, HermesAcpReadiness } from '../../../shared/types'
import { isValidHermesProfile } from '../../../shared/hermes'
import { Button, ToggleSwitch } from '../ui/primitives'

const EMOJI_OPTIONS = ['🤖', '🔍', '🐛', '💡', '📝', '🎨', '🔧', '🚀', '🧠', '⚡', '🛡️', '📊']
const FORMAT_OPTIONS = ['default', 'concise', 'detailed', 'code-only'] as const

interface HermesProfileSelectProps {
  value?: string
  profiles: HermesProfileInfo[]
  onChange: (value: string | undefined) => void
}

/**
 * A bounded replacement for the native select used for Hermes profiles.
 * Native option popups are owned by the OS and may size themselves from the
 * longest option, which lets long model/SOUL descriptions escape the field.
 */
function HermesProfileSelect({ value, profiles, onChange }: HermesProfileSelectProps) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const options = useMemo(() => {
    const discovered = profiles.map((profile) => {
      const meta = [profile.model, profile.description].filter(Boolean).join(' · ')
      return {
        value: profile.isDefault ? '' : profile.name,
        label: profile.isDefault ? 'default (normal Hermes profile)' : profile.name,
        meta,
      }
    })
    if (value && !discovered.some((option) => option.value === value)) {
      discovered.push({
        value,
        label: `⚠ ${value}`,
        meta: 'unknown profile, will fall back to default',
      })
    }
    return discovered
  }, [profiles, value])

  const selected = options.find((option) => option.value === (value ?? '')) ?? options[0]

  useEffect(() => {
    if (!open) return
    const handleOutsideMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutsideMouseDown)
    return () => document.removeEventListener('mousedown', handleOutsideMouseDown)
  }, [open])

  useEffect(() => {
    const selectedIndex = options.findIndex((option) => option.value === (value ?? ''))
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0)
  }, [options, value])

  const choose = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option.value || undefined)
    setOpen(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(highlightedIndex)
      else setOpen(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((current) => {
        const delta = event.key === 'ArrowDown' ? 1 : -1
        return (current + delta + options.length) % options.length
      })
    } else if (event.key === 'Home') {
      event.preventDefault()
      setHighlightedIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setHighlightedIndex(Math.max(0, options.length - 1))
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        <span className="min-w-0 truncate" title={selected ? `${selected.label}${selected.meta ? ` — ${selected.meta}` : ''}` : undefined}>
          {selected?.label ?? 'Select a Hermes profile'}{selected?.meta ? ` — ${selected.meta}` : ''}
        </span>
        <span aria-hidden="true" className="shrink-0 text-xs text-gray-500">▾</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Hermes profiles"
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto overflow-x-hidden rounded-lg border border-gray-300 bg-white p-1 shadow-lg dark:border-gray-600 dark:bg-gray-800"
        >
          {options.map((option, index) => (
            <button
              key={`${option.value || 'default'}-${index}`}
              type="button"
              role="option"
              aria-selected={option.value === (value ?? '')}
              title={`${option.label}${option.meta ? ` — ${option.meta}` : ''}`}
              className={`block w-full min-w-0 rounded-md px-2 py-1.5 text-left text-sm ${
                index === highlightedIndex
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700'
              }`}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => choose(index)}
            >
              <span className="block truncate">{option.label}{option.meta ? ` — ${option.meta}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  config: AgentConfig
  onUpdateField: <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => void
  thinkingSupported?: boolean
  newGlob: string
  onSetNewGlob: (v: string) => void
  onAddIgnoredGlob: () => void
  onRemoveIgnoredGlob: (i: number) => void
  newCmdName: string
  newCmdDesc: string
  newCmdPrompt: string
  onSetNewCmdName: (v: string) => void
  onSetNewCmdDesc: (v: string) => void
  onSetNewCmdPrompt: (v: string) => void
  onAddCustomCommand: () => void
  onRemoveCustomCommand: (i: number) => void
  onAddDirectories: () => void
  onAddFiles: () => void
  onRemoveContextDir: (i: number) => void
  onRemoveContextFile: (i: number) => void
  onPickRootDirectory: () => void
  onOpenCliSettings: () => void
  autoApproveDisabled?: boolean
}

export function SettingsTab({
  config, onUpdateField,
  thinkingSupported = true,
  newGlob, onSetNewGlob, onAddIgnoredGlob, onRemoveIgnoredGlob,
  newCmdName, newCmdDesc, newCmdPrompt,
  onSetNewCmdName, onSetNewCmdDesc, onSetNewCmdPrompt,
  onAddCustomCommand, onRemoveCustomCommand,
  onAddDirectories, onAddFiles, onRemoveContextDir, onRemoveContextFile,
  onPickRootDirectory, onOpenCliSettings,
  autoApproveDisabled = false,
}: Props) {
  const contextRules = config.contextRules ?? { ignoredGlobs: [], autoInjectWorkspace: false, autoInjectGit: false }
  const [showAutoApproveConfirm, setShowAutoApproveConfirm] = useState(false)

  // Hermes profile enumeration + ACP readiness (fetched only when the Hermes backend is selected).
  const [hermesProfiles, setHermesProfiles] = useState<HermesProfileInfo[] | null>(null)
  const [hermesProfileDiscovery, setHermesProfileDiscovery] = useState<HermesProfileDiscovery | null>(null)
  const [hermesReadiness, setHermesReadiness] = useState<HermesAcpReadiness | null>(null)
  const [hermesReadinessChecking, setHermesReadinessChecking] = useState(false)
  const [hermesCommandCopied, setHermesCommandCopied] = useState(false)
  useEffect(() => {
    if (config.backend !== 'hermes-cli') {
      setHermesProfiles(null)
      setHermesProfileDiscovery(null)
      setHermesReadiness(null)
      return
    }
    let cancelled = false
    Promise.resolve(window.api?.getHermesProfileDiscovery?.()).then((discovery) => {
      if (discovery?.profiles && !cancelled) {
        setHermesProfileDiscovery(discovery)
        setHermesProfiles(discovery.profiles)
        return undefined
      }
      return window.api?.listHermesProfiles?.()
    }).then((list) => {
      if (Array.isArray(list) && !cancelled) setHermesProfiles(list)
    }).catch(() => { if (!cancelled) setHermesProfiles([]) })
    Promise.resolve(window.api?.getHermesAcpReadiness?.()).then((r) => {
      if (!cancelled) setHermesReadiness(r ?? null)
    }).catch(() => { if (!cancelled) setHermesReadiness(null) })
    return () => { cancelled = true }
  }, [config.backend])

  const recheckHermes = async () => {
    setHermesReadinessChecking(true)
    try {
      const readiness = await window.api?.getHermesAcpReadiness?.(true)
      setHermesReadiness(readiness ?? null)
      const discovery = await window.api?.getHermesProfileDiscovery?.()
      if (discovery?.profiles) {
        setHermesProfileDiscovery(discovery)
        setHermesProfiles(discovery.profiles)
      } else {
        const profiles = await window.api?.listHermesProfiles?.()
        setHermesProfiles(Array.isArray(profiles) ? profiles : [])
      }
    } finally {
      setHermesReadinessChecking(false)
    }
  }

  const copyHermesCommand = async () => {
    try {
      await navigator.clipboard?.writeText('hermes acp --check')
      setHermesCommandCopied(true)
      window.setTimeout(() => setHermesCommandCopied(false), 1500)
    } catch {
      // Clipboard access is optional in packaged environments; the command remains visible.
    }
  }

  return (
    <>
      {/* Name */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Name</label>
        <input
          value={config.name}
          onChange={(e) => onUpdateField('name', e.target.value)}
          placeholder="Agent name..."
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Icon */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Icon</label>
        <div className="flex items-center gap-1.5 flex-wrap">
          <input
            value={config.icon}
            onChange={(e) => onUpdateField('icon', e.target.value)}
            maxLength={2}
            className="w-12 text-center px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {EMOJI_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => onUpdateField('icon', emoji)}
              className={`w-8 h-8 rounded text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${config.icon === emoji ? 'bg-gray-200 dark:bg-gray-700 ring-1 ring-gray-400' : ''}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* System Prompt */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">System Prompt</label>
        <textarea
          value={config.systemPrompt}
          onChange={(e) => onUpdateField('systemPrompt', e.target.value)}
          placeholder="Instructions for the agent..."
          rows={6}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        />
      </div>

      {/* Agent Memory */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Agent Memory</label>
        <p className="text-[11px] text-gray-400 dark:text-gray-500">Always appended to the system prompt in every message.</p>
        <textarea
          value={config.memory ?? ''}
          onChange={(e) => onUpdateField('memory', e.target.value)}
          placeholder="Persistent notes the agent always has access to..."
          rows={3}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        />
      </div>

      {/* Response Format */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Response Format</label>
        <select
          value={config.responseFormat}
          onChange={(e) => onUpdateField('responseFormat', e.target.value as AgentConfig['responseFormat'])}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {FORMAT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {/* Chat Backend */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Chat Backend</label>
        <select
          value={config.backend ?? ''}
          onChange={(e) => {
            const val = e.target.value
            onUpdateField('backend', val === '' ? undefined : val as AgentConfig['backend'])
          }}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Auto (BYOK key, or Claude CLI if no key)</option>
          <option value="claude-cli">Force Claude CLI (claude --print)</option>
          <option value="codex-cli">OpenAI Codex CLI (codex)</option>
          <option value="hermes-cli">Hermes Agent (ACP)</option>
        </select>
        {config.backend && (
          <div className="flex items-start justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>CLI tool must be installed and authenticated.</span>
            <button
              type="button"
              onClick={onOpenCliSettings}
              className="shrink-0 flex items-center gap-1 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Setup instructions
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        )}
        {config.backend === 'hermes-cli' && (
          <div className="mt-2 space-y-1.5">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Hermes profile</label>
            {hermesProfiles && hermesProfiles.length > 0 ? (
              <HermesProfileSelect
                value={config.hermesProfile}
                profiles={hermesProfiles}
                onChange={(value) => onUpdateField('hermesProfile', value)}
              />
            ) : (
              <input
                value={config.hermesProfile ?? ''}
                onChange={(e) => onUpdateField('hermesProfile', e.target.value.trim() || undefined)}
                placeholder="default (uses the normal Hermes profile)"
                pattern="[a-z0-9][a-z0-9_-]{0,63}"
                className={`w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  config.hermesProfile && !isValidHermesProfile(config.hermesProfile)
                    ? 'border-red-400 dark:border-red-500'
                    : 'border-gray-300 dark:border-gray-600'
                }`}
              />
            )}
            {config.hermesProfile && !isValidHermesProfile(config.hermesProfile) && (
              <p className="text-xs text-red-500">Profile names must be lowercase, start with a letter or digit, and use only a–z, 0–9, _ or - (max 64 chars).</p>
            )}
            <p className="text-xs text-gray-400">Nexy launches a separate ACP process with this profile; changing it starts a new Hermes session.</p>
            {/* D1: kept-inheritance disclosure — profiles bring their own home into the session. */}
            <p className="text-xs text-gray-400">
              Nexy runs Hermes with this profile&apos;s own home — its memory, skills, and SOUL.md carry into every session. Profiles are managed in the Hermes CLI.
            </p>
            {hermesProfileDiscovery && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400">
                {hermesProfileDiscovery.error ? (
                  <p>Profile discovery failed: {hermesProfileDiscovery.error}</p>
                ) : hermesProfileDiscovery.namedProfileCount === 0 ? (
                  <>
                    <p>Nexy found only the default profile. Named profiles must be valid Hermes profile homes under <code className="font-mono">{hermesProfileDiscovery.profilesDirectory}</code>.</p>
                    <p className="mt-1">If your profiles are stored elsewhere, open <button type="button" onClick={onOpenCliSettings} className="underline underline-offset-2 hover:text-gray-700 dark:hover:text-gray-200">Settings → CLI Tools</button> and choose the Hermes home that contains <code className="font-mono">profiles</code>, or set <code className="font-mono">HERMES_HOME</code> before starting Nexy.</p>
                  </>
                ) : (
                  <p>Profiles discovered from <code className="font-mono">{hermesProfileDiscovery.root}</code>.</p>
                )}
                {hermesProfileDiscovery.ignoredEntries.length > 0 && (
                  <p className="mt-1">Ignored {hermesProfileDiscovery.ignoredEntries.length} incomplete or invalid profile entr{hermesProfileDiscovery.ignoredEntries.length === 1 ? 'y' : 'ies'}.</p>
                )}
              </div>
            )}
            <div className={`rounded-lg border p-2 text-xs ${hermesReadiness?.ready
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300'
              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-1 min-w-0">
                  {!hermesReadiness?.ready && <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />}
                  <span>
                    {hermesReadiness?.ready
                      ? `Hermes ACP is ready${hermesReadiness.version ? ` (${hermesReadiness.version})` : ''}.`
                      : `Hermes is installed but not ACP-ready${hermesReadiness?.detail ? ` — ${hermesReadiness.detail}` : ' — run the readiness check'}.`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => { void recheckHermes() }}
                  disabled={hermesReadinessChecking}
                  className="shrink-0 underline underline-offset-2 disabled:opacity-50"
                >
                  {hermesReadinessChecking ? 'Checking…' : 'Recheck'}
                </button>
              </div>
              {!hermesReadiness?.ready && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                  <code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/10">hermes acp --check</code>
                  <button type="button" onClick={() => { void copyHermesCommand() }} className="underline underline-offset-2">
                    {hermesCommandCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              )}
            </div>
            <p className="text-[11px] text-gray-400">
              Hermes owns authentication, provider settings, memory, skills, and hooks. Use <code className="font-mono">hermes setup</code> or <code className="font-mono">hermes auth</code> in a terminal, then press Recheck; Nexy never copies Hermes credentials.
            </p>
          </div>
        )}
      </div>

      {/* Temperature */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Temperature: {config.temperature.toFixed(1)}</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={config.temperature}
          onChange={(e) => onUpdateField('temperature', parseFloat(e.target.value))}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs text-gray-400">
          <span>Precise</span>
          <span>Creative</span>
        </div>
      </div>

      {/* Max Tokens */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Max Tokens</label>
        <input
          type="number"
          value={config.maxTokens}
          onChange={(e) => onUpdateField('maxTokens', parseInt(e.target.value) || 4096)}
          min={256}
          max={128000}
          step={256}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Thinking */}
      <div className={`space-y-2 ${!thinkingSupported ? 'opacity-50' : ''}`}>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Thinking</span>
            <p className="text-xs text-gray-400 mt-0.5">
              {thinkingSupported
                ? 'Extended reasoning for Claude CLI, Anthropic, and o-series models'
                : 'Not supported by the active provider — effort will be ignored'}
            </p>
          </div>
          <ToggleSwitch
            checked={!!config.thinkingEffort && config.thinkingEffort !== 'disabled'}
            onChange={(on) => onUpdateField('thinkingEffort', on ? 'medium' : 'disabled')}
            ariaLabel="Enable thinking"
            disabled={!thinkingSupported}
          />
        </div>
        {config.thinkingEffort && config.thinkingEffort !== 'disabled' && thinkingSupported && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Effort</label>
            <select
              value={config.thinkingEffort}
              onChange={(e) => onUpdateField('thinkingEffort', e.target.value as AgentConfig['thinkingEffort'])}
              className="flex-1 px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="max">Max</option>
            </select>
          </div>
        )}
      </div>

      {/* Agentic Mode */}
      <div className="space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.agenticMode}
            onChange={(e) => onUpdateField('agenticMode', e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600 accent-blue-500"
          />
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Agentic Mode</span>
        </label>
      </div>

      {/* Context Directories */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Context Directories</label>
        {config.contextDirectories.length > 0 && (
          <div className="space-y-1">
            {config.contextDirectories.map((dir, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
                <span className="flex-1 truncate" title={dir}>
                  <Folder className="w-3 h-3 inline mr-1" />{dir}
                </span>
                <button
                  onClick={() => onRemoveContextDir(i)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                  aria-label="Remove directory"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={onAddDirectories} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          <Plus className="w-3 h-3" />
          Add Directory
        </button>
      </div>

      {/* Context Files */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Context Files</label>
        {config.contextFiles.length > 0 && (
          <div className="space-y-1">
            {config.contextFiles.map((file, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
                <span className="flex-1 truncate" title={file}>
                  <FileText className="w-3 h-3 inline mr-1" />{file}
                </span>
                <button
                  onClick={() => onRemoveContextFile(i)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                  aria-label="Remove file"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={onAddFiles} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          <Plus className="w-3 h-3" />
          Add Files
        </button>
      </div>

      {/* Root Directory */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Root Directory</label>
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          Working directory for CLI tool execution. Overrides global CWD. If the agent is used inside a project, the project&apos;s root directory takes priority.
        </p>
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-xs text-gray-600 dark:text-gray-400 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 min-h-[32px]">
            {config.rootDirectory ? config.rootDirectory : <span className="italic text-gray-400 dark:text-gray-500">Inherit global CWD</span>}
          </span>
          <Button
            variant="secondary"
            onClick={onPickRootDirectory}
            className="gap-1 px-2 py-1.5 rounded-lg transition-colors shrink-0"
            aria-label="Pick root directory"
          >
            <Folder className="w-3 h-3" />
            Browse
          </Button>
          {config.rootDirectory && (
            <button
              onClick={() => onUpdateField('rootDirectory', '')}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
              aria-label="Clear root directory"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Context Rules */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Context Rules</label>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={contextRules.autoInjectWorkspace}
              onChange={(e) => onUpdateField('contextRules', { ...contextRules, autoInjectWorkspace: e.target.checked })}
              className="rounded border-gray-300 dark:border-gray-600 accent-blue-500"
            />
            <span className="text-xs text-gray-600 dark:text-gray-400">Auto-inject <code className="font-mono">@workspace</code></span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={contextRules.autoInjectGit}
              onChange={(e) => onUpdateField('contextRules', { ...contextRules, autoInjectGit: e.target.checked })}
              className="rounded border-gray-300 dark:border-gray-600 accent-blue-500"
            />
            <span className="text-xs text-gray-600 dark:text-gray-400">Auto-inject <code className="font-mono">@git</code></span>
          </label>
        </div>
        {/* Ignored Globs */}
        <div className="space-y-1">
          <p className="text-[11px] text-gray-400 dark:text-gray-500">Ignored glob patterns (workspace summary)</p>
          {contextRules.ignoredGlobs.map((g, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
              <code className="flex-1 font-mono truncate">{g}</code>
              <button
                onClick={() => onRemoveIgnoredGlob(i)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                aria-label={`Remove glob ${g}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <input
              value={newGlob}
              onChange={(e) => onSetNewGlob(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddIgnoredGlob() } }}
              placeholder="**/node_modules/**"
              className="flex-1 px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
            />
            <Button
              variant="secondary"
              onClick={onAddIgnoredGlob}
              className="gap-1 px-2 py-1 rounded-lg transition-colors"
              aria-label="Add glob pattern"
            >
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Custom Commands */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Custom Slash Commands</label>
        {(config.customCommands ?? []).map((cmd, i) => (
          <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 space-y-1 text-xs text-gray-600 dark:text-gray-400">
            <div className="flex items-center justify-between">
              <code className="font-mono text-blue-600 dark:text-blue-400">{cmd.name}</code>
              <button
                onClick={() => onRemoveCustomCommand(i)}
                className="text-gray-400 hover:text-red-500 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label={`Remove command ${cmd.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            {cmd.description && <p className="text-gray-400 dark:text-gray-500 italic">{cmd.description}</p>}
            <p className="text-[11px] text-gray-400 truncate">{cmd.prompt}</p>
          </div>
        ))}
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-2 space-y-1.5">
          <p className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">New command</p>
          <div className="flex gap-1.5">
            <input
              value={newCmdName}
              onChange={(e) => onSetNewCmdName(e.target.value)}
              placeholder="/command-name"
              className="w-32 px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
            />
            <input
              value={newCmdDesc}
              onChange={(e) => onSetNewCmdDesc(e.target.value)}
              placeholder="Short description"
              className="flex-1 px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <textarea
            value={newCmdPrompt}
            onChange={(e) => onSetNewCmdPrompt(e.target.value)}
            placeholder="Prompt text loaded into the input when this command is invoked..."
            rows={2}
            className="w-full px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          />
          <Button
            variant="secondary"
            onClick={onAddCustomCommand}
            disabled={!newCmdName.trim()}
            className="gap-1 px-2 py-1 rounded-lg transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add Command
          </Button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="space-y-3 pt-2">
        <hr className="border-red-200 dark:border-red-900" />
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
          <span className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Danger Zone</span>
        </div>
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-900 dark:text-red-200">Auto-approve all actions</p>
              <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">All tool calls execute immediately without confirmation. Use only for fully trusted agents.</p>
            </div>
            <ToggleSwitch
              checked={config.fullAutoApprove === true}
              onChange={(checked) => {
                if (autoApproveDisabled) return
                if (checked) {
                  setShowAutoApproveConfirm(true)
                } else {
                  onUpdateField('fullAutoApprove', false)
                }
              }}
              ariaLabel="Toggle auto-approve all actions"
              disabled={autoApproveDisabled}
            />
          </div>
          {autoApproveDisabled && (
            <p
              className="text-xs text-red-700 dark:text-red-400"
              title="Auto-approve is not available for agents used in scheduled tasks"
            >
              Auto-approve is not available for agents used in scheduled tasks.
            </p>
          )}
        </div>
      </div>

      {/* Auto-approve confirmation modal */}
      {showAutoApproveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-labelledby="auto-approve-modal-title">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
              <div>
                <h2 id="auto-approve-modal-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">Enable auto-approve?</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  This agent will execute all tool calls — including file edits, shell commands, and web requests — without asking for confirmation. Are you sure?
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="secondary"
                onClick={() => setShowAutoApproveConfirm(false)}
                className="px-3 py-1.5 text-sm rounded-lg transition-colors"
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  onUpdateField('fullAutoApprove', true)
                  setShowAutoApproveConfirm(false)
                }}
                className="px-3 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                Enable auto-approve
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
