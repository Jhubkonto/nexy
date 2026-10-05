export const ARTIFACT_KIND_LABELS: Record<string, string> = {
  document: 'Doc', code: 'Code', ui: 'UI', data: 'Data',
  prompt: 'Prompt', 'agent-config': 'Agent', plan: 'Plan', bundle: 'Bundle', other: 'Other',
  debrief: 'Debrief', quiz: 'Quiz', teachback: 'Teach-back', 'test-report': 'Test report',
}

export function artifactKindLabel(kind: string): string {
  return ARTIFACT_KIND_LABELS[kind] ?? (kind.charAt(0).toUpperCase() + kind.slice(1))
}

/**
 * Debrief/quiz titles (and their per-version titles) are generated as "Debrief: <chat name>" —
 * the kind is already shown via the kind badge next to the title, so strip that prefix and
 * show just the source chat's name. Other artifact kinds keep their user-given title as-is.
 */
export function artifactDisplayTitle(title: string, kind: string): string {
  const prefix = `${artifactKindLabel(kind)}: `
  return title.startsWith(prefix) ? title.slice(prefix.length) : title
}

/** Fixed-width kind pill so badges line up across rows regardless of label length. */
export function ArtifactKindBadge({ kind }: { kind: string }) {
  const label = artifactKindLabel(kind)
  return (
    <span
      title={label}
      className="inline-block w-16 shrink-0 truncate text-center text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium"
    >
      {label}
    </span>
  )
}
