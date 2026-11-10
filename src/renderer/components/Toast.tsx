import { useEffect } from 'react'
import { Check, X, Info } from 'lucide-react'
import type { Toast } from '../store/types'

interface ToastContainerProps {
  toasts: Toast[]
  onDismiss: (id: string) => void
}

const TOAST_DURATION = 4000

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      role="status"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_DURATION)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  const IconComponent = {
    success: Check,
    error: X,
    info: Info
  }[toast.type]
  const toneClass = {
    success: 'border-green-900 bg-nexy-success',
    error: 'border-red-900 bg-nexy-error',
    info: 'border-cyan-950 bg-nexy-info',
  }[toast.type]

  return (
    <div
      className={`nexy-toast pointer-events-auto flex items-center gap-2 rounded-nexy-sm border-2 px-4 py-2.5 text-sm font-medium text-white shadow-nexy ${toneClass}`}
      role="alert"
    >
      <IconComponent className="w-4 h-4 shrink-0" />
      <span>{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => { toast.action!.onClick(); onDismiss(toast.id) }}
          className="ml-1 border border-transparent font-bold underline hover:border-current hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={() => onDismiss(toast.id)}
        className="ml-2 border border-transparent text-white/70 hover:border-white hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
