import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { WebContents } from 'electron'
import { getDatabase } from './database'
import { requestApproval } from './tools'
import { runBuildProcess, cancelBuildProcess, mapBuildRecord } from './build-runner'
import { callIsolatedRuntimeTool, callRuntimeControlTool, getIsolatedRuntime, getIsolatedRuntimeToolDefinitions } from './isolated-runtime'

const execFileAsync = promisify(execFile)
const MAX_FILE_BYTES = 1_000_000
const MAX_COMMAND_OUTPUT = 2_000_000
const buildProcesses = new Map<string, import('node:child_process').ChildProcess>()

export type DevelopmentToolDefinition = {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  mutating?: boolean
}

const stringProperty = (description: string) => ({ type: 'string', description })
const numberProperty = (description: string) => ({ type: 'number', description })
const schema = (properties: Record<string, unknown>, required: string[] = []): DevelopmentToolDefinition['inputSchema'] =>
  ({ type: 'object', properties, ...(required.length ? { required } : {}) })

const BASE_TOOLS: DevelopmentToolDefinition[] = [
  { name: 'get_development_context', description: 'Return the canonical Nexy source checkout used by this development bridge.', inputSchema: schema({}) },
  { name: 'list_development_files', description: 'List files and directories inside the Nexy source checkout.', inputSchema: schema({ path: stringProperty('Optional checkout-relative directory'), maxDepth: numberProperty('Maximum depth, default 4') }) },
  { name: 'read_development_file', description: 'Read a UTF-8 text file inside the Nexy source checkout.', inputSchema: schema({ path: stringProperty('Checkout-relative file path') }, ['path']) },
  { name: 'search_development_files', description: 'Search text files inside the Nexy source checkout.', inputSchema: schema({ query: stringProperty('Text to search for'), path: stringProperty('Optional checkout-relative directory'), maxResults: numberProperty('Maximum matches, default 50') }, ['query']) },
  { name: 'write_development_file', mutating: true, description: 'Write a UTF-8 file in the Nexy source checkout after desktop approval.', inputSchema: schema({ path: stringProperty('Checkout-relative file path'), content: stringProperty('Complete file content') }, ['path', 'content']) },
  { name: 'run_development_command', mutating: true, description: 'Run an approved shell command with working directory confined to the Nexy checkout.', inputSchema: schema({ command: stringProperty('Command to run'), cwd: stringProperty('Optional checkout-relative working directory'), timeoutMs: numberProperty('Timeout, capped at 120000 ms') }, ['command']) },
  { name: 'git_status', description: 'Return branch, commit, and changed files for the Nexy checkout.', inputSchema: schema({}) },
  { name: 'git_diff', description: 'Return the current Git diff, optionally for one checkout-relative file.', inputSchema: schema({ path: stringProperty('Optional checkout-relative path') }) },
  { name: 'git_log', description: 'List recent commits in the Nexy checkout.', inputSchema: schema({ limit: numberProperty('Maximum commits, default 20') }) },
  { name: 'git_commit', mutating: true, description: 'Commit checkout changes after desktop approval.', inputSchema: schema({ message: stringProperty('Commit message'), files: { type: 'array', items: { type: 'string' } } }, ['message']) },
  { name: 'git_create_branch', mutating: true, description: 'Create and check out a Git branch after desktop approval.', inputSchema: schema({ branch: stringProperty('New branch name'), fromRef: stringProperty('Optional starting ref') }, ['branch']) },
  { name: 'run_preflight', description: 'Run Nexy development preflight checks.', inputSchema: schema({}) },
  { name: 'start_build', mutating: true, description: 'Start a standard Nexy build command after desktop approval.', inputSchema: schema({ command: { type: 'string', enum: ['typecheck', 'test', 'build', 'package'] } }, ['command']) },
  { name: 'get_build_records', description: 'List build history for this source checkout.', inputSchema: schema({ limit: numberProperty('Maximum records, default 20') }) },
  { name: 'cancel_build', mutating: true, description: 'Cancel a running development build after desktop approval.', inputSchema: schema({ buildId: stringProperty('Build id') }, ['buildId']) },
]

function textResult(value: unknown): Record<string, unknown> { return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] } }

