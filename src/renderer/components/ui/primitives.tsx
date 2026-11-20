import {
  forwardRef,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(ref: RefObject<HTMLElement | null>, enabled = true) {
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  useEffect(() => {
    const container = ref.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusable = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((element) => !element.matches(':disabled') && !element.closest('fieldset[disabled]'))
    focusable()[0]?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (!enabledRef.current || event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [ref])
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

interface ModalShellProps {
  title: string
  description?: string
  icon?: ReactNode
  ariaLabel?: string
  maxWidth?: string
  height?: string
  bodyClassName?: string
  panelClassName?: string
  footerClassName?: string
  /** Uses an unobtrusive floating close button instead of the standard title bar. */
  compactHeader?: boolean
  headerActions?: ReactNode
  /** Suspend interaction while a child dialog owns focus. */
  suspended?: boolean
  /** Block dismissal while a write is pending. */
  busy?: boolean
  closeOnEscape?: boolean
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
}

export function ModalShell({
  title,
  description,
  icon,
  ariaLabel,
  maxWidth = 'max-w-5xl',
  height = 'h-[84vh]',
  bodyClassName = 'flex-1 min-h-0 overflow-y-auto p-5',
  panelClassName,
  footerClassName,
  compactHeader = false,
  headerActions,
  suspended = false,
  busy = false,
  closeOnEscape = false,
  children,
  footer,
  onClose,
}: ModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef, !suspended)

  useEffect(() => {
    if (!closeOnEscape || suspended || busy) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [closeOnEscape, suspended, busy, onClose])

  // Portal to document.body so `fixed inset-0` always escapes the viewport regardless of
  // whether an ancestor (e.g. a message-enter animation with a lingering transform from
  // animation-fill-mode: both) has created a CSS containing block that would otherwise
  // scope this "fixed" backdrop to that ancestor's bounds instead of the window.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      data-testid="modal-backdrop"
      onClick={busy || suspended ? undefined : onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-hidden={suspended || undefined}
        inert={suspended || undefined}
        aria-label={ariaLabel ?? title}
        className={cx(
          'relative flex w-full flex-col overflow-hidden rounded-nexy-lg border-2 border-nexy-border bg-nexy-raised shadow-nexy',
          maxWidth,
          height,
          panelClassName,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {compactHeader ? (
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="absolute right-3 top-3 z-10 rounded-nexy-sm border border-transparent p-2 text-nexy-muted hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nexy-accent"
            aria-label={`Close ${ariaLabel ?? title}`}
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <div className="flex shrink-0 items-center justify-between gap-4 border-b-2 border-nexy-border bg-nexy-surface px-5 py-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-nexy-text">
                {icon}
                {title}
              </h2>
              {description && <p className="mt-0.5 text-xs text-nexy-muted">{description}</p>}
            </div>
            <div className="flex items-center gap-2">
              {headerActions}
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-nexy-sm border border-transparent p-1 text-nexy-muted hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nexy-accent"
                aria-label={`Close ${ariaLabel ?? title}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        <div className={bodyClassName}>{children}</div>
        {footer && (
          <div className={cx(
            'flex shrink-0 flex-wrap justify-end gap-2 border-t-2 border-nexy-border bg-nexy-surface px-5 py-3',
            footerClassName,
          )}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSolid'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', className, children, ...props },
  ref,
) {
  const variantClass = {
    primary: 'border-2 border-nexy-border bg-nexy-accent text-nexy-on-accent hover:brightness-110 active:translate-x-px active:translate-y-px',
    secondary: 'border-2 border-nexy-border bg-nexy-raised text-nexy-text hover:bg-nexy-recessed active:translate-x-px active:translate-y-px',
    ghost: 'border-2 border-transparent text-nexy-muted hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text',
    danger: 'border-2 border-transparent text-nexy-error hover:border-nexy-error hover:bg-red-50 dark:hover:bg-red-950/40',
    dangerSolid: 'border-2 border-red-900 bg-nexy-error text-white hover:brightness-110 active:translate-x-px active:translate-y-px',
  }[variant]

  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-nexy-sm px-3 py-1.5 text-xs font-bold shadow-[2px_2px_0_rgb(var(--nexy-shadow))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nexy-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none',
        variantClass,
        className,
      )}
      ref={ref}
      {...props}
    >
      {children}
    </button>
  )
})

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-nexy-md border-2 border-nexy-border bg-nexy-raised px-3 py-2 shadow-[2px_2px_0_rgb(var(--nexy-shadow))]">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-100">{value}</p>
    </div>
  )
}

export function InfoRow({
  label,
  detail,
  value,
  children,
}: {
  label: string
  detail?: string
  value?: string
  children?: ReactNode
}) {
  return (
    <div className="rounded-nexy-md border-2 border-nexy-border bg-nexy-raised p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{label}</p>
          {detail && <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 break-words">{detail}</p>}
        </div>
        {value && <span className="shrink-0 text-[11px] tabular-nums text-gray-400">{value}</span>}
      </div>
      {children}
    </div>
  )
}

interface FieldFrameProps {
  label?: string
  help?: string
  error?: string
  children: ReactNode
}

function FieldFrame({ label, help, error, children }: FieldFrameProps) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</span>}
      {children}
      {help && !error && <span className="mt-1 block text-[11px] text-gray-400">{help}</span>}
      {error && <span className="mt-1 block text-[11px] text-red-500">{error}</span>}
    </label>
  )
}

const fieldClass =
  'w-full rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed px-3 py-2 text-sm text-nexy-text placeholder:text-nexy-muted focus:bg-nexy-raised focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-nexy-accent disabled:cursor-not-allowed disabled:opacity-60'

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  help?: string
  error?: string
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, help, error, className, ...props },
  ref,
) {
  return (
    <FieldFrame label={label} help={help} error={error}>
      <input ref={ref} className={cx(fieldClass, className)} {...props} />
    </FieldFrame>
  )
})

interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  help?: string
  error?: string
}

export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(function TextareaField(
  { label, help, error, className, ...props },
  ref,
) {
  return (
    <FieldFrame label={label} help={help} error={error}>
      <textarea ref={ref} className={cx(fieldClass, 'resize-y leading-6', className)} {...props} />
    </FieldFrame>
  )
})

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  help?: string
  error?: string
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, help, error, className, children, ...props },
  ref,
) {
  return (
    <FieldFrame label={label} help={help} error={error}>
      <select ref={ref} className={cx(fieldClass, className)} {...props}>
        {children}
      </select>
    </FieldFrame>
  )
})

interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
  ariaLabel?: string
}

export function ToggleSwitch({ checked, onChange, disabled, size = 'md', ariaLabel }: ToggleSwitchProps) {
  const track = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11'
  const thumb = size === 'sm' ? 'translate-x-4' : 'translate-x-6'
  const thumbOff = size === 'sm' ? 'translate-x-0.5' : 'translate-x-1'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex shrink-0 items-center rounded-nexy-sm border-2 border-nexy-border disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nexy-accent',
        track,
        checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600',
      )}
    >
      <span
        className={cx(
          'inline-block h-4 w-4 transform rounded-nexy-sm border border-nexy-border bg-nexy-raised',
          checked ? thumb : thumbOff,
        )}
      />
    </button>
  )
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function SaveStatus({ state }: { state: SaveState }) {
  if (state === 'idle') return null
  const label = { saving: 'Saving…', saved: 'Saved', error: 'Failed to save' }[state]
  const colorClass = {
    saving: 'text-gray-400',
    saved: 'text-green-600 dark:text-green-400',
    error: 'text-red-500',
  }[state]
  return <span className={cx('text-[11px]', colorClass)}>{label}</span>
}

export function SegmentedTabs<T extends string>({
  value,
  items,
  onChange,
}: {
  value: T
  items: Array<{ id: T; label: React.ReactNode; badge?: number }>
  onChange: (value: T) => void
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b-2 border-nexy-border p-2">
      {items.map((item) => (
        <button
          key={item.id}
          id={`tab-${item.id}`}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          onClick={() => onChange(item.id)}
          className={cx(
            'inline-flex flex-1 items-center justify-center gap-1 rounded-nexy-sm border-2 px-2 py-1.5 text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nexy-accent',
            value === item.id
              ? 'border-nexy-border bg-nexy-accent text-nexy-on-accent'
              : 'border-transparent text-nexy-muted hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text',
          )}
        >
          {item.label}
          {item.badge ? (
            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-nexy-sm border border-red-900 bg-nexy-error px-1 text-[9px] font-bold text-white">
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}
