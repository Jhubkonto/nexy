import { describe, expect, it } from 'vitest'
import { getDevelopmentMcpToolDefinitions } from '../development-mcp-capabilities'

describe('development MCP tool allowlist', () => {
  it('contains development operations and never operator-domain tools', () => {
    const names = new Set(getDevelopmentMcpToolDefinitions().map((tool) => tool.name))
    expect(names.has('get_development_context')).toBe(true)
    expect(names.has('write_development_file')).toBe(true)
    expect(names.has('git_commit')).toBe(true)
    expect(names.has('start_build')).toBe(true)
    expect(names.has('search_conversations')).toBe(false)
    expect(names.has('list_artifacts')).toBe(false)
    expect(names.has('list_agents')).toBe(false)
    expect(names.has('list_schedules')).toBe(false)
    expect(names.has('search_project_wiki')).toBe(false)
  })
})
