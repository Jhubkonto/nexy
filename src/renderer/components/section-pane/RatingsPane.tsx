import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ConversationRatingListItem, ConversationRatingStats, RatingAggregate, RatingTrendPoint } from '../../../shared/types'
import { useAppStore } from '../../store/app-store'
import { NexyIcon } from '../ui/icons/NexyIcon'
import { PaneSkeleton, PaneEmptyState } from './pane-primitives'

const EMPTY_STATS: ConversationRatingStats = {
  averageByAgent: [], averageByModel: [], averageBySkill: [], averageByServer: [], averageByProject: [], trend: [],
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-nexy-warning" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <NexyIcon key={n} name="rating" className={`h-3 w-3 ${n <= rating ? '' : 'text-nexy-border opacity-60'}`} />
      ))}
    </span>
  )
}

function useChartColors() {
  return {
    bar: 'rgb(var(--nexy-accent))',
    grid: 'rgb(var(--nexy-border))',
    axis: 'rgb(var(--nexy-muted-text))',
  }
}

function RatingBarChart({ title, data }: { title: string; data: RatingAggregate[] }) {
  const { bar, grid, axis } = useChartColors()
  if (data.length === 0) return null
  const top = data.slice(0, 8)
  return (
    <div>
      <p className="nexy-font-status mb-1 text-nexy-muted">{title}</p>
      <ResponsiveContainer width="100%" height={Math.max(56, top.length * 26)}>
        <BarChart data={top} layout="vertical" margin={{ top: 2, right: 20, bottom: 2, left: 2 }}>
          <CartesianGrid horizontal={false} stroke={grid} />
          <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 10, fill: axis }} axisLine={false} tickLine={false} />
          <YAxis
            type="category"
            dataKey="label"
            width={84}
            tick={{ fontSize: 10, fill: axis }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
          />
          <Tooltip
            cursor={{ fill: grid, opacity: 0.3 }}
            formatter={(value, _name, item) => [
              `${Number(value).toFixed(1)} / 5 (${(item.payload as RatingAggregate).count} rated)`,
              'Average',
            ]}
            contentStyle={{ fontSize: 11, borderRadius: 0, border: '2px solid rgb(var(--nexy-border))', background: 'rgb(var(--nexy-raised))' }}
          />
          <Bar dataKey="average" fill={bar} radius={0} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function RatingTrendChart({ data }: { data: RatingTrendPoint[] }) {
  const { bar, grid, axis } = useChartColors()
  if (data.length === 0) return null
  return (
    <div>
      <p className="nexy-font-status mb-1 text-nexy-muted">Rating Trend</p>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: -20 }}>
          <CartesianGrid vertical={false} stroke={grid} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: axis }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 5]} tick={{ fontSize: 10, fill: axis }} axisLine={false} tickLine={false} width={24} />
          <Tooltip
            formatter={(value, _name, item) => [
              `${Number(value).toFixed(1)} / 5 (${(item.payload as RatingTrendPoint).count} rated)`,
              'Average',
            ]}
            contentStyle={{ fontSize: 11, borderRadius: 0, border: '2px solid rgb(var(--nexy-border))', background: 'rgb(var(--nexy-raised))' }}
          />
          <Line type="monotone" dataKey="average" stroke={bar} strokeWidth={2} dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function RatingListItem({ item, onClick }: { item: ConversationRatingListItem; onClick: (conversationId: string) => void }) {
  const subtitleParts = [item.projectName, item.agentName, item.model].filter(Boolean)
  const tags = [...item.toolNames, ...item.skillNames]
  return (
    <div
      title={item.conversationTitle}
      onClick={() => onClick(item.conversationId)}
      className="group flex cursor-pointer flex-col gap-1 rounded-nexy-sm border border-transparent px-2 py-2 transition-colors hover:border-nexy-border hover:bg-nexy-recessed"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex-1 truncate text-xs font-medium text-nexy-text">{item.conversationTitle}</p>
        <StarRow rating={item.rating} />
      </div>
      {subtitleParts.length > 0 && (
        <p className="truncate text-[10px] text-nexy-muted">{subtitleParts.join(' · ')}</p>
      )}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 6).map((tag) => (
            <span key={tag} className="rounded-nexy-sm border border-nexy-border bg-nexy-surface px-1.5 py-0.5 text-[9px] text-nexy-muted">
              {tag}
            </span>
          ))}
        </div>
      )}
      {item.note && <p className="truncate text-[10px] italic text-nexy-muted">"{item.note}"</p>}
    </div>
  )
}