function inside(root: string, candidate: string): string {
  const resolved = path.resolve(root, candidate)
  const relative = path.relative(root, resolved)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Path must stay inside the Nexy source checkout')
  // Lexical containment is not enough: an existing symlink (or a parent symlink
  // for a file being created) must not redirect the bridge outside this checkout.
  const realRoot = realpathSync(root)
  let existing = resolved
  while (!existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) throw new Error('Path must stay inside the Nexy source checkout')
    existing = parent
  }
  const realExisting = realpathSync(existing)
  const realRelative = path.relative(realRoot, realExisting)
  if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw new Error('Path must stay inside the Nexy source checkout')
  return resolved
}

function inputPath(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }

async function approve(webContents: WebContents, toolName: string, args: Record<string, unknown>, description: string): Promise<void> {
  if (webContents.isDestroyed()) throw new Error('Nexy window is closed — cannot request approval')
  if (!await requestApproval(webContents, toolName, args, description, { noRemember: true })) throw new Error('User declined the requested operation')
}

async function listFiles(root: string, directory: string, depth: number): Promise<Array<{ path: string; type: 'file' | 'directory'; size?: number }>> {
  const output: Array<{ path: string; type: 'file' | 'directory'; size?: number }> = []
  async function walk(current: string, currentDepth: number): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'release') continue
      const absolute = path.join(current, entry.name)
      const relative = path.relative(root, absolute).replaceAll(path.sep, '/')
      if (entry.isDirectory()) { output.push({ path: relative, type: 'directory' }); if (currentDepth < depth) await walk(absolute, currentDepth + 1) }
      else if (entry.isFile()) output.push({ path: relative, type: 'file', size: (await fs.stat(absolute)).size })
    }
  }
  await walk(directory, 0)
  return output.slice(0, 1000)
}

async function searchFiles(root: string, base: string, query: string, maxResults: number): Promise<Array<{ path: string; line: number; text: string }>> {
  const files = await listFiles(root, base, 12)
  const results: Array<{ path: string; line: number; text: string }> = []
  for (const entry of files) {
    if (entry.type !== 'file' || !entry.size || entry.size > MAX_FILE_BYTES || results.length >= maxResults) continue
    try {
      const lines = (await fs.readFile(inside(root, entry.path), 'utf8')).split(/\r?\n/)
      lines.forEach((line, index) => { if (results.length < maxResults && line.toLowerCase().includes(query.toLowerCase())) results.push({ path: entry.path, line: index + 1, text: line.slice(0, 500) }) })
    } catch { /* binary or unreadable */ }
  }
  return results
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: root, timeout: 30_000, maxBuffer: MAX_COMMAND_OUTPUT })
  return stdout
}

function isRuntimeTool(name: string): boolean { return getIsolatedRuntimeToolDefinitions().some((tool) => tool.name === name) }

export function getDevelopmentMcpToolDefinitions(root?: string): DevelopmentToolDefinition[] {
  const runtime = getIsolatedRuntime()
  return [...BASE_TOOLS, ...getIsolatedRuntimeToolDefinitions()
    .filter((tool) => tool.pack === 'build' || (runtime && !runtime.projectId && (!root || runtime.workspacePath === root) && tool.pack === 'browser'))
    .map(({ name, description, inputSchema, mutating }) => ({ name, description, inputSchema, mutating }))]
}

