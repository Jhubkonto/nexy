export const SIDEBAR_COMPACT_WIDTH = 56
export const SIDEBAR_DEFAULT_WIDTH = 256
export const SIDEBAR_MIN_WIDTH = 160
export const SIDEBAR_MAX_WIDTH = 480

export function restoreSidebarWidth(value: unknown): number {
  const width = typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(width) && width >= SIDEBAR_MIN_WIDTH && width <= SIDEBAR_MAX_WIDTH
    ? width : SIDEBAR_DEFAULT_WIDTH
}

export function sidebarMaxWidth(viewportWidth: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.floor(viewportWidth * 0.32)))
}
