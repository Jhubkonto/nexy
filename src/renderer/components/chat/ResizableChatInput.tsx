import { useLayoutEffect, useState, type ReactNode, type RefObject, type TextareaHTMLAttributes } from 'react'
import { ResizeHandle } from '../ResizeHandle'

interface ResizableChatInputProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'rows'> {
  inputRef: RefObject<HTMLTextAreaElement | null>
  value: string
  leftActions?: ReactNode
  rightActions?: ReactNode
  /**
   * Renders in place of the textarea, for composers backed by a real editor
   * engine. The editor owns its own mount node, DOM, and focus, so this is a
   * plain slot rather than a set of forwarded handlers.
   */
  editor?: ReactNode
  minHeight?: number
  maxHeight?: number
}

/**
 * Shared chat input surface used by the main conversation and focused chat
 * workflows. It owns the visual treatment, auto-growth, and pointer-resizing
 * contract so secondary composers cannot silently drift from the main chat.
 */
export function ResizableChatInput({
  inputRef,
  value,
  leftActions,
  rightActions,
  editor,
  minHeight = 40,
  maxHeight = 400,
  onDragOver,
  ...textareaProps
}: ResizableChatInputProps) {
  const [manualHeight, setManualHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (editor) return
    const element = inputRef.current
    if (!element) return

    element.style.height = 'auto'
    const floor = manualHeight ?? minHeight
    element.style.height = `${Math.min(Math.max(floor, element.scrollHeight), maxHeight)}px`
  }, [inputRef, value, manualHeight, minHeight, maxHeight, editor])

  return (
    <div className="relative rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed shadow-nexy transition-colors focus-within:bg-nexy-raised focus-within:outline focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-nexy-accent">
      {editor ?? (
        <>
          <ResizeHandle
            direction="vertical"
            align="start"
            containerRef={inputRef}
            onSetSize={setManualHeight}
            minSize={minHeight}
            maxSize={maxHeight}
          />
          <textarea
            {...textareaProps}
            ref={inputRef}
            value={value}
            rows={1}
            onDragOver={(event) => {
              event.preventDefault()
              onDragOver?.(event)
            }}
            className="chat-input w-full resize-none overflow-y-auto bg-transparent px-4 pb-2 pt-3 text-sm text-nexy-text placeholder:text-nexy-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </>
      )}
      <div className="flex items-center justify-between px-2 pb-2">
        <div className="flex items-center gap-0.5">{leftActions}</div>
        <div className="flex items-center gap-1">{rightActions}</div>
      </div>
    </div>
  )
}
