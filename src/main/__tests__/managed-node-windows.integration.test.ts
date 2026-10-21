import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'

// Opt in with a verified, already installed Nexy Node distribution. Unlike the
// unit tests, these tests execute npm and the real Windows AppContainer helper.
const runtime = process.env.NEXY_TEST_MANAGED_NODE_RUNTIME
let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

import { createManagedNodeNpxLaunch } from '../managed-node'
import { createSandboxedMcpTransport, shutdownMcpSandboxBroker } from '../mcp-sandbox'

describe.skipIf(process.platform !== 'win32' || !runtime)('managed npm in the Windows AppContainer', () => {
  let packageArchive: string
  let blockedFile: string

  beforeAll(async () => {
    userData = mkdtempSync(join(tmpdir(), 'nexy-native-npx-'))
    blockedFile = join(userData, 'unshared', 'private.txt')
    const root = join(userData, 'managed-mcp-node', `node-v24.22.0-win-${process.arch}`)
    cpSync(runtime!, root, { recursive: true })
    const fixture = join(userData, 'fixture')
    mkdirSync(join(fixture, 'package'), { recursive: true })
    mkdirSync(join(userData, 'unshared'), { recursive: true })
    writeFileSync(blockedFile, 'must remain private')
    writeFileSync(join(fixture, 'package', 'package.json'), JSON.stringify({
      name: 'nexy-mcp-smoke', version: '1.0.0', bin: { 'nexy-mcp-smoke': 'server.js' },
    }))
    writeFileSync(join(fixture, 'package', 'server.js'), `#!/usr/bin/env node
const fs = require('node:fs')
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line)
  if (message.id == null) return
  let result = {}
  if (message.method === 'initialize') result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'native-npm-smoke', version: '1.0.0' } }
  if (message.method === 'tools/list') result = { tools: [{ name: 'probe', description: 'Check sandbox isolation', inputSchema: { type: 'object' } }] }
  if (message.method === 'tools/call') {
    let denied = false
    let runtimeWriteDenied = false
    try { fs.readFileSync(${JSON.stringify(blockedFile)}) } catch (e) { denied = ['EPERM', 'EACCES'].includes(e.code) }
    try { fs.writeFileSync(${JSON.stringify(join(root, 'must-not-write.txt'))}, 'forbidden') } catch (e) { runtimeWriteDenied = ['EPERM', 'EACCES'].includes(e.code) }
    result = { content: [{ type: 'text', text: JSON.stringify({ denied, runtimeWriteDenied, cwd: process.cwd(), header: process.argv.slice(2) }) }] }
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
})
`)
    const npmRequire = createRequire(join(root, 'node_modules', 'npm', 'package.json'))
    const tar = npmRequire('tar') as { c: (options: object, files: string[]) => Promise<void> }
    packageArchive = join(fixture, 'server.tgz')
    await tar.c({ cwd: fixture, file: packageArchive, gzip: true }, ['package'])
  }, 60_000)

  afterAll(async () => {
    await shutdownMcpSandboxBroker()
    rmSync(userData, { recursive: true, force: true })
  })

  for (const customCwd of [false, true]) {
    it(`installs, starts, lists and calls tools while denying unshared files (${customCwd ? 'explicit' : 'default'} cwd)`, async () => {
      const cwd = customCwd ? join(userData, 'project') : undefined
      if (cwd) mkdirSync(cwd)
      const launch = createManagedNodeNpxLaunch({
        name: 'Native npm smoke',
        args: ['-y', '--package', packageArchive, 'nexy-mcp-smoke', '--header', 'X-Test-Key: test value'],
        env: {}, cwd,
        sandboxProfile: {
          version: 1, network: 'blocked', childProcesses: 'allowed',
          filesystem: [{ path: join(userData, 'fixture'), access: 'read-only' }],
          memoryLimitMiB: 512, maxProcesses: 8, startupTimeoutMs: 15000,
          gracefulShutdownTimeoutMs: 2000, hardTerminationTimeoutMs: 5000, maxDiagnosticBytes: 65536,
        },
      })
      const handle = createSandboxedMcpTransport({ ...launch.request, cleanup: launch.cleanup })
      const client = new Client({ name: 'nexy-native-test', version: '1.0.0' })
      try {
        await client.connect(handle.transport, { timeout: 25000 })
        expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['probe'])
        const response = await client.callTool({ name: 'probe', arguments: {} })
        const content = response.content as { type: string; text: string }[]
        expect(JSON.parse(content[0].text)).toEqual({
          denied: true, runtimeWriteDenied: true, cwd: launch.request.cwd,
          header: ['--header', 'X-Test-Key: test value'],
        })
      } catch (error) {
        await handle.stderrSettled(2000)
        throw new Error(`${String(error)}\n${handle.stderrTail()}`)
      } finally {
        await client.close()
        await handle.close()
      }
      expect(existsSync(launch.request.env.NPM_CONFIG_USERCONFIG)).toBe(false)
    }, 40_000)
  }
})
