import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}))

vi.mock('../database', () => ({
  getDatabase: () => {
    if (!state.db) throw new Error('Database not initialized')
    return state.db
  },
}))

vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    state.handlers.set(channel, handler)
  },
}))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { registerPromptHandlers } from '../prompt-handlers'
import type { PromptLibraryEntry, PromptLibraryVersion } from '../../shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return await handler({}, ...args) as T
}

describe('prompt handlers', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.db?.close()
    state.db = new Database(':memory:')
    initializeBaseSchema(state.db)
    runMigrations(state.db)
    registerPromptHandlers()
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  it('creates and lists global prompts', async () => {
    const prompt = await invoke<PromptLibraryEntry>('prompt:create', {
      title: 'Review',
      body: 'Review {{repository}} for {{focus_area}}. Then summarize {{repository}}.',
      category: 'Coding',
      tags: ['review'],
    })
    const prompts = await invoke<PromptLibraryEntry[]>('prompt:list', null)

    expect(prompt.id).toBeTruthy()
    expect(prompt.scope).toBe('global')
    expect(prompt.variables).toEqual(['repository', 'focus_area'])
    expect(prompts).toEqual([expect.objectContaining({ title: 'Review', category: 'Coding' })])
  })

  it('records version history on create and update', async () => {
    const prompt = await invoke<PromptLibraryEntry>('prompt:create', {
      title: 'Draft',
      body: 'Line one',
      category: 'Coding',
    })
    await invoke<PromptLibraryEntry>('prompt:update', prompt.id, {
      title: 'Updated',
      body: 'Line one\nLine two',
      tags: ['changed'],
    })

    const versions = await invoke<PromptLibraryVersion[]>('prompt:list-versions', prompt.id)

    expect(versions).toHaveLength(2)
    expect(versions[0]).toEqual(expect.objectContaining({ version: 2, title: 'Updated', source: 'manual-edit' }))
    expect(versions[0].diff.titleChanged).toBe(true)
    expect(versions[0].diff.tagsChanged).toBe(true)
    expect(versions[0].diff.addedLines).toEqual(['Line two'])
    expect(versions[1]).toEqual(expect.objectContaining({ version: 1, source: 'manual-create' }))
  })

  it('rolls back to a previous version and records the rollback', async () => {
    const prompt = await invoke<PromptLibraryEntry>('prompt:create', {
      title: 'Draft',
      body: 'First body',
      tags: ['first'],
    })
    await invoke<PromptLibraryEntry>('prompt:update', prompt.id, {
      title: 'Changed',
      body: 'Second body',
      tags: ['second'],
    })

    const restored = await invoke<PromptLibraryEntry>('prompt:rollback', prompt.id, 1)
    const versions = await invoke<PromptLibraryVersion[]>('prompt:list-versions', prompt.id)

    expect(restored).toEqual(expect.objectContaining({
      title: 'Draft',
      body: 'First body',
      tags: ['first'],
    }))
    expect(versions[0]).toEqual(expect.objectContaining({
      version: 3,
      title: 'Draft',
      source: 'rollback-v1',
    }))
  })

  it('lists global prompts plus prompts for the requested project only', async () => {
    await invoke<PromptLibraryEntry>('prompt:create', { title: 'Global', body: 'Global prompt' })
    await invoke<PromptLibraryEntry>('prompt:create', {
      title: 'Project A',
      body: 'Project A prompt',
      scope: 'project',
      project_id: 'project-a',
    })
    await invoke<PromptLibraryEntry>('prompt:create', {
      title: 'Project B',
      body: 'Project B prompt',
      scope: 'project',
      project_id: 'project-b',
    })

    const prompts = await invoke<PromptLibraryEntry[]>('prompt:list', 'project-a')
    const projectlessPrompts = await invoke<PromptLibraryEntry[]>('prompt:list', null)
    const blankProjectPrompts = await invoke<PromptLibraryEntry[]>('prompt:list', '  ')

    expect(prompts.map((prompt) => prompt.title).sort()).toEqual(['Global', 'Project A'])
    expect(projectlessPrompts.map((prompt) => prompt.title)).toEqual(['Global'])
    expect(blankProjectPrompts.map((prompt) => prompt.title)).toEqual(['Global'])
  })

  it('updates and deletes prompts', async () => {
    const prompt = await invoke<PromptLibraryEntry>('prompt:create', {
      title: 'Draft',
      body: 'Draft body',
    })
    const updated = await invoke<PromptLibraryEntry>('prompt:update', prompt.id, {
      title: 'Updated',
      tags: ['one', 'two'],
    })

    expect(updated.title).toBe('Updated')
    expect(updated.tags).toEqual(['one', 'two'])

    await invoke<boolean>('prompt:delete', prompt.id)
    const prompts = await invoke<PromptLibraryEntry[]>('prompt:list', null)
    expect(prompts).toEqual([])
  })

  it('updates variables when prompt body changes', async () => {
    const prompt = await invoke<PromptLibraryEntry>('prompt:create', {
      title: 'Report',
      body: 'Generate a report for {{customer}}.',
    })
    const updated = await invoke<PromptLibraryEntry>('prompt:update', prompt.id, {
      body: 'Generate a report for {{customer}} in {{format}}.',
    })

    expect(updated.variables).toEqual(['customer', 'format'])
  })
})
