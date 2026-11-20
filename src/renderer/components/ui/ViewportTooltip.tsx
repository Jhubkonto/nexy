import { cloneElement, isValidElement, useCallback, useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type RectLike = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>

export type TooltipPosition = {
  top: number
  left: number
}

export function getViewportTooltipPosition(
  anchorRect: RectLike,
  tooltipRect: Pick<DOMRect, 'width' | 'height'>,
  viewportWidth: number,
  viewportHeight: number,
  gap = 8,
  padding = 8,
  placement: 'top' | 'right' = 'top',
): TooltipPosition {
  if (placement === 'right') {
    const rightLeft = anchorRect.right + gap
    const preferredLeft = rightLeft + tooltipRect.width <= viewportWidth - padding
      ? rightLeft : anchorRect.left - tooltipRect.width - gap
    return {
      left: Math.max(padding, Math.min(preferredLeft, viewportWidth - tooltipRect.width - padding)),
      top: Math.max(padding, Math.min(anchorRect.top + (anchorRect.height - tooltipRect.height) / 2, viewportHeight - tooltipRect.height - padding)),
    }
  }
  const centeredLeft = anchorRect.left + (anchorRect.width - tooltipRect.width) / 2
  const maxLeft = Math.max(padding, viewportWidth - tooltipRect.width - padding)
  const left = Math.min(Math.max(centeredLeft, padding), maxLeft)

  const aboveTop = anchorRect.top - tooltipRect.height - gap
  const belowTop = anchorRect.bottom + gap
  const hasRoomAbove = aboveTop >= padding
  const hasRoomBelow = belowTop + tooltipRect.height <= viewportHeight - padding
  const unclampedTop = hasRoomAbove ? aboveTop : hasRoomBelow ? belowTop : aboveTop
  const maxTop = Math.max(padding, viewportHeight - tooltipRect.height - padding)
  const top = Math.min(Math.max(unclampedTop, padding), maxTop)

  return { top, left }
}

type ViewportTooltipProps = {
  label: string
  children: ReactNode
  className?: string
  dotStyle?: React.CSSProperties
  placement?: 'top' | 'right'
  interactiveChild?: boolean
  enabled?: boolean
}

export function ViewportTooltip({ label, children, className = '', dotStyle, placement = 'top', interactiveChild = false, enabled = true }: ViewportTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<TooltipPosition | null>(null)
  const tooltipId = useId()
  const visible = open && enabled

  const show = useCallback(() => {
    setOpen(true)
  }, [])

  const hide = useCallback(() => {
    setOpen(false)
    setPosition(null)
  }, [])

  useLayoutEffect(() => {
    if (!visible) return

    const updatePosition = () => {
      const anchor = anchorRef.current
      const tooltip = tooltipRef.current
      if (!anchor || !tooltip) return

      setPosition(getViewportTooltipPosition(
        anchor.getBoundingClientRect(),
        tooltip.getBoundingClientRect(),
        window.innerWidth,
        window.innerHeight,
        8,
        8,
        placement,
      ))
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        hide()
      }
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [visible, placement, label, hide])

  const mouseLeave = () => {
    if (!anchorRef.current?.contains(document.activeElement)) hide()
  }
  const child = interactiveChild && isValidElement<HTMLAttributes<HTMLElement>>(children)
    ? cloneElement(children, {
      'aria-describedby': [children.props['aria-describedby'], visible && position ? tooltipId : null].filter(Boolean).join(' ') || undefined,
      onMouseEnter: (event) => { children.props.onMouseEnter?.(event); show() },
      onMouseLeave: (event) => { children.props.onMouseLeave?.(event); mouseLeave() },
      onFocus: (event) => { children.props.onFocus?.(event); show() },
      onBlur: (event) => { children.props.onBlur?.(event); hide() },
      onClick: (event) => { children.props.onClick?.(event); hide() },
    }) : children

  return (
    <>
      <span
        ref={anchorRef}
        className={className}
        role={interactiveChild ? undefined : 'img'}
        aria-label={interactiveChild ? undefined : label}
        aria-describedby={!interactiveChild && visible && position ? tooltipId : undefined}
        tabIndex={interactiveChild ? undefined : 0}
        onMouseEnter={interactiveChild ? undefined : show}
        onMouseLeave={interactiveChild ? undefined : mouseLeave}
        onFocus={interactiveChild ? undefined : show}
        onBlur={interactiveChild ? undefined : hide}
        style={dotStyle}
      >
        {child}
      </span>
      {visible && createPortal(
        <span
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none fixed z-[100] max-w-[calc(100vw-1rem)] whitespace-normal break-words rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 opacity-0 shadow-lg transition-opacity dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            visibility: position ? 'visible' : 'hidden',
            opacity: position ? 1 : 0,
          }}
        >
          {label}
        </span>,
        document.body,
      )}
    </>
  )
}
