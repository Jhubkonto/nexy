// Hand-curated catalog of well-known MCP servers, surfaced as a capability-first
// gallery in the MCP server panel so users pick "what they want" instead of typing
// launch commands. Kept dependency-free and shareable with the Android companion.

export type McpCatalogCategory = 'browser' | 'files' | 'dev' | 'web' | 'data' | 'productivity'

export type McpCatalogImpact = 'read-only' | 'can-change'

export interface McpCatalogRequiredEnv {
  key: string
  label: string
  helpUrl?: string
  /** Rendered as a masked field and (Phase 2) stored via safeStorage. */
  secret?: boolean
}

export interface McpCatalogEntry {
  /** Stable catalog id (not the persisted server id). */
  id: string
  /** Default server name pre-filled into the form. */
  name: string
  /** Capability-first title shown to users; name stays the technical server identity. */
  capability: string
  description: string
  category: McpCatalogCategory
  /** Plain-language scope shown before the technical launch command. */
  access: string
  impact: McpCatalogImpact
  command: string
  args: string[]
  launch?: { kind: 'managed-playwright'; mode: 'launch' | 'cdp' }
  env?: Record<string, string>
  imageResponses?: 'allow' | 'omit'
  /** Declared secrets/config the server needs — rendered as labeled fields. */
  requiredEnv?: McpCatalogRequiredEnv[]
  docsUrl?: string
  /** Extra capability terms for search ("screenshot", "browse the web"). */
  keywords?: string[]
}

export const MCP_CATEGORY_LABELS: Record<McpCatalogCategory, string> = {
  browser: 'Browser',
  files: 'Files',
  dev: 'Developer',
  web: 'Web',
  data: 'Data',
  productivity: 'Productivity',
}

// Order here controls the order categories render in the gallery.
export const MCP_CATEGORY_ORDER: McpCatalogCategory[] = [
  'browser',
  'files',
  'dev',
  'web',
  'data',
  'productivity',
]

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: 'playwright',
    name: 'Playwright (Chromium)',
    capability: 'Control a browser',
    description: 'AI-controlled managed browser — navigate pages, click, type, screenshot.',
    category: 'browser',
    access: 'A managed Chromium browser session',
    impact: 'can-change',
    command: '',
    args: [],
    launch: { kind: 'managed-playwright', mode: 'launch' },
    imageResponses: 'allow',
    docsUrl: 'https://github.com/microsoft/playwright-mcp',
    keywords: ['browser', 'web', 'screenshot', 'automation', 'scrape', 'chromium'],
  },
  {
    id: 'playwright-cdp',
    name: 'Playwright (CDP attach)',
    capability: 'Connect to an open browser',
    description: 'Attach to an existing Chrome/Edge launched with --remote-debugging-port=9222.',
    category: 'browser',
    access: 'The browser session running on this computer',
    impact: 'can-change',
    command: '',
    args: [],
    launch: { kind: 'managed-playwright', mode: 'cdp' },
    imageResponses: 'allow',
    docsUrl: 'https://github.com/microsoft/playwright-mcp',
    keywords: ['browser', 'chrome', 'edge', 'attach', 'debugging', 'cdp'],
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    capability: 'Access local files',
    description: 'Read, write, and search files within a directory you choose.',
    category: 'files',
    access: 'The directory you select',
    impact: 'can-change',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    keywords: ['files', 'disk', 'read', 'write', 'directory', 'folder'],
  },
  {
    id: 'git',
    name: 'Git',
    capability: 'Work with Git repositories',
    description: 'Inspect and operate on a local Git repository — status, log, diff, commit.',
    category: 'dev',
    access: 'A local Git repository',
    impact: 'can-change',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    keywords: ['git', 'repo', 'commit', 'diff', 'version control'],
  },
  {
    id: 'github',
    name: 'GitHub',
    capability: 'Use GitHub',
    description: 'Access GitHub repos, issues, and pull requests with your token.',
    category: 'dev',
    access: 'The GitHub account allowed by your token',
    impact: 'can-change',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    requiredEnv: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub Personal Access Token',
        helpUrl: 'https://github.com/settings/tokens',
        secret: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    keywords: ['github', 'repo', 'issues', 'pull request', 'pr', 'code'],
  },
  {
    id: 'fetch',
    name: 'Fetch',
    capability: 'Read web pages',
    description: 'Fetch a URL and return its content as clean markdown for the model.',
    category: 'web',
    access: 'Public web URLs requested by the agent',
    impact: 'read-only',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    keywords: ['web', 'url', 'fetch', 'http', 'read page', 'markdown'],
  },
  {
    id: 'memory',
    name: 'Memory',
    capability: 'Remember project knowledge',
    description: 'A persistent knowledge graph the model can store and recall facts from.',
    category: 'data',
    access: 'Nexy’s local MCP memory store',
    impact: 'can-change',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    keywords: ['memory', 'knowledge', 'remember', 'graph', 'notes'],
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    capability: 'Structure complex work',
    description: 'Structured step-by-step reasoning scaffold for harder problems.',
    category: 'productivity',
    access: 'No external data; creates working notes for the model',
    impact: 'read-only',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    keywords: ['reasoning', 'planning', 'think', 'steps', 'chain of thought'],
  },
  {
    id: 'time',
    name: 'Time',
    capability: 'Look up time zones',
    description: 'Current time and timezone conversions.',
    category: 'productivity',
    access: 'Time-zone data and the local system clock',
    impact: 'read-only',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-time'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    keywords: ['time', 'clock', 'timezone', 'date'],
  },
]

/** Config shape the panel form consumes when a catalog card is chosen. */
export interface McpCatalogFormConfig {
  name: string
  command: string
  args: string[]
  launch?: { kind: 'managed-playwright'; mode: 'launch' | 'cdp' }
  env: Record<string, string>
  cwd?: string
  imageResponses?: 'allow' | 'omit'
  enabled: boolean
}

export function catalogEntryToConfig(entry: McpCatalogEntry): McpCatalogFormConfig {
  const env: Record<string, string> = { ...(entry.env ?? {}) }
  // Seed declared secrets as empty keys so the guided fields render for the user to fill.
  for (const req of entry.requiredEnv ?? []) {
    if (!(req.key in env)) env[req.key] = ''
  }
  return {
    name: entry.name,
    command: entry.command,
    args: [...entry.args],
    launch: entry.launch,
    env,
    cwd: undefined,
    imageResponses: entry.imageResponses,
    enabled: true,
  }
}

/** Case-insensitive match across name, description, category, and keywords. */
export function searchCatalog(query: string): McpCatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return MCP_CATALOG
  const terms = q.split(/\s+/)
  return MCP_CATALOG.filter((entry) => {
    const haystack = [
      entry.name,
      entry.description,
      MCP_CATEGORY_LABELS[entry.category],
      ...(entry.keywords ?? []),
    ]
      .join(' ')
      .toLowerCase()
    return terms.every((t) => haystack.includes(t))
  })
}
