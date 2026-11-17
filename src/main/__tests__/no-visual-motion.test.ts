import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.kt') ? [path] : []
  })
}

function executableKotlin(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(import|\/\/)/.test(line))
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

describe('theme-aware visual motion policy', () => {
  it('limits Android visual motion APIs to Classic-compatible shared boundaries', () => {
    const androidRoot = resolve(process.cwd(), 'android/app/src/main/java')
    const forbidden = /\b(?:AnimatedVisibility|AnimatedContent|Crossfade|rememberInfiniteTransition|animate(?:Float|Int|Color|Scroll|Item|To)|infiniteRepeatable|animationSpec\s*=|tween\s*\(|spring\s*\()/
    const classicMotionBoundaries = new Set([
      'ChatScreenComponents.kt',
      'ChatScreenBubbles.kt',
      'ConnectionDot.kt',
      'ContentSyncIndicator.kt',
      'HomeScreenComponents.kt',
      'NexyIcon.kt',
    ])
    const violations = sourceFiles(androidRoot).flatMap((path) => {
      const match = executableKotlin(readFileSync(path, 'utf8')).match(forbidden)
      return match && !classicMotionBoundaries.has(path.split(/[\\/]/).at(-1) ?? '')
        ? [`${path}: ${match[0]}`]
        : []
    })
    expect(violations).toEqual([])

    for (const name of classicMotionBoundaries) {
      const path = sourceFiles(androidRoot).find((candidate) => candidate.endsWith(name))
      expect(path, `${name} should exist`).toBeTruthy()
      expect(readFileSync(path!, 'utf8'), `${name} must gate motion by UI style`)
        .toContain('LocalNexyEightBit.current')
    }
  })

  it('keeps desktop motion disabled globally except for busy/loading indicators, and chat streaming frame-free', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles/global.css'), 'utf8')
    expect(css).toContain('animation: none !important')
    expect(css).toContain('transition: none !important')
    expect(css).toContain('scroll-behavior: auto !important')
    expect(css).not.toMatch(/@keyframes/)

    // Loading spinners/bounce/pulse records are the sole carved-out exception: they signal
    // in-progress work rather than decorative motion, so they must keep animating.
    expect(css).toContain('.animate-spin')
    expect(css).toContain('.animate-bounce')
    expect(css).toContain('.animate-pulse')
    expect(css).toContain("[data-ui-style='8bit'] :is(.animate-pulse, .nexy-retro-loading-pulse)")
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')

    const icon = readFileSync(resolve(process.cwd(), 'src/renderer/components/ui/icons/NexyIcon.tsx'), 'utf8')
    expect(icon).toContain("name === 'busy' && motion !== 'none'")

    const streaming = readFileSync(resolve(process.cwd(), 'src/renderer/hooks/useStreamingQueue.ts'), 'utf8')
    expect(streaming).not.toMatch(/requestAnimationFrame|cancelAnimationFrame/)
  })
})
