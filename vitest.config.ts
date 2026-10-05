import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          include: ['src/main/__tests__/**/*.test.ts'],
          environment: 'node',
          // Windows + full-suite parallelism makes git/subprocess-backed main-process
          // tests far slower than they are in isolation; 5s produced load-only flakes.
          testTimeout: 30000,
          hookTimeout: 30000,
          setupFiles: ['src/test/setup-main.ts']
        },
        resolve: {
          alias: {
            '@shared': resolve(__dirname, 'src/shared'),
            'better-sqlite3': resolve(__dirname, 'src/test/mocks/better-sqlite3-shim.ts')
          }
        }
      },
      {
        test: {
          name: 'renderer',
          include: [
            'src/renderer/__tests__/**/*.test.{ts,tsx}',
            'src/renderer/components/**/__tests__/**/*.test.{ts,tsx}'
          ],
          environment: 'happy-dom',
          testTimeout: 30000,
          hookTimeout: 30000,
          setupFiles: ['src/test/setup-renderer.ts']
        },
        esbuild: {
          jsx: 'automatic'
        },
        resolve: {
          alias: {
            '@shared': resolve(__dirname, 'src/shared')
          }
        }
      }
    ]
  }
})
