#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const errors = []
const forbidden = /(?:^|[\\/])(?:google-services\.json|\.env(?:\..*)?|auth\.json|.*(?:credentials|service-account).*\.json|.*\.(?:pem|p12|pfx|jks|keystore|key|db|db-shm|db-wal|sqlite|sqlite3)|(?:sessions?|logs?|cache|caches|user-data|browser-data|screenshots?|sandboxes)(?:[\\/]|$))/i

function checkFile(relativePath, label) {
  if (forbidden.test(relativePath.replaceAll('\\', '/'))) errors.push(`${label}: forbidden path ${relativePath}`)
}

function filesUnder(relativePath) {
  try {
    return execFileSync('rg', ['--files', relativePath], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
  } catch (error) {
    if (error?.status === 1) return []
    throw error
  }
}

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\u0000').filter(Boolean)
for (const file of tracked) checkFile(file, 'tracked source')

const builderConfig = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
if (!builderConfig.includes('  - dist/**/*')) errors.push('electron-builder.yml: dist allowlist is missing')
if (!builderConfig.includes('  - package.json')) errors.push('electron-builder.yml: package.json allowlist is missing')
for (const managedRuntime of ['node_modules/@playwright/mcp/**/*', 'node_modules/playwright/**/*', 'node_modules/playwright-core/**/*']) {
  if (!builderConfig.includes(managedRuntime)) errors.push(`electron-builder.yml: managed Playwright runtime is not unpacked (${managedRuntime})`)
}
if (/node_modules[\\/]playwright[^\n]*browsers/i.test(builderConfig)) {
  errors.push('electron-builder.yml: Chromium must not be included in the installer')
}
if (builderConfig.includes('android/') || builderConfig.includes('release/') || builderConfig.includes('tmp-nexy-visual')) {
  errors.push('electron-builder.yml: broad/local data path is included')
}

for (const input of ['dist', 'release']) {
  const absolutePath = path.join(root, input)
  if (!existsSync(absolutePath)) continue
  const files = filesUnder(input)
  for (const file of files) checkFile(file, 'package artifact')
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'))
  process.exit(1)
}

console.log('Package boundary passed: desktop packaging is allowlisted and no forbidden package inputs were found.')
