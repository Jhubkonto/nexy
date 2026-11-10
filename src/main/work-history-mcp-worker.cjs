'use strict'
/* global require, process, Buffer */
/**
 * Work history MCP stdio worker. Launched by Claude Code, Codex or Hermes (inside a Nexy chat or
 * from a terminal after the user enables external access). Forwards tool calls to Nexy's
 * loopback bridge, authenticated by the per-connection token in NEXY_WH_BRIDGE_TOKEN.
 */
const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
const http = require('http')

const port = Number(process.env.NEXY_WH_BRIDGE_PORT || 0)
const token = process.env.NEXY_WH_BRIDGE_TOKEN || ''

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: {
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'X-Bridge-Token': token,
    } }, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        if (res.statusCode === 403) return reject(new Error('Nexy rejected the connection. Enable external access in Nexy > Work history and use the new setup.'))
        try { resolve(JSON.parse(raw)) } catch { reject(new Error('Invalid bridge response')) }
      })
    })
    req.on('error', () => reject(new Error('Nexy is not running or work history access was stopped.')))
    req.end(data)
  })
}

async function main() {
  if (!port || !token) throw new Error('NEXY_WH_BRIDGE_PORT and NEXY_WH_BRIDGE_TOKEN are required')
  let tools = []
  try { tools = (await post('/tools', {})).tools || [] } catch (error) { process.stderr.write(`[work-history-mcp] ${error.message}\n`) }
  const server = new Server({ name: 'nexy-work-history', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (!tools.length) tools = (await post('/tools', {})).tools || []
    return { tools }
  })
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await post('/call', { toolName: req.params.name, args: req.params.arguments || {} })
      return { isError: !result.success, content: [{ type: 'text', text: result.result || result.error || '(no result)' }] }
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: `Bridge error: ${error.message}` }] }
    }
  })
  await server.connect(new StdioServerTransport())
}
main().catch((error) => { process.stderr.write(`[work-history-mcp] ${error.message}\n`); process.exit(1) })