type SortMode = 'recent' | 'rating'

export function RatingsPane() {
  const selectConversation = useAppStore((s) => s.selectConversation)

  const [ratings, setRatings] = useState<ConversationRatingListItem[]>([])
  const [stats, setStats] = useState<ConversationRatingStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [sortMode, setSortMode] = useState<SortMode>('recent')

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [list, ratingStats] = await Promise.all([
        window.api.listConversationRatings(),
        window.api.getConversationRatingStats(),
      ])
      setRatings(list)
      setStats(ratingStats)
    } catch {
      // leave existing data
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadAll() }, [loadAll])
  useEffect(() => window.api.onConversationRated(() => void loadAll()), [loadAll])

  const filtered = useMemo(() => {
    const q = deferredQuery.toLowerCase()
    const list = q
      ? ratings.filter((r) =>
          r.conversationTitle.toLowerCase().includes(q) ||
          (r.agentName ?? '').toLowerCase().includes(q) ||
          (r.model ?? '').toLowerCase().includes(q) ||
          (r.projectName ?? '').toLowerCase().includes(q) ||
          r.toolNames.some((t) => t.toLowerCase().includes(q)) ||
          r.skillNames.some((s) => s.toLowerCase().includes(q)),
        )
      : ratings
    return [...list].sort((a, b) => (sortMode === 'rating' ? b.rating - a.rating : b.updatedAt - a.updatedAt))
  }, [ratings, deferredQuery, sortMode])

  const hasStats =
    stats.averageByAgent.length > 0 || stats.averageByModel.length > 0 || stats.averageBySkill.length > 0 ||
    stats.averageByServer.length > 0 || stats.averageByProject.length > 0 || stats.trend.length > 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex h-9 shrink-0 items-center justify-between border-b-2 border-nexy-border bg-nexy-surface px-4">
        <span className="nexy-font-status text-nexy-muted">
          {ratings.length} rated conversation{ratings.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <PaneSkeleton rows={3} rowHeight="h-12" />
        ) : (
          <>
            {hasStats && (
              <div className="space-y-3 border-b-2 border-nexy-border bg-nexy-raised px-3 py-2">
                <RatingTrendChart data={stats.trend} />
                <RatingBarChart title="Average by Agent" data={stats.averageByAgent} />
                <RatingBarChart title="Average by Model" data={stats.averageByModel} />
                <RatingBarChart title="Average by Skill" data={stats.averageBySkill} />
                <RatingBarChart title="Average by MCP Server" data={stats.averageByServer} />
                <RatingBarChart title="Average by Project" data={stats.averageByProject} />
              </div>
            )}

            <div className="flex items-center gap-2 border-b-2 border-nexy-border bg-nexy-surface px-3 py-2">
              <div className="relative flex-1">
                <NexyIcon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-nexy-muted" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search ratings…"
                  className="w-full rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed py-1.5 pl-8 pr-7 text-xs text-nexy-text outline-none placeholder:text-nexy-muted focus:border-nexy-accent focus:bg-nexy-raised"
                />
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-nexy-muted hover:text-nexy-text"
                    aria-label="Clear search"
                  >
                    <NexyIcon name="close" className="h-3 w-3" />
                  </button>
                )}
              </div>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised px-2 py-1.5 text-[11px] text-nexy-text focus:outline-none focus:ring-2 focus:ring-nexy-accent"
                aria-label="Sort ratings"
              >
                <option value="recent">Recent</option>
                <option value="rating">Rating</option>
              </select>
            </div>

            <div className="p-2 space-y-0.5">
              {filtered.length === 0 ? (
                <PaneEmptyState>
                  {deferredQuery ? `No ratings match "${deferredQuery}"` : 'No conversations rated yet'}
                </PaneEmptyState>
              ) : (
                filtered.map((item) => (
                  <RatingListItem key={item.id} item={item} onClick={selectConversation} />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
