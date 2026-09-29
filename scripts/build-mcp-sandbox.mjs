#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

const root = process.cwd()

const targets = {
  win: {
    x64: 'x86_64-pc-windows-msvc',
    arm64: 'aarch64-pc-windows-msvc',
  },
  mac: {
    x64: 'x86_64-apple-darwin',
    arm64: 'aarch64-apple-darwin',
  },
  linux: {
    x64: 'x86_64-unknown-linux-gnu',
  },
}

const platform = process.argv[2] || (process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux')
const arch = process.argv[3] || (process.arch === 'arm64' ? 'arm64' : 'x64')
const rustTarget = targets[platform]?.[arch]

function fail(message) {
  console.error(`MCP sandbox build failed: ${message}`)
  process.exit(1)
}

if (!rustTarget) fail(`unsupported platform/architecture ${platform}/${arch}`)

function requireRustTarget(target) {
  const rustup = findCommand('rustup', 'NEXY_MCP_SANDBOX_RUSTUP')
  if (!rustup) fail(`rustup is required to build ${target}; install Rust with rustup or set NEXY_MCP_SANDBOX_RUSTUP.`)
  const installed = spawnSync(rustup, ['target', 'list', '--installed'], { encoding: 'utf8', windowsHide: true })
  if (installed.status === 0 && installed.stdout.split(/\r?\n/).includes(target)) return

  // Cross targets are an implementation detail of the release build. Install the
  // standard library automatically so a maintainer never has to prepare a machine
  // by hand just to package Nexy for the second Windows architecture.
  console.log(`Installing Rust target ${target}…`)
  const added = spawnSync(rustup, ['target', 'add', target], { stdio: 'inherit', windowsHide: true })
  if (added.status !== 0) {
    fail(`could not install Rust target ${target}; check the Rust installation and network access`)
  }
}

const helperName = platform === 'win' ? 'mcp-sandbox.exe' : 'mcp-sandbox'
const manifest = path.join(root, 'mcp-sandbox', 'Cargo.toml')
const releaseBinary = path.join(root, 'mcp-sandbox', 'target', rustTarget, 'release', helperName)
const outputDirectory = path.join(root, 'mcp-sandbox', 'bin', `${platform}-${arch}`)
const output = path.join(outputDirectory, helperName)

function findCommand(command, environmentVariable) {
  const configured = environmentVariable ? process.env[environmentVariable] : undefined
  if (configured) return configured
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = spawnSync(lookup, [command], { encoding: 'utf8', windowsHide: true })
  if (result.status === 0) return result.stdout.trim().split(/\r?\n/)[0]
  return null
}

function findWindowsSignTool() {
  const configured = process.env.NEXY_MCP_SANDBOX_SIGNTOOL
  if (configured) return configured
  const discovered = findCommand('signtool.exe')
  if (discovered) return discovered
  if (process.platform !== 'win32') return null
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean)
    .map((value) => path.join(value, 'Windows Kits', '10', 'bin'))
  const candidates = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const version of readdirSync(root)) {
      const candidate = path.join(root, version, 'x64', 'signtool.exe')
      if (existsSync(candidate)) candidates.push(candidate)
    }
  }
  return candidates.sort().at(-1) ?? null
}

function windowsSigningConfig() {
  const signtool = findWindowsSignTool()
  const certificateFile = process.env.NEXY_MCP_SANDBOX_CERTIFICATE_FILE
  const certificateSha1 = process.env.NEXY_MCP_SANDBOX_CERTIFICATE_SHA1
  if (!certificateFile && !certificateSha1) return null
  if (!signtool) fail('a Windows signing certificate was configured, but signtool.exe was not found')
  if (certificateFile && certificateSha1) {
    fail('set only one of NEXY_MCP_SANDBOX_CERTIFICATE_FILE and NEXY_MCP_SANDBOX_CERTIFICATE_SHA1')
  }
  return { signtool, certificateFile, certificateSha1 }
}

function signWindows(binary) {
  const config = windowsSigningConfig()
  if (!config) {
    console.log('No MCP helper signing certificate configured; using package integrity verification.')
    return
  }
  const { signtool, certificateFile, certificateSha1 } = config

  const args = ['sign', '/fd', 'SHA256', '/d', 'Nexy MCP sandbox']
  if (certificateFile) {
    args.push('/f', certificateFile)
    if (process.env.NEXY_MCP_SANDBOX_CERTIFICATE_PASSWORD) {
      args.push('/p', process.env.NEXY_MCP_SANDBOX_CERTIFICATE_PASSWORD)
    }
  } else {
    args.push('/sha1', certificateSha1)
  }
  if (process.env.NEXY_MCP_SANDBOX_TIMESTAMP_URL) {
    args.push('/tr', process.env.NEXY_MCP_SANDBOX_TIMESTAMP_URL, '/td', 'SHA256')
  }
  args.push(binary)
  execFileSync(signtool, args, { stdio: 'inherit', windowsHide: true })
}

if (platform === 'win' && process.env.NEXY_MCP_SANDBOX_REQUIRE_SIGNATURE === '1' && !windowsSigningConfig()) {
  fail('Windows helper signing is required by NEXY_MCP_SANDBOX_REQUIRE_SIGNATURE=1, but no certificate is configured')
}

function signMac(binary) {
  const identity = process.env.NEXY_MCP_SANDBOX_CODESIGN_IDENTITY
  if (!identity) {
    if (process.env.NEXY_MCP_SANDBOX_REQUIRE_SIGNATURE === '1') {
      fail('macOS helper signing is required by NEXY_MCP_SANDBOX_REQUIRE_SIGNATURE=1, but no identity is configured')
    }
    console.log('No MCP helper signing identity configured; using package integrity verification.')
    return
  }
  const codesign = findCommand('codesign', 'NEXY_MCP_SANDBOX_CODESIGN')
  if (!codesign) fail('a macOS signing identity was configured, but codesign was not found')
  execFileSync(codesign, ['--force', '--options', 'runtime', '--timestamp', '--sign', identity, binary], { stdio: 'inherit' })
}

console.log(`Building MCP sandbox helper for ${platform}/${arch} (${rustTarget})…`)
requireRustTarget(rustTarget)
const cargo = findCommand('cargo', 'NEXY_MCP_SANDBOX_CARGO')
if (!cargo) fail('cargo is required to build the MCP helper; install Rust or set NEXY_MCP_SANDBOX_CARGO.')
try {
  execFileSync(cargo, ['build', '--release', '--manifest-path', manifest, '--target', rustTarget], { stdio: 'inherit' })
} catch {
  fail(`cargo could not build ${rustTarget}; install that Rust target and make the crates.io registry available, then retry`)
}

try {
  if (!statSync(releaseBinary).isFile()) fail(`cargo did not produce ${releaseBinary}`)
} catch {
  fail(`cargo did not produce ${releaseBinary}`)
}

mkdirSync(outputDirectory, { recursive: true })
copyFileSync(releaseBinary, output)
if (platform === 'linux' || platform === 'mac') chmodSync(output, 0o755)
if (platform === 'win') signWindows(output)
if (platform === 'mac') signMac(output)

// The helper is an extra resource, so its integrity must be checked independently
// of Electron's asar/package metadata. A sidecar digest lets the installed app
// verify the exact artifact shipped by Nexy without requiring an end-user
// certificate or a machine-wide trust-store change.
const digest = createHash('sha256').update(readFileSync(output)).digest('hex')
writeFileSync(`${output}.sha256`, `${digest}  ${helperName}\n`, 'utf8')

console.log(`MCP sandbox helper staged at ${output}`)
