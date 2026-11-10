import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { createBackgroundActivitySlice, type BackgroundActivitySlice } from '../store/slices/backgroundActivitySlice'

function createTestStore() {
  return create<BackgroundActivitySlice>()(
    immer((set, get, store) => createBackgroundActivitySlice(set, get as never, store as never) as never) as never,
  )
}

describe('backgroundActivitySlice.applyActivitySnapshot', () => {
  it('removes an activity once the server confirms it has ended, even though it was present in an earlier snapshot', () => {
    const store = createTestStore()

    // Server confirms the chat activity has started.
    store.getState().applyActivitySnapshot([
      { id: 'chat:conv-1', kind: 'chat', label: 'Assistant is responding…', startedAt: 1 },
    ])
    expect(store.getState().backgroundActivities.map((a) => a.id)).toEqual(['chat:conv-1'])

    // Server confirms the turn ended — this must NOT resurrect the entry via the
    // "not yet echoed back by the server" local-preservation fallback, since the server
    // already vouched for this id once before.
    store.getState().applyActivitySnapshot([])
    expect(store.getState().backgroundActivities).toEqual([])

    // A later, unrelated snapshot must not bring it back either.
    store.getState().applyActivitySnapshot([
      { id: 'build:xyz', kind: 'build', label: 'Building…', startedAt: 2 },
    ])
    expect(store.getState().backgroundActivities.map((a) => a.id)).toEqual(['build:xyz'])
  })

  it('still preserves a genuinely local-optimistic entry the server has never confirmed yet', () => {
    const store = createTestStore()

    // Renderer-side optimism (e.g. BackgroundActivityBridges) fires before the server's
    // own snapshot round-trip lands.
    store.getState().upsertBackgroundActivity({ id: 'agent-generator', kind: 'agent-generator', label: 'Generating agent…' })
    expect(store.getState().backgroundActivities.map((a) => a.id)).toEqual(['agent-generator'])

    // An unrelated snapshot arrives before the server has echoed back agent-generator —
    // the not-yet-confirmed entry must survive this reconciliation.
    store.getState().applyActivitySnapshot([])
    expect(store.getState().backgroundActivities.map((a) => a.id)).toEqual(['agent-generator'])

    // The server's own snapshot later confirms it, then ends it — it must now disappear
    // for good, exactly like the chat case above.
    store.getState().applyActivitySnapshot([
      { id: 'agent-generator', kind: 'agent-generator', label: 'Generating agent…', startedAt: 5 },
    ])
    expect(store.getState().backgroundActivities.map((a) => a.id)).toEqual(['agent-generator'])
    store.getState().applyActivitySnapshot([])
    expect(store.getState().backgroundActivities).toEqual([])
  })
})

describe('backgroundActivitySlice.openBackgroundActivity', () => {
  it('opens the Work history pane on the report behind a work-history activity', () => {
    const store = createTestStore()
    store.getState().openBackgroundActivity({ id: 'work-history:run-1', kind: 'work-history', label: 'Generating work history report…', startedAt: 1 })
    const state = store.getState() as BackgroundActivitySlice & { activeSectionPane?: string }
    expect(state.activeSectionPane).toBe('work-history')
    expect(state.workHistoryOpenRunId).toBe('run-1')
    state.setWorkHistoryOpenRunId(null)
    expect(store.getState().workHistoryOpenRunId).toBeNull()
  })
})