export async function callDevelopmentMcpTool(root: string, webContents: WebContents, toolName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('The configured Nexy source checkout is no longer accessible')
  if (isRuntimeTool(toolName)) {
    const definition = getIsolatedRuntimeToolDefinitions().find((tool) => tool.name === toolName)
    const runtime = getIsolatedRuntime()
    if (definition?.pack === 'browser' && (!runtime || runtime.projectId || runtime.workspacePath !== root)) throw new Error('No disposable development runtime is running for this checkout')
    if (definition?.mutating) await approve(webContents, toolName, args, `Run ${toolName} for the disposable Nexy test instance`)
    if (definition?.pack === 'browser') return textResult(await callIsolatedRuntimeTool(toolName, args))
    return textResult(await callRuntimeControlTool(root, toolName))
  }
  if (toolName === 'get_development_context') return textResult({ root, packageName: 'nexy' })
  if (toolName === 'list_development_files') return textResult(await listFiles(root, inside(root, inputPath(args.path)), Math.min(12, Math.max(0, Number(args.maxDepth ?? 4)))))
  if (toolName === 'read_development_file') {
    const file = inside(root, inputPath(args.path)); const info = await fs.stat(file)
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('File is not readable text or exceeds the 1 MB limit')
    return textResult({ path: inputPath(args.path), content: await fs.readFile(file, 'utf8') })
  }
  if (toolName === 'search_development_files') return textResult(await searchFiles(root, inside(root, inputPath(args.path)), String(args.query ?? ''), Math.min(200, Math.max(1, Number(args.maxResults ?? 50)))))
  if (toolName === 'write_development_file') { const file = inside(root, inputPath(args.path)); await approve(webContents, toolName, args, `Write ${inputPath(args.path)}`); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, String(args.content ?? ''), 'utf8'); return textResult({ written: inputPath(args.path) }) }
  if (toolName === 'run_development_command') {
    const cwd = inside(root, inputPath(args.cwd)); const command = String(args.command ?? '').trim(); if (!command) throw new Error('Command is required')
    await approve(webContents, toolName, args, `Run command in Nexy checkout: ${command}`)
    const { stdout, stderr } = await execFileAsync(process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command], { cwd, timeout: Math.min(120_000, Math.max(1_000, Number(args.timeoutMs ?? 120_000))), maxBuffer: MAX_COMMAND_OUTPUT })
    return textResult({ stdout, stderr })
  }
  if (toolName === 'git_status') return textResult({ branch: (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(), commit: (await git(root, ['rev-parse', '--short=12', 'HEAD'])).trim(), changes: (await git(root, ['status', '--porcelain'])).trim().split('\n').filter(Boolean) })
  if (toolName === 'git_diff') { const file = inputPath(args.path); if (file) inside(root, file); return textResult(await git(root, ['diff', '--', ...(file ? [file] : [])])) }
  if (toolName === 'git_log') return textResult(await git(root, ['log', `-${Math.min(100, Math.max(1, Number(args.limit ?? 20)))}`, '--format=%h %s']))
  if (toolName === 'git_commit') { const files = Array.isArray(args.files) ? args.files.map(inputPath).filter(Boolean) : []; files.forEach((file) => inside(root, file)); await approve(webContents, toolName, args, `Commit Nexy checkout changes: ${String(args.message ?? '')}`); if (files.length) await git(root, ['add', '--', ...files]); else await git(root, ['add', '-A']); return textResult(await git(root, ['commit', '-m', String(args.message)])) }
  if (toolName === 'git_create_branch') { await approve(webContents, toolName, args, `Create and check out branch ${String(args.branch ?? '')}`); return textResult(await git(root, ['checkout', '-b', String(args.branch), ...(inputPath(args.fromRef) ? [inputPath(args.fromRef)] : [])])) }
  if (toolName === 'run_preflight') return textResult({ packageJson: existsSync(path.join(root, 'package.json')), nodeModules: existsSync(path.join(root, 'node_modules')), gitStatus: (await git(root, ['status', '--porcelain'])).trim() ? 'dirty' : 'clean' })
  if (toolName === 'start_build') {
    const command = String(args.command) as 'typecheck' | 'test' | 'build' | 'package'; if (!['typecheck', 'test', 'build', 'package'].includes(command)) throw new Error('Unknown build command')
    await approve(webContents, toolName, args, `Start Nexy ${command} build`)
    const db = getDatabase(); const buildId = randomUUID(); const now = Date.now()
    db.prepare(`INSERT INTO build_records (id, workspace_path, commit_sha, branch, version, platform, command, status, started_at) VALUES (?, ?, ?, ?, NULL, ?, ?, 'running', ?)`)
      .run(buildId, root, await git(root, ['rev-parse', '--short=12', 'HEAD']).then((v) => v.trim()).catch(() => null), await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).then((v) => v.trim()).catch(() => null), process.platform, command, now)
    const commands = { typecheck: 'npx tsc --noEmit -p tsconfig.typecheck.json', test: 'npx vitest run', build: 'npm run build', package: 'npm run package' }
    runBuildProcess({ db, buildId, spawnCmd: commands[command], spawnArgs: [], cwd: root, logEvent: 'build:log-chunk', doneEvent: 'build:command-done', registry: buildProcesses })
    return textResult({ buildId })
  }
  if (toolName === 'get_build_records') return textResult(getDatabase().prepare('SELECT * FROM build_records WHERE workspace_path = ? ORDER BY started_at DESC LIMIT ?').all(root, Math.min(100, Math.max(1, Number(args.limit ?? 20))).valueOf()).map((row) => mapBuildRecord(row as Record<string, unknown>)))
  if (toolName === 'cancel_build') { await approve(webContents, toolName, args, `Cancel build ${String(args.buildId)}`); return textResult({ cancelled: cancelBuildProcess({ db: getDatabase(), buildId: String(args.buildId), registry: buildProcesses }) }) }
  throw new Error(`Unknown development MCP tool: ${toolName}`)
}
