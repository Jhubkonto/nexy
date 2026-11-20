import { describe, expect, it } from 'vitest'
import { getViewportTooltipPosition } from '../components/ui/ViewportTooltip'

const rect = (values: Partial<DOMRect>): DOMRect => ({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: 0,
  height: 0,
  x: 0,
  y: 0,
  toJSON: () => ({}),
  ...values,
}) as DOMRect

describe('getViewportTooltipPosition', () => {
  it('centers right-side tooltips vertically beside the button', () => {
    expect(getViewportTooltipPosition(
      rect({ top: 40, right: 50, left: 10, width: 40, height: 30 }),
      rect({ width: 100, height: 20 }), 320, 200, 8, 8, 'right',
    )).toEqual({ top: 45, left: 58 })
  })

  it('flips left and clamps right-side tooltips at viewport edges', () => {
    expect(getViewportTooltipPosition(
      rect({ top: 190, right: 310, left: 280, width: 30, height: 30 }),
      rect({ width: 100, height: 30 }), 320, 200, 8, 8, 'right',
    )).toEqual({ top: 162, left: 172 })
  })

  it('flips below an anchor when there is not enough room above', () => {
    expect(getViewportTooltipPosition(
      rect({ top: 4, bottom: 16, left: 40, width: 12 }),
      rect({ width: 120, height: 20 }),
      320,
      200,
    )).toEqual({ top: 24, left: 8 })
  })

  it('keeps a tooltip inside the horizontal viewport near the right edge', () => {
    expect(getViewportTooltipPosition(
      rect({ top: 100, bottom: 112, left: 300, width: 12 }),
      rect({ width: 120, height: 20 }),
      320,
      200,
    )).toEqual({ top: 72, left: 192 })
  })
})
