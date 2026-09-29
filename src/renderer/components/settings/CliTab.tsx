import { NexyIcon } from '../ui/icons/NexyIcon'
import { TabHeader } from './TabHeader'

interface InstalledClis {
  claude: boolean
  codex: boolean
  hermes?: boolean
}

interface Props {
  installedClis: InstalledClis
  cliRefreshing: boolean
  onRefresh: () => Promise<void>
  hermesHome: string
  hermesHomeError: string | null
  onPickHermesHome: () => Promise<void>
  onClearHermesHome: () => Promise<void>
}

export function CliTab({ installedClis, cliRefreshing, onRefresh, hermesHome, hermesHomeError, onPickHermesHome, onClearHermesHome }: Props) {
  return (
    <>
      <TabHeader title="CLI Tools" description="Install CLI tools to chat without an API key. Each tool authenticates with its own provider." />

      {/* Claude CLI */}
      <div className="rounded-none border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 p-4 space-y-3 shadow-nexy">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">Claude CLI</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-none border font-medium ${
              installedClis.claude
                ? 'border-nexy-success bg-nexy-success/10 text-nexy-success'
                : 'border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500'
            }`}>
              {installedClis.claude ? '✓ Installed' : 'Not installed'}
            </span>
          </div>
          <button
            disabled={cliRefreshing}
            onClick={onRefresh}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 disabled:opacity-50"
          >
            <NexyIcon name={cliRefreshing ? 'busy' : 'refresh'} size={12} />
            Refresh
          </button>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Install</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-none border border-gray-300 dark:border-gray-600 px-3 py-2 font-mono overflow-x-auto select-all">npm install -g @anthropic-ai/claude-code</pre>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Authenticate (run once)</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-none border border-gray-300 dark:border-gray-600 px-3 py-2 font-mono overflow-x-auto select-all">claude</pre>
        </div>
      </div>

      {/* Codex CLI */}
      <div className="rounded-none border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 p-4 space-y-3 shadow-nexy">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">Codex CLI</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-none border font-medium ${
              installedClis.codex
                ? 'border-nexy-success bg-nexy-success/10 text-nexy-success'
                : 'border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500'
            }`}>
              {installedClis.codex ? '✓ Installed' : 'Not installed'}
            </span>
          </div>
          <button
            disabled={cliRefreshing}
            onClick={onRefresh}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 disabled:opacity-50"
          >
            <NexyIcon name={cliRefreshing ? 'busy' : 'refresh'} size={12} />
            Refresh
          </button>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Install</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-none border border-gray-300 dark:border-gray-600 px-3 py-2 font-mono overflow-x-auto select-all">npm install -g @openai/codex</pre>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Authenticate (run once)</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-none border border-gray-300 dark:border-gray-600 px-3 py-2 font-mono overflow-x-auto select-all">codex login</pre>
        </div>
      </div>

      {/* Hermes Agent */}
      <div className="rounded-none border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 p-4 space-y-3 shadow-nexy">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">Hermes Agent</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-none border font-medium ${
              installedClis.hermes
                ? 'border-nexy-success bg-nexy-success/10 text-nexy-success'
                : 'border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500'
            }`}>
              {installedClis.hermes ? '✓ Installed' : 'Not installed'}
            </span>
          </div>
          <button
            disabled={cliRefreshing}
            onClick={onRefresh}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 disabled:opacity-50"
          >
            <NexyIcon name={cliRefreshing ? 'busy' : 'refresh'} size={12} />
            Refresh
          </button>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Install</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-none border border-gray-300 dark:border-gray-600 px-3 py-2 font-mono overflow-x-auto select-all">curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash</pre>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Authenticate (run once)</p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-none border border-gray-300 dark:border-gray-600 px-3 py-2 font-mono overflow-x-auto select-all">hermes setup</pre>
        </div>
        <div className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-700">
          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">Hermes home</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Optional override for the Hermes root. Choose the folder that contains <code className="font-mono">profiles/&lt;name&gt;</code>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void onPickHermesHome() }}
              className="border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {hermesHome ? 'Change folder' : 'Choose folder'}
            </button>
            {hermesHome && (
              <button
                type="button"
                onClick={() => { void onClearHermesHome() }}
                className="px-2.5 py-1.5 text-xs text-gray-500 underline hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Clear override
              </button>
            )}
          </div>
          <p className="break-all rounded-none bg-gray-100 px-2 py-1.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {hermesHome || 'Using HERMES_HOME, or the platform default'}
          </p>
          {hermesHomeError && <p className="text-xs text-red-600 dark:text-red-400">{hermesHomeError}</p>}
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            This folder may contain Hermes credentials. Nexy stores only the path and never copies or edits its contents.
          </p>
        </div>
      </div>
    </>
  )
}
