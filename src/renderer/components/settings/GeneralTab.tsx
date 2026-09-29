import { useEffect, useState } from 'react'
import { NexyIcon } from '../ui/icons/NexyIcon'
import { getModelLabel } from '../../../shared/models'
import { Button, ToggleSwitch } from '../ui/primitives'
import type { AvailableModelGroup, HermesProfileInfo } from '@shared/types'
import type { UiStyle } from '../../store/types'
import { TabHeader } from './TabHeader'

interface Props {
  theme: string
  toggleTheme: () => void
  uiStyle: UiStyle
  onSetUiStyle: (style: UiStyle) => void
  effectiveModel: string
  effectiveProvider: string
  autoStart: boolean
  runInBackground: boolean
  autoClipboard: boolean
  defaultModel: string
  globalHermesProfile: string
  hermesProfiles: HermesProfileInfo[]
  defaultModelSearch: string
  showDefaultModelMenu: boolean
  defaultModelMenuRect: DOMRect | null
  availableModelGroups: AvailableModelGroup[]
  modelIds: string[]
  temperature: number
  maxTokens: number
  catalogModels: import('@shared/types').CatalogModel[] | undefined
  onToggleAutoStart: () => void
  onToggleRunInBackground: () => void
  onToggleAutoClipboard: () => void
  onSetDefaultModel: (id: string) => void
  onSetGlobalHermesProfile: (profile: string) => void
  onSetDefaultModelSearch: (q: string) => void
  onSetShowDefaultModelMenu: (show: boolean) => void
  onSetDefaultModelMenuRect: (rect: DOMRect | null) => void
  onSetTemperature: (t: number) => void
  onSetMaxTokens: (n: number) => void
  onSaveAdvanced: () => void
  onOpenMcp: () => void
  defaultModelMenuRef: React.RefObject<HTMLDivElement | null>
  defaultModelButtonRef: React.RefObject<HTMLButtonElement | null>
}

