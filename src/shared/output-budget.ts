export type OutputTokenSetting = 'auto' | number

/** Saved numbers remain manual limits; missing or corrupt settings use Automatic. */
export function parseOutputTokenSetting(value: unknown): OutputTokenSetting {
  if (value === undefined || value === null || value === 'auto' || value === '') return 'auto'
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(number) && number > 0 ? number : 'auto'
}
