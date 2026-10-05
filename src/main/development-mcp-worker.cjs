/* global process, require, URL */
'use strict'
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
const url = process.env.NEXY_DEVELOPMENT_MCP_URL
const token = process.env.NEXY_DEVELOPMENT_MCP_TOKEN
if (!url || !token) { process.stderr.write('[nexy-development-mcp] connection environment is missing\n'); process.exit(1) }
async function main() {
  const client = new Client({ name: 'nexy-development-stdio', version: '1.0.0' }, { capabilities: {} })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  const server = new Server({ name: 'nexy-development', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => client.listTools())
  server.setRequestHandler(CallToolRequestSchema, async (request) => client.callTool({ name: request.params.name, arguments: request.params.arguments }))
  await server.connect(new StdioServerTransport())
}
main().catch((error) => { process.stderr.write(`[nexy-development-mcp] ${error instanceof Error ? error.message : String(error)}\n`); process.exit(1) })
