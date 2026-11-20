import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { StateCreator } from 'zustand'
import { createUiSlice, type UiSlice } from '../../store/slices/uiSlice'
import type { AgentSlice } from '../../store/slices/agentSlice'
import { setupMockApi, type MockApi } from '../../../test/mocks/api'

let mockApi: MockApi

type TestState = UiSlice & Pick<AgentSlice, 'showAgentPanel'>

function createUiStore() {
  return create<TestState>()(
    immer((set, get, store) => ({
      showAgentPanel: false,
      ...(
        createUiSlice as unknown as StateCreator<
          TestState,
          [['zustand/immer', never]],
          [],
          UiSlice
        >
      )(set, get, store)
    }))
  )
}

beforeEach(() => {
  mockApi = setupMockApi()
  document.documentElement.className = ''
  vi.stubGlobal('crypto', { randomUUID: () => 'toast-id' })
})

describe('uiSlice', () => {
  it('persists compact mode and resized width independently of hide/show', () => {
    const store = createUiStore()
    expect(store.getState().sidebarCollapsed).toBe(false)
    expect(store.getState().sidebarExpandedWidth).toBe(256)
    store.getState().setSidebarExpandedWidth(310)
    store.getState().toggleSidebarCollapsed()
    store.getState().toggleSidebar()
    store.getState().toggleSidebar()
    expect(store.getState().showSidebar).toBe(true)
    expect(store.getState().sidebarCollapsed).toBe(true)
    expect(store.getState().sidebarExpandedWidth).toBe(310)
    expect(mockApi.setSetting).toHaveBeenCalledWith('sidebar_expanded_width', '310')
    expect(mockApi.setSetting).toHaveBeenCalledWith('sidebar_collapsed', 'true')
    store.getState().toggleSidebarCollapsed()
    expect(mockApi.setSetting).toHaveBeenCalledWith('sidebar_collapsed', 'false')
  })

  it('bounds resized widths and ignores non-finite sizes', () => {
    const store = createUiStore()
    store.getState().setSidebarExpandedWidth(10)
    expect(store.getState().sidebarExpandedWidth).toBe(160)
    store.getState().setSidebarExpandedWidth(900)
    expect(store.getState().sidebarExpandedWidth).toBe(480)
    store.getState().setSidebarExpandedWidth(NaN)
    expect(store.getState().sidebarExpandedWidth).toBe(480)
  })

  it('manages the toast queue', () => {
    const store = createUiStore()

    store.getState().addToast('Saved', 'success')
    store.getState().addToast('Heads up')
    expect(store.getState().toasts).toEqual([
      { id: 'toast-id', message: 'Saved', type: 'success' },
      { id: 'toast-id', message: 'Heads up', type: 'info' }
    ])

    store.getState().dismissToast('toast-id')
    expect(store.getState().toasts).toEqual([])
  })

  it('handles tool approval add/respond flow', async () => {
    const store = createUiStore()
    store.getState().addToolApprovalRequest({
      requestId: 'req-1',
      tool: 'fileWrite',
      args: { path: 'test.txt' },
      description: 'Write file'
    })

    await store.getState().respondToToolApproval('req-1', true, true)

    expect(mockApi.respondToToolApproval).toHaveBeenCalledWith('req-1', true, true)
    expect(store.getState().toolApprovalRequests).toEqual([])
  })

  it('toggleTheme flips theme, updates DOM, and persists via IPC', () => {
    const store = createUiStore()

    store.getState().toggleTheme()

    expect(store.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(mockApi.setTheme).toHaveBeenCalledWith('light')
  })

  it('switches UI style independently and persists it', () => {
    const store = createUiStore()

    store.getState().setUiStyle('8bit')

    expect(store.getState().theme).toBe('dark')
    expect(store.getState().uiStyle).toBe('8bit')
    expect(document.documentElement.dataset.uiStyle).toBe('8bit')
    expect(mockApi.setSetting).toHaveBeenCalledWith('ui_style', '8bit')
  })

  it('toggles sidebar and agent panel visibility', () => {
    const store = createUiStore()

    store.getState().toggleSidebar()
    store.getState().toggleAgentPanel()
    store.getState().setShowMcpPanel(true)

    expect(store.getState().showSidebar).toBe(false)
    expect(store.getState().showAgentPanel).toBe(true)
    expect(store.getState().showMcpPanel).toBe(true)
  })
})
