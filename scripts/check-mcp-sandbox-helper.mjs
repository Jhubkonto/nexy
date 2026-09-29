#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
const platform = process.argv[2] || (process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux')
const arch = process.argv[3] || (process.arch === 'arm64' ? 'arm64' : 'x64')
const file = platform === 'win' ? 'mcp-sandbox.exe' : 'mcp-sandbox'
const target = path.join(root, 'mcp-sandbox', 'bin', `${platform}-${arch}`, file)
const digestFile = `${target}.sha256`

if (!existsSync(target) || !statSync(target).isFile()) {
  console.error(`Missing MCP sandbox helper for ${platform}/${arch}: ${target}`)
  console.error('Build the bundled helper before packaging; no unsandboxed fallback is permitted.')
  process.exit(1)
}
if (!existsSync(digestFile)) {
  console.error(`Missing MCP sandbox integrity record: ${digestFile}`)
  process.exit(1)
}
if (platform === 'linux' && (statSync(target).mode & 0o111) === 0) {
  console.error(`MCP sandbox helper is not executable: ${target}`)
  process.exit(1)
}

const version = spawnSync(target, ['--version'], { encoding: 'utf8', timeout: 2000, windowsHide: true })
if (version.status !== 0 || !/^mcp-sandbox\s+\d+\.\d+\.\d+/i.test(version.stdout ?? '')) {
  console.error(`MCP sandbox helper failed its version check: ${target}`)
  process.exit(1)
}
const expectedDigest = readFileSync(digestFile, 'utf8').trim().split(/\s+/)[0].toLowerCase()
const actualDigest = createHash('sha256').update(readFileSync(target)).digest('hex')
const digestValid = /^[a-f0-9]{64}$/.test(expectedDigest) && actualDigest === expectedDigest
const signatureValid = platform === 'mac'
  ? spawnSync('codesign', ['--verify', '--deep', '--strict', target], { stdio: 'ignore' }).status === 0
  : platform === 'win'
    ? (() => {
      const escaped = target.replaceAll("'", "''")
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${escaped}').Status -eq 'Valid'`], { encoding: 'utf8', windowsHide: true })
      return result.status === 0 && /^true\s*$/i.test(result.stdout ?? '')
    })()
    : false
if (!digestValid && !signatureValid) {
  console.error(`MCP sandbox helper failed its integrity check: ${target}`)
  process.exit(1)
}
if (process.env.NEXY_MCP_SANDBOX_REQUIRE_SIGNATURE === '1' && !signatureValid) {
  console.error(`MCP sandbox helper is not signed for the required release policy: ${target}`)
  process.exit(1)
}

console.log(`MCP sandbox helper ready: ${platform}/${arch} (integrity verified)`)
