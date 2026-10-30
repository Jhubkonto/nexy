import type { ConversationCompletionFilter } from '../../../shared/types'

const FILTERS: Array<{ value: ConversationCompletionFilter; label: string }> = [
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
]

/** Small, accessible status switch used by every full conversation history. */
export function CompletionFilterTabs({
  value,
  onChange,
}: {
  value: ConversationCompletionFilter
  onChange: (value: ConversationCompletionFilter) => void
}) {
  return (
    <div className="flex shrink-0 rounded-nexy-sm border border-nexy-border overflow-hidden" role="tablist" aria-label="Chat status">
      {FILTERS.map((filter) => (
        <button
          key={filter.value}
          type="button"
          role="tab"
          aria-selected={value === filter.value}
          onClick={() => onChange(filter.value)}
          className={`px-1.5 py-1 text-[10px] font-semibold transition-colors ${
            value === filter.value
              ? 'bg-nexy-accent text-white'
              : 'bg-nexy-surface text-nexy-muted hover:bg-nexy-recessed hover:text-nexy-text'
          }`}
        >
          {filter.label}
        </button>
      ))}
    </div>
  )
}