export function GeneralTab({
  theme, toggleTheme, uiStyle, onSetUiStyle,
  effectiveModel, effectiveProvider,
  autoStart, runInBackground, autoClipboard,
  defaultModel, globalHermesProfile, hermesProfiles, defaultModelSearch, showDefaultModelMenu, defaultModelMenuRect,
  availableModelGroups, modelIds,
  temperature, maxTokens,
  catalogModels,
  onToggleAutoStart, onToggleRunInBackground, onToggleAutoClipboard,
  onSetDefaultModel, onSetGlobalHermesProfile, onSetDefaultModelSearch, onSetShowDefaultModelMenu, onSetDefaultModelMenuRect,
  onSetTemperature, onSetMaxTokens, onSaveAdvanced,
  onOpenMcp,
  defaultModelMenuRef, defaultModelButtonRef,
}: Props) {
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null)
  useEffect(() => { void window.api.getVersion().then(setDesktopVersion).catch(() => setDesktopVersion(null)) }, [])
  return (
    <>
      <TabHeader title="General" description="Appearance, default model, and app behaviour." />

      <div className="flex items-center justify-between">
        <div><p className="text-sm font-medium text-gray-800 dark:text-gray-100">Nexy desktop version</p><p className="text-xs text-gray-500">Version currently running on this computer</p></div>
        <span className="font-mono text-xs text-gray-700 dark:text-gray-200">v{desktopVersion ?? 'Unknown'}</span>
      </div>

      {/* Theme */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Theme</p>
          <p className="text-xs text-gray-500">Switch between light and dark mode</p>
        </div>
        <Button
          variant="secondary"
          onClick={toggleTheme}
          className="border-2 rounded-none border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          <span className="flex items-center gap-1.5">
            <NexyIcon name={theme === 'dark' ? 'spark' : 'milestone'} size={14} />
            {theme === 'dark' ? 'Light' : 'Dark'}
          </span>
        </Button>
      </div>

      {/* Visual style is independent from light/dark appearance. */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">UI style</p>
          <p className="text-xs text-gray-500">Choose the visual language without changing brightness</p>
        </div>
        <div className="flex shrink-0 gap-1" role="group" aria-label="UI style">
          {(['classic', '8bit'] as const).map((style) => (
            <Button
              key={style}
              variant={uiStyle === style ? 'primary' : 'secondary'}
              onClick={() => onSetUiStyle(style)}
              aria-pressed={uiStyle === style}
            >
              {style === 'classic' ? 'Classic' : '8-bit'}
            </Button>
          ))}
        </div>
      </div>

      {/* Active model */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Active model</p>
          <p className="text-xs text-gray-500">Current chat model and provider</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{getModelLabel(effectiveModel, catalogModels)}</p>
          <p className="text-[11px] text-gray-500">{effectiveProvider}</p>
        </div>
      </div>

      {/* Auto-start */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Start on login</p>
          <p className="text-xs text-gray-500">Automatically launch when you log in</p>
        </div>
        <ToggleSwitch checked={autoStart} onChange={() => onToggleAutoStart()} ariaLabel="Start on login" />
      </div>

      {/* Tray-resident execution */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Run in background</p>
          <p className="text-xs text-gray-500">Closing the window keeps Nexy in the tray so scheduled tasks can run</p>
        </div>
        <ToggleSwitch checked={runInBackground} onChange={() => onToggleRunInBackground()} ariaLabel="Run in background" />
      </div>
      {runInBackground && !autoStart && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 -mt-2">
          Enable Start on login too if schedules should be armed automatically after you sign in.
        </p>
      )}

      {/* Auto clipboard on focus */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Auto-read clipboard on focus</p>
          <p className="text-xs text-gray-500">Automatically paste clipboard text when app gains focus</p>
        </div>
        <ToggleSwitch checked={autoClipboard} onChange={() => onToggleAutoClipboard()} ariaLabel="Auto-read clipboard on focus" />
      </div>

      {/* Global Hotkey */}
      <div>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Global Hotkey</p>
        <p className="text-xs text-gray-500 mt-1">
          <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs font-mono">
            {window.api.platform === 'darwin' ? 'Cmd+Shift+H' : 'Ctrl+Shift+H'}
          </kbd>{' '}
          to show/hide the app
        </p>
      </div>

      {/* MCP Servers */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">MCP Servers</p>
          <p className="text-xs text-gray-500">Manage Model Context Protocol servers</p>
        </div>
        <Button
          variant="secondary"
          onClick={onOpenMcp}
          className="border-2 rounded-none border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          <span className="flex items-center gap-1.5">
            <NexyIcon name="tool" size={14} />
            Configure
          </span>
        </Button>
      </div>

      <div className="p-3 rounded-none border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center gap-1.5">
            <NexyIcon name="settings" size={14} className="text-gray-400" />
            Advanced
          </p>
          <p className="text-xs text-gray-500">Default model and generation parameters</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Default model</label>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Fallback used when no agent or project default is set</p>
          <div className="relative" ref={defaultModelMenuRef}>
            <button
              ref={defaultModelButtonRef}
              type="button"
              onClick={() => {
                if (defaultModelButtonRef.current) {
                  onSetDefaultModelMenuRect(defaultModelButtonRef.current.getBoundingClientRect())
                }
                onSetShowDefaultModelMenu(!showDefaultModelMenu)
              }}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between gap-2"
            >
              <span className="truncate">
                {(() => {
                  for (const g of availableModelGroups) {
                    const m = g.models.find((m) => m.id === defaultModel)
                    if (m) return getModelLabel(m.id, catalogModels) !== m.id ? getModelLabel(m.id, catalogModels) : m.label
                  }
                  return getModelLabel(defaultModel, catalogModels)
                })()}
              </span>
              <svg className="w-4 h-4 shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {showDefaultModelMenu && defaultModelMenuRect && (
              <div
                className="fixed z-50 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg flex flex-col"
                style={{ top: defaultModelMenuRect.bottom + 4, left: defaultModelMenuRect.left, width: defaultModelMenuRect.width }}
              >
                <div className="p-1.5 border-b border-gray-100 dark:border-gray-700">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search models..."
                    value={defaultModelSearch}
                    onChange={(e) => onSetDefaultModelSearch(e.target.value)}
                    className="w-full px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                <div className="overflow-auto max-h-56 p-1">
                  {(availableModelGroups.length > 0
                    ? availableModelGroups
                    : [{ sourceKey: 'catalog', sourceLabel: 'Models', sourceType: 'provider' as const, models: modelIds.map((id) => ({ id, label: getModelLabel(id, catalogModels) })) }]
                  ).map((group) => {
                    const q = defaultModelSearch.toLowerCase()
                    const filtered = q
                      ? group.models.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
                      : group.models
                    if (filtered.length === 0) return null
                    return (
                      <div key={group.sourceKey}>
                        <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 mt-0.5 first:border-t-0 first:mt-0">
                          {group.sourceLabel}
                        </div>
                        {filtered.map((model) => (
                          <button
                            key={model.id}
                            type="button"
                            className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${model.id === defaultModel ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                            onClick={() => { onSetDefaultModel(model.id); onSetShowDefaultModelMenu(false) }}
                          >
                            {getModelLabel(model.id, catalogModels) !== model.id ? getModelLabel(model.id, catalogModels) : model.label}
                          </button>
                        ))}
                      </div>
                    )
                  })}
                  {defaultModelSearch && (availableModelGroups.length > 0 ? availableModelGroups : []).every((g) => !g.models.some((m) => m.id.toLowerCase().includes(defaultModelSearch.toLowerCase()) || m.label.toLowerCase().includes(defaultModelSearch.toLowerCase()))) && (
                    <p className="px-2 py-2 text-xs text-gray-400 dark:text-gray-500">No models match "{defaultModelSearch}"</p>
                  )}
                </div>
              </div>
            )}
          </div>
          {availableModelGroups.some((group) => group.sourceKey === 'hermes-cli' && group.models.some((model) => model.id === defaultModel)) && (
            <div className="mt-2">
              <label htmlFor="global-default-hermes-profile" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Hermes profile</label>
              <select
                id="global-default-hermes-profile"
                aria-label="Global default Hermes profile"
                value={globalHermesProfile}
                onChange={(event) => onSetGlobalHermesProfile(event.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
              >
                <option value="">Default profile</option>
                {hermesProfiles.map((profile) => <option key={profile.name} value={profile.name}>{profile.name}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-gray-500">This profile travels with the global Hermes model target.</p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Temperature: {temperature.toFixed(1)}</label>
          <input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(e) => onSetTemperature(Number.parseFloat(e.target.value))} className="w-full accent-blue-500" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Max tokens</label>
          <input
            type="number" min={256} max={16384} step={256} value={maxTokens}
            onChange={(e) => onSetMaxTokens(Number.parseInt(e.target.value, 10) || 4096)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <Button
          variant="primary"
          onClick={onSaveAdvanced}
          className="rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200"
        >
          Save advanced settings
        </Button>
      </div>
    </>
  )
}
