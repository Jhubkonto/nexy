import { Loader2 } from 'lucide-react'

export function BackgroundTaskIndicator() {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800 dark:bg-blue-900/60 dark:text-blue-200" role="status">
      <Loader2 aria-hidden="true" className="h-3 w-3 motion-safe:animate-spin" />
      Background task running
    </span>
  )
}
