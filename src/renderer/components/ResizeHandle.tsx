import { useCallback, useState } from 'react'

/** Matches the scrollbar width defined in global.css `::-webkit-scrollbar { width: 6px }` */
const SCROLLBAR_WIDTH = 6

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical'
  /** Ref to the panel element being resized. Used for absolute-position sizing. */
  containerRef: React.RefObject<HTMLElement | null>
  /** Called once on pointerup with the final panel size in pixels. */
  onSetSize: (size: number) => void
  onResizeStart?: () => void
  /** Which edge the handle sits on. Horizontal: 'start'=left, 'end'=right. Vertical: 'start'=top, 'end'=bottom. Default: 'end'. */
  align?: 'start' | 'end'
  /** Optional clamp bounds applied during drag (same values passed to onSetSize on release). May be a function to evaluate fresh on each move (useful for viewport-relative limits). */
  minSize?: number
  maxSize?: number | (() => number)
}

export function ResizeHandle({ direction, containerRef, onSetSize, onResizeStart, align = 'end', minSize = 0, maxSize }: ResizeHandleProps) {
  const isHorizontal = direction === 'horizontal'
  const [isOverScrollbar, setIsOverScrollbar] = useState(false)

  /**
   * Detect whether the pointer is hovering over the vertical scrollbar of any
   * scrollable descendant inside the panel. If so, show a default cursor so
   * the user isn't confused by a col-resize arrow sitting on top of a scrollbar.
   */
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isHorizontal) return
      const panel = containerRef.current
      if (!panel) return

      let inZone = false
      for (const el of panel.querySelectorAll<HTMLElement>('*')) {
        if (el.scrollHeight <= el.clientHeight) continue // no vertical overflow
        const rect = el.getBoundingClientRect()
        if (e.clientX >= rect.right - SCROLLBAR_WIDTH && e.clientX <= rect.right) {
          inZone = true
          break
        }
      }
      setIsOverScrollbar(inZone)
    },
    [isHorizontal, containerRef],
  )

  const handlePointerLeave = useCallback(() => setIsOverScrollbar(false), [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      onResizeStart?.()

      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      // Snapshot the fixed edge of the panel (the edge that stays put during resize).
      // For a left-side panel (align=end): fixed edge = left edge
      // For a right-side panel (align=start): fixed edge = right edge
      // For a top panel (align=end): fixed edge = top edge
      // For a bottom panel (align=start): fixed edge = bottom edge
      const anchorEdge = isHorizontal
        ? (align === 'start' ? rect.right : rect.left)
        : (align === 'start' ? rect.bottom : rect.top)

      document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'

      let lastSize = isHorizontal ? (containerRef.current?.offsetWidth ?? 0) : (containerRef.current?.offsetHeight ?? 0)

      const onMove = (ev: PointerEvent) => {
        const currentPos = isHorizontal ? ev.clientX : ev.clientY
        // Compute absolute new size from cursor to fixed anchor edge.
        const newSize = align === 'start'
          ? anchorEdge - currentPos   // right/bottom panel: grows as cursor moves toward start
          : currentPos - anchorEdge   // left/top panel: grows as cursor moves toward end
        const resolvedMax = maxSize === undefined ? Infinity : (typeof maxSize === 'function' ? maxSize() : maxSize)
        lastSize = Math.min(resolvedMax, Math.max(minSize, newSize))

        // Bypass React — update the DOM directly for zero-latency visual feedback
        if (containerRef.current) {
          containerRef.current.style[isHorizontal ? 'width' : 'height'] = `${lastSize}px`
        }
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        // Commit final size to React state once
        onSetSize(lastSize)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [isHorizontal, align, containerRef, onSetSize, onResizeStart, minSize, maxSize]
  )

  const hCursor = isOverScrollbar ? 'cursor-default' : 'cursor-col-resize'

  return (
    <div
      data-testid="resize-handle"
      className={`absolute z-10 transition-colors ${
        isHorizontal
          ? `${align === 'start' ? 'left-0' : 'right-0'} top-0 bottom-0 w-1 ${hCursor} hover:bg-nexy-accent active:bg-nexy-accent`
          : `${align === 'start' ? 'top-0' : 'bottom-0'} left-0 right-0 h-1 cursor-row-resize hover:bg-nexy-accent active:bg-nexy-accent`
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      aria-hidden="true"
    />
  )
}
