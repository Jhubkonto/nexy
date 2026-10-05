import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, readdirSync } from 'fs'

// Rollup plugin that copies Nexy's static .cjs worker scripts (the in-process MCP bridges
// and the desktop-navigator bridge) to dist/main/, where the bundled main process resolves
// them via `join(__dirname, '<name>.cjs')`.
//
// This discovers them by convention instead of listing them: a hand-maintained list silently
// drops any newly added worker from the packaged build, and the only symptom is the MCP
// server failing to connect at runtime (the script simply isn't there). Discovery keeps the
// build and the source tree in sync automatically.
function copyWorkers(): import('vite').Plugin {
  return {
    name: 'copy-cjs-workers',
    closeBundle() {
      const srcDir = resolve(__dirname, 'src/main')
      const outDir = resolve(__dirname, 'dist/main')
      mkdirSync(outDir, { recursive: true })
      const workers = readdirSync(srcDir).filter((file) => file.endsWith('-worker.cjs'))
      if (workers.length === 0) throw new Error('copy-cjs-workers: no *-worker.cjs scripts found in src/main')
      for (const worker of workers) {
        copyFileSync(resolve(srcDir, worker), resolve(outDir, worker))
      }
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyWorkers()],
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts')
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          overlay: resolve(__dirname, 'src/preload/overlay.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        }
      }
    }
  },
  renderer: {
    server: {
      host: '127.0.0.1',
      port: 5100,
    },
    plugins: [react()],
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      // AudioWorklet modules must remain self-hosted files under the production CSP.
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
        },
        output: {
          entryFileNames: '[name].js',
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  }
})
