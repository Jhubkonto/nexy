import { useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2, Square } from 'lucide-react'
import type { TeamActivityStep } from '../hooks/chat-types'

interface TeamActivityBlockProps {
  steps: TeamActivityStep[]
  isLive?: boolean
}

export function TeamActivityBlock({ steps, isLive = false }: TeamActivityBlockProps) {
  const [expanded, setExpanded] = useState(isLive)
  const [collapsedSteps, setCollapsedSteps] = useState<Set<string>>(new Set())
  const [cancellingSteps, setCancellingSteps] = useState<Set<string>>(new Set())

  const toggleStep = (stepId: string) => {
    setCollapsedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }

  const doneCount = steps.filter((s) => s.status === 'done').length
  const hasError = steps.some((s) => s.status === 'error')
  const allDone = steps.length > 0 && steps.every((s) => s.status !== 'delegating')

  const cancelStep = async (stepId: string) => {
    setCancellingSteps((current) => new Set(current).add(stepId))
    try {
      const result = await window.api.cancelDelegationNode(stepId)
      if (result !== 'accepted') setCancellingSteps((current) => {
        const next = new Set(current)
        next.delete(stepId)
        return next
      })
    } catch {
      setCancellingSteps((current) => {
        const next = new Set(current)
        next.delete(stepId)
        return next
      })
    }
  }

  return (
    <div className="my-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 overflow-hidden text-sm">
      {/* Header */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded
          ? <ChevronDown size={14} className="shrink-0 text-gray-400" />
          : <ChevronRight size={14} className="shrink-0 text-gray-400" />
        }
        <span className="text-base leading-none">🤝</span>
        <span className="font-medium text-gray-700 dark:text-gray-200">Team Activity</span>
        <span className="ml-auto flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
          {!allDone && isLive
            ? <><Loader2 size={12} className="animate-spin" /> Working…</>
            : hasError
              ? <><XCircle size={12} className="text-red-500" /> {doneCount}/{steps.length} done</>
              : <><CheckCircle size={12} className="text-green-500" /> {doneCount} step{doneCount !== 1 ? 's' : ''}</>
          }
        </span>
      </button>

      {/* Steps */}
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
          {steps.map((step) => {
            const isActive = step.status === 'delegating'
            const cancelling = cancellingSteps.has(step.stepId)
            const isCollapsed = collapsedSteps.has(step.stepId)
            const hasBody = !!(step.result ?? step.liveContent)
            const showBody = (isActive || hasBody) && !isCollapsed

            return (
              <div key={step.stepId}>
                {/* Step header */}
                <button
                  className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700/40 transition-colors"
                  onClick={() => toggleStep(step.stepId)}
                >
                  {/* Status icon — fixed width, vertically centred with first line */}
                  <span className="mt-0.5 shrink-0 w-4 flex justify-center">
                    {step.status === 'delegating' && <Loader2 size={13} className="animate-spin text-blue-500" />}
                    {step.status === 'done'       && <CheckCircle size={13} className="text-green-500" />}
                    {step.status === 'error'      && <XCircle size={13} className="text-red-500" />}
                    {step.status === 'cancelled'  && <Square size={12} className="text-gray-400" />}
                  </span>

                  {/* Agent badge */}
                  <span className="mt-0.5 shrink-0 flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap">
                    <span>{step.agentIcon}</span>
                    <span>{step.agentName}</span>
                    <span className="text-gray-400">→</span>
                  </span>

                  {/* Task (wraps) */}
                  <span className="flex-1 text-xs text-gray-600 dark:text-gray-300 leading-snug break-words min-w-0">
                    {step.task}
                  </span>

                  {/* Duration + chevron */}
                  <span className="shrink-0 flex items-center gap-1 text-xs text-gray-400 ml-1 mt-0.5">
                    {step.durationMs !== undefined && (
                      <span>{step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}</span>
                    )}
                    {(isActive || hasBody) && (
                      showBody
                        ? <ChevronDown size={11} />
                        : <ChevronRight size={11} />
                    )}
                  </span>
                </button>

                {isLive && isActive && (
                  <div className="px-3 pb-2 ml-6">
                    <button
                      type="button"
                      disabled={cancelling}
                      onClick={() => void cancelStep(step.stepId)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      {cancelling ? 'Stopping…' : 'Stop this agent'}
                    </button>
                  </div>
                )}

                {/* Step body — streamed / final result */}
                {showBody && (
                  <div className="px-4 pb-3 pt-1 ml-6 text-xs text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-words font-mono bg-white/60 dark:bg-gray-900/30">
                    {step.result ?? step.liveContent}
                    {isActive && <span className="animate-pulse opacity-60">▍</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
