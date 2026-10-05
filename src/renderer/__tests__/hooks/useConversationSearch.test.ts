import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConversationPagination } from '../../../renderer/hooks/useConversationPagination'
import {
  SEARCH_DEBOUNCE_MS,
  useDebouncedSearchQuery,
} from '../../../renderer/hooks/useDebouncedSearchQuery'
import { setupMockApi, type MockApi } from '../../../test/mocks/api'

describe('debounced conversation search', () => {
  let api: MockApi

  beforeEach(() => {
    vi.useFakeTimers()
    api = setupMockApi()
    api.listConversationPage.mockResolvedValue({
      items: [],
      totalCount: 0,
      nextCursor: null,
      hasMore: false,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function useSearch(query: string) {
    const debouncedQuery = useDebouncedSearchQuery(query)
    return useConversationPagination({ type: 'all' }, debouncedQuery)
  }

  function useProjectHistory(freshnessKey: string) {
    return useConversationPagination({ type: 'project', id: 'project-1' }, '', freshnessKey)
  }

  it('turns a burst of keystrokes into one replacement request', async () => {
    const { rerender } = renderHook(
      ({ query }) => useSearch(query),
      { initialProps: { query: '' } },
    )
    await act(async () => { await Promise.resolve() })
    expect(api.listConversationPage).toHaveBeenCalledTimes(1)

    rerender({ query: 'n' })
    rerender({ query: 'ne' })
    rerender({ query: 'nexy' })

    act(() => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1) })
    expect(api.listConversationPage).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })
    expect(api.listConversationPage).toHaveBeenCalledTimes(2)
    expect(api.listConversationPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'nexy' }),
    )
  })

  it('applies clearing immediately without waiting for the debounce timer', async () => {
    const { rerender } = renderHook(
      ({ query }) => useSearch(query),
      { initialProps: { query: 'nexy' } },
    )
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      rerender({ query: '' })
      await Promise.resolve()
    })

    expect(api.listConversationPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: undefined }),
    )
  })

  it('replaces an already-loaded project page when its active chat is added to the shared cache', async () => {
    const { rerender } = renderHook(
      ({ freshnessKey }) => useProjectHistory(freshnessKey),
      { initialProps: { freshnessKey: '' } },
    )
    await act(async () => { await Promise.resolve() })
    expect(api.listConversationPage).toHaveBeenCalledTimes(1)

    rerender({ freshnessKey: 'new-chat:123456' })
    await act(async () => { await Promise.resolve() })

    expect(api.listConversationPage).toHaveBeenCalledTimes(2)
    expect(api.listConversationPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: { type: 'project', id: 'project-1' }, cursor: null }),
    )
  })

  it('keeps the previous page visible while replacement results load', async () => {
    api.listConversationPage.mockResolvedValueOnce({
      items: [{
        id: 'previous',
        agent_id: null,
        title: 'Previous results',
        created_at: 1,
        updated_at: 1,
      }],
      totalCount: 1,
      nextCursor: null,
      hasMore: false,
    })

    const { result, rerender } = renderHook(
      ({ query }) => useSearch(query),
      { initialProps: { query: '' } },
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.items.map((item) => item.id)).toEqual(['previous'])

    api.listConversationPage.mockReturnValue(new Promise(() => {}))
    rerender({ query: 'replacement' })
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
      await Promise.resolve()
    })

    expect(result.current.items.map((item) => item.id)).toEqual(['previous'])
    expect(result.current.isLoading).toBe(true)
  })
})
