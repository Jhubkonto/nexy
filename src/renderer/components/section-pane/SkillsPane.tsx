import { useDeferredValue, useMemo, useState } from 'react'
import { NexyIcon } from '../ui/icons/NexyIcon'
import { useAppStore } from '../../store/app-store'
import { PaneSkeleton, PaneEmptyState } from './pane-primitives'
import { ModalShell } from '../ui/primitives'
import type { DiscoveredSkill } from '../../../shared/types'

type DiscoveryFilter = 'all' | 'not-imported' | 'imported' | 'attention'
type DiscoverySort = 'name-asc' | 'name-desc' | 'source' | 'status'

const DISCOVERY_SOURCE_LABELS: Record<DiscoveredSkill['source'], string> = {
  claude: 'Claude',
  codex: 'Codex',
  hermes: 'Hermes',
  filesystem: 'Filesystem',
}

function discoveryNeedsAttention(discovery: DiscoveredSkill) {
  return discovery.importable === false || discovery.validationStatus !== 'valid'
}

export function SkillsPane() {
  const skills = useAppStore((s) => s.skills)
  const skillsLoading = useAppStore((s) => s.skillsLoading)
  const openCreateSkill = useAppStore((s) => s.openCreateSkill)
  const openEditSkill = useAppStore((s) => s.openEditSkill)
  const importSkill = useAppStore((s) => s.importSkill)
  const duplicateSkill = useAppStore((s) => s.duplicateSkill)
  const exportSkill = useAppStore((s) => s.exportSkill)
  const exportSkillMarkdown = useAppStore((s) => s.exportSkillMarkdown)
  const deleteSkill = useAppStore((s) => s.deleteSkill)
  const editingSkillId = useAppStore((s) => s.editingSkillId)
  const showSkillPanel = useAppStore((s) => s.showSkillPanel)
  const setShowSkillGenerator = useAppStore((s) => s.setShowSkillGenerator)
  const discoveredSkills = useAppStore((s) => s.discoveredSkills)
  const discoveringSkills = useAppStore((s) => s.discoveringSkills)
  const discoverSkills = useAppStore((s) => s.discoverSkills)
  const importDiscoveredSkill = useAppStore((s) => s.importDiscoveredSkill)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const [query, setQuery] = useState('')
  const [showDiscovery, setShowDiscovery] = useState(false)
  const [discoveryQuery, setDiscoveryQuery] = useState('')
  const [discoveryFilter, setDiscoveryFilter] = useState<DiscoveryFilter>('all')
  const [discoverySource, setDiscoverySource] = useState<'all' | DiscoveredSkill['source']>('all')
  const [discoverySort, setDiscoverySort] = useState<DiscoverySort>('name-asc')
  const deferredQuery = useDeferredValue(query)
  const deferredDiscoveryQuery = useDeferredValue(discoveryQuery)

  const toggleDiscovery = () => {
    setShowDiscovery((prev) => {
      const next = !prev
      if (next) void discoverSkills(activeProjectId ?? undefined)
      return next
    })
  }

  const filtered = useMemo(
    () => deferredQuery
      ? skills.filter((skill) => {
        const q = deferredQuery.toLowerCase()
        return skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q) || skill.tags.some((tag) => tag.toLowerCase().includes(q))
      })
      : skills,
    [skills, deferredQuery],
  )

  const visibleDiscoveredSkills = useMemo(() => {
    const search = deferredDiscoveryQuery.trim().toLowerCase()
    const visible = discoveredSkills.filter((discovery) => {
      const matchesSearch = !search || [
        discovery.name,
        discovery.description,
        discovery.rootLabel,
        discovery.source,
      ].some((value) => value.toLowerCase().includes(search))
      const matchesFilter = discoveryFilter === 'all'
        || (discoveryFilter === 'not-imported' && !discovery.alreadyImported)
        || (discoveryFilter === 'imported' && discovery.alreadyImported)
        || (discoveryFilter === 'attention' && discoveryNeedsAttention(discovery))
      const matchesSource = discoverySource === 'all' || discovery.source === discoverySource
      return matchesSearch && matchesFilter && matchesSource
    })

    const statusRank = (discovery: DiscoveredSkill) => {
      if (discovery.importable === false || discovery.validationStatus === 'invalid') return 0
      if (discovery.validationStatus === 'warning') return 1
      if (!discovery.alreadyImported) return 2
      return 3
    }
    const compareNames = (left: DiscoveredSkill, right: DiscoveredSkill) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })

    return [...visible].sort((left, right) => {
      if (discoverySort === 'name-desc') return compareNames(right, left)
      if (discoverySort === 'source') {
        const sourceComparison = DISCOVERY_SOURCE_LABELS[left.source].localeCompare(DISCOVERY_SOURCE_LABELS[right.source])
        return sourceComparison || compareNames(left, right)
      }
      if (discoverySort === 'status') {
        const statusComparison = statusRank(left) - statusRank(right)
        return statusComparison || compareNames(left, right)
      }
      return compareNames(left, right)
    })
  }, [discoveredSkills, deferredDiscoveryQuery, discoveryFilter, discoverySource, discoverySort])

  const discoveryViewIsFiltered = deferredDiscoveryQuery.trim().length > 0
    || discoveryFilter !== 'all'
    || discoverySource !== 'all'
  const discoveryCountLabel = discoveryViewIsFiltered
    ? `${visibleDiscoveredSkills.length} of ${discoveredSkills.length} shown`
    : `${discoveredSkills.length} found on disk`

  if (skillsLoading) {
    return (
      <PaneSkeleton rows={3} rowHeight="h-14" />
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex h-9 items-center justify-between border-b border-nexy-border px-4">
        <span className="nexy-font-status shrink-0 whitespace-nowrap text-nexy-muted">
          {skills.length} in library
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={importSkill}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Import skill"
          >
            <NexyIcon name="upload" className="w-3.5 h-3.5" />
            Import
          </button>
          <button
            onClick={toggleDiscovery}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${showDiscovery ? 'text-nexy-accent bg-nexy-recessed' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            aria-label="Discover skills on disk"
            aria-pressed={showDiscovery}
          >
            <NexyIcon name="search" className="w-3.5 h-3.5" />
            Discover
          </button>
          <button
            onClick={() => setShowSkillGenerator(true)}
            className="flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            aria-label="Generate skill with AI"
          >
            <NexyIcon name="spark" className="w-3.5 h-3.5" />
            Generate
          </button>
          <button
            onClick={openCreateSkill}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Create new skill"
          >
            <NexyIcon name="add" className="w-3.5 h-3.5" />
            New
          </button>
        </div>
      </div>

      <div className="border-b border-nexy-border px-3 py-2">
        <div className="relative">
          <NexyIcon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills..."
            className="w-full rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed py-1.5 pl-8 pr-7 text-xs text-nexy-text outline-none transition-colors placeholder:text-nexy-muted focus:bg-nexy-raised focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-nexy-accent"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label="Clear search"
            >
              <NexyIcon name="close" className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {showDiscovery && (
        <ModalShell
          title="Discover skills"
          description="Find reusable skill packages in your harness and project folders."
          icon={<NexyIcon name="search" className="h-4 w-4 text-nexy-accent" />}
          maxWidth="max-w-2xl"
          height="max-h-[78vh]"
          bodyClassName="flex-1 min-h-0 overflow-y-auto bg-nexy-recessed/30 p-3"
          onClose={() => setShowDiscovery(false)}
        >
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="nexy-font-status text-nexy-muted">
              {discoveringSkills ? 'Scanning disk…' : discoveryCountLabel}
            </span>
            <button
              onClick={() => void discoverSkills(activeProjectId ?? undefined)}
              disabled={discoveringSkills}
              className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-1.5 py-0.5 rounded disabled:opacity-50"
              aria-label="Rescan for skills on disk"
            >
              <NexyIcon name="refresh" className="w-3 h-3" />
              Rescan
            </button>
          </div>
          {!discoveringSkills && discoveredSkills.length > 0 && (
            <div className="mb-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
              <div className="relative">
                <NexyIcon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-nexy-muted pointer-events-none" />
                <input
                  type="search"
                  value={discoveryQuery}
                  onChange={(event) => setDiscoveryQuery(event.target.value)}
                  placeholder="Search discovered skills…"
                  aria-label="Search discovered skills"
                  className="w-full rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed py-1.5 pl-8 pr-7 text-xs text-nexy-text outline-none placeholder:text-nexy-muted focus:bg-nexy-raised focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-nexy-accent"
                />
                {discoveryQuery && (
                  <button
                    onClick={() => setDiscoveryQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-nexy-muted hover:text-nexy-text"
                    aria-label="Clear discovered skill search"
                  >
                    <NexyIcon name="close" className="h-3 w-3" />
                  </button>
                )}
              </div>
              <select
                value={discoveryFilter}
                onChange={(event) => setDiscoveryFilter(event.target.value as DiscoveryFilter)}
                aria-label="Filter discovered skills"
                className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed px-2 py-1.5 text-xs text-nexy-text outline-none focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-nexy-accent"
              >
                <option value="all">All statuses</option>
                <option value="not-imported">Not in library</option>
                <option value="imported">In library</option>
                <option value="attention">Needs attention</option>
              </select>
              <select
                value={discoverySource}
                onChange={(event) => setDiscoverySource(event.target.value as 'all' | DiscoveredSkill['source'])}
                aria-label="Filter discovered skill sources"
                className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed px-2 py-1.5 text-xs text-nexy-text outline-none focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-nexy-accent"
              >
                <option value="all">All sources</option>
                {Object.entries(DISCOVERY_SOURCE_LABELS).map(([source, label]) => (
                  <option key={source} value={source}>{label}</option>
                ))}
              </select>
              <select
                value={discoverySort}
                onChange={(event) => setDiscoverySort(event.target.value as DiscoverySort)}
                aria-label="Sort discovered skills"
                className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed px-2 py-1.5 text-xs text-nexy-text outline-none focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-nexy-accent"
              >
                <option value="name-asc">Name A–Z</option>
                <option value="name-desc">Name Z–A</option>
                <option value="source">Source</option>
                <option value="status">Status</option>
              </select>
            </div>
          )}
          {discoveringSkills ? (
            <p className="px-1 py-8 text-center text-xs text-nexy-muted">Scanning skill folders…</p>
          ) : discoveredSkills.length === 0 ? (
            <p className="px-1 py-8 text-center text-xs text-nexy-muted">
              No skill packages found in the Claude, Codex, Hermes, or project skills folders.
            </p>
          ) : visibleDiscoveredSkills.length === 0 ? (
            <p className="px-1 py-8 text-center text-xs text-nexy-muted">
              No discovered skills match the current search or filters.
            </p>
          ) : (
            <div className="space-y-0.5 max-h-[50vh] overflow-y-auto">
              {visibleDiscoveredSkills.map((discovery) => (
                <div
                  key={discovery.packagePath}
                  title={discovery.name}
                  className="flex items-center gap-2 rounded-nexy-sm border border-transparent px-2 py-1.5 hover:border-nexy-border"
                >
                  <span className="text-sm leading-none shrink-0">{discovery.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{discovery.name}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                      {discovery.description || 'No activation description'}
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                      {discovery.rootLabel} · {discovery.source}
                    </p>
                    {discovery.runtimeRequirements?.browser && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 truncate" title={discovery.runtimeRequirements.browser.requiredCapabilities.join(', ')}>
                        Requires browser capabilities
                      </p>
                    )}
                  </div>
                  {discovery.alreadyImported ? (
                    <span className="text-[9px] uppercase text-nexy-muted shrink-0">In library</span>
                  ) : (
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <button
                        onClick={() => void importDiscoveredSkill(discovery)}
                        disabled={discovery.importable === false}
                        title={discovery.importable === false
                          ? (discovery.validationErrors?.join(' ') || 'This SKILL.md is not valid yet.')
                          : discovery.validationStatus !== 'valid'
                            ? "Nexy will normalize this skill's metadata while importing it."
                            : 'Copy this skill into the Nexy library'}
                        className="flex items-center gap-1 text-[10px] text-nexy-accent hover:opacity-80 px-1.5 py-0.5 rounded disabled:cursor-not-allowed disabled:text-nexy-muted disabled:opacity-100 shrink-0"
                        aria-label={`Import ${discovery.name}`}
                      >
                        <NexyIcon name="download" className="w-3 h-3" />
                        {discovery.importable === false ? 'Cannot import' : 'Import'}
                      </button>
                      {discovery.importable === false && (
                        <span
                          className="max-w-40 text-right text-[9px] leading-tight text-red-500"
                          title={discovery.validationErrors?.join(' ') || 'This SKILL.md is not valid yet.'}
                        >
                          {discovery.validationErrors?.[0] || 'Invalid SKILL.md'}
                        </span>
                      )}
                      {discovery.importable !== false && discovery.validationStatus !== 'valid' && (
                        <span
                          className="max-w-40 text-right text-[9px] leading-tight text-amber-600 dark:text-amber-400"
                          title={[...(discovery.validationErrors ?? []), ...(discovery.validationWarnings ?? [])].join(' ') || 'This skill has metadata warnings but can still be imported.'}
                        >
                          {discovery.validationErrors?.[0] || discovery.validationWarnings?.[0] || 'Warning'}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 px-1 pt-2 border-t border-nexy-border/60 text-[9px] leading-snug text-nexy-muted">
            Scans your Claude, Codex, Hermes, and project skills folders (including <code className="text-[9px]">skills/</code>). Set{' '}
            <code className="text-[9px]">CLAUDE_CONFIG_DIR</code> or <code className="text-[9px]">CODEX_HOME</code> to
            point Nexy at a custom harness location. Skills you attach to a CLI agent are synced into that
            harness&apos;s folder automatically while the agent runs.
          </p>
        </ModalShell>
      )}

      <div className="flex-1 overflow-y-auto mr-1.5 p-2 space-y-0.5">
        {filtered.length === 0 ? (
          <PaneEmptyState>
            {deferredQuery ? `No skills match "${deferredQuery}"` : 'No skills yet - generate or create one to reuse across agents'}
          </PaneEmptyState>
        ) : filtered.map((skill) => (
          <div
            key={skill.id}
            title={skill.name}
            onClick={() => openEditSkill(skill.id)}
            aria-current={showSkillPanel && editingSkillId === skill.id ? 'true' : undefined}
            className={`group flex cursor-pointer items-center gap-2 rounded-nexy-sm border px-2 py-2 transition-colors ${showSkillPanel && editingSkillId === skill.id
              ? 'border-nexy-accent bg-nexy-recessed border-l-4'
              : 'border-transparent hover:border-nexy-border hover:bg-nexy-recessed'
            }`}
          >
            <span className="text-base leading-none shrink-0">{skill.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{skill.name}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                {skill.description || 'No activation description'}
              </p>
            </div>
            <span className={`text-[9px] uppercase ${skill.validationStatus === 'invalid' ? 'text-red-500' : 'text-nexy-muted'}`}>
              {skill.validationStatus ?? 'valid'}
            </span>
            <div className="invisible group-hover:visible flex items-center gap-0.5 shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); void duplicateSkill(skill.id) }}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                aria-label={`Duplicate ${skill.name}`}
              >
                <NexyIcon name="duplicate" className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); void exportSkill(skill.id) }}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                aria-label={`Export ${skill.name} as JSON`}
              >
                <NexyIcon name="download" className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); void exportSkillMarkdown(skill.id) }}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                aria-label={`Export ${skill.name} package`}
              >
                <NexyIcon name="artifact" className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); void deleteSkill(skill.id) }}
                className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                aria-label={`Delete ${skill.name}`}
              >
                <NexyIcon name="delete" className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
