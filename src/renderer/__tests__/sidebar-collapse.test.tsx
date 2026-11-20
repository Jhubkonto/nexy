import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../components/Sidebar'
import { useAppStore } from '../store/app-store'
import { setupMockApi, type MockApi } from '../../test/mocks/api'

const initialState = useAppStore.getState()
let api: MockApi

beforeEach(() => {
  api = setupMockApi()
  useAppStore.setState(initialState, true)
  vi.stubGlobal('innerWidth', 1200)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('collapsible sidebar', () => {
  it('switches between dots and spinner when toggling during activity', () => {
    useAppStore.setState({
      backgroundActivities: [{ id: 'job', label: 'Working', kind: 'build', startedAt: 1 }],
    })
    render(<Sidebar />)
    const activity = screen.getByRole('button', { name: /Open activity feed.*working/ })
    expect(activity.querySelector('.nexy-sidebar-working .animate-spin')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(activity.querySelector('.nexy-sidebar-compact-loading')?.children).toHaveLength(3)
    expect(activity.querySelector('.animate-spin')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(activity.querySelector('.nexy-sidebar-compact-loading')).toBeNull()
    expect(activity.querySelector('.nexy-sidebar-working .animate-spin')).toBeInTheDocument()
  })

  it('animates toggles, reverses rapid toggles, and restores resized width', async () => {
    vi.useFakeTimers()
    useAppStore.setState({ sidebarExpandedWidth: 320 })
    render(<Sidebar />)
    const sidebar = screen.getByRole('complementary')
    expect(sidebar).toHaveStyle({ width: '320px' })
    expect(sidebar).toHaveAttribute('data-animating', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(sidebar).toHaveStyle({ width: '56px' })
    expect(sidebar).toHaveAttribute('data-animating', 'true')
    expect(screen.queryByTestId('resize-handle')).not.toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(60) })
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(sidebar).toHaveStyle({ width: '320px' })
    expect(sidebar).toHaveAttribute('data-animating', 'true')
    await act(async () => { vi.advanceTimersByTime(220) })
    expect(sidebar).toHaveAttribute('data-animating', 'false')
    expect(screen.getByTestId('resize-handle')).toBeInTheDocument()
    expect(api.setSetting).toHaveBeenCalledWith('sidebar_collapsed', 'false')
  })

  it('restores compact mode after remount without startup animation', () => {
    useAppStore.setState({ sidebarCollapsed: true })
    const first = render(<Sidebar />)
    first.unmount()
    render(<Sidebar />)
    expect(screen.getByRole('complementary')).toHaveStyle({ width: '56px' })
    expect(screen.getByRole('complementary')).toHaveAttribute('data-animating', 'false')
  })

  it('clamps expansion to viewport size without overwriting the preferred width', () => {
    useAppStore.setState({ sidebarCollapsed: true, sidebarExpandedWidth: 400 })
    render(<Sidebar />)
    vi.stubGlobal('innerWidth', 800)
    fireEvent(window, new Event('resize'))
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(screen.getByRole('complementary')).toHaveStyle({ width: '256px' })
    expect(useAppStore.getState().sidebarExpandedWidth).toBe(400)
    vi.stubGlobal('innerWidth', 400)
    fireEvent(window, new Event('resize'))
    expect(screen.getByRole('complementary')).toHaveStyle({ width: '160px' })
  })

  it('commits drag width and keeps dragging immediate after expansion', async () => {
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    fireEvent.pointerDown(screen.getByTestId('resize-handle'), { clientX: 256 })
    expect(screen.getByRole('complementary')).toHaveAttribute('data-animating', 'false')
    fireEvent.pointerMove(window, { clientX: 300 })
    fireEvent.pointerUp(window)
    expect(screen.getByRole('complementary')).toHaveStyle({ width: '300px' })
    expect(api.setSetting).toHaveBeenCalledWith('sidebar_expanded_width', '300')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(screen.getByRole('complementary')).toHaveStyle({ width: '300px' })
    await waitFor(() => expect(useAppStore.getState().sidebarExpandedWidth).toBe(300))
  })

  it('opens every compact section without expanding and hides conversation rows', async () => {
    const user = userEvent.setup()
    useAppStore.setState({
      sidebarCollapsed: true,
      conversations: [
        { id: 'pin', title: 'Pinned example', pinned: 1, project_id: null, agent_id: null, created_at: 0, updated_at: 0, model: null },
        { id: 'recent', title: 'Recent example', pinned: 0, project_id: null, agent_id: null, created_at: 0, updated_at: 0, model: null },
      ],
    })
    render(<Sidebar />)
    expect(screen.queryByRole('button', { name: 'Open pinned chat Pinned example' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Recent example' })).not.toBeInTheDocument()
    for (const [name, section] of [
      ['Open pinned chats (1 pinned)', 'pinned'], ['Open chat history', 'chats'],
      ['Open projects', 'projects'], ['Open agents', 'agents'], ['Open skills', 'skills'],
      ['Open schedules', 'scheduled'], ['Open automated workflows', 'workflows'],
      ['Open Artifacts', 'artifacts'], ['Open ratings', 'ratings'], ['Work history', 'work-history'],
    ]) {
      const button = screen.getByRole('button', { name })
      await user.click(button)
      expect(useAppStore.getState().activeSectionPane).toBe(section)
      expect(button).toHaveAttribute('aria-current', 'page')
      expect(useAppStore.getState().sidebarCollapsed).toBe(true)
    }
    await user.click(screen.getByRole('button', { name: 'New Chat' }))
    expect(useAppStore.getState().currentConversationId).toBeNull()
    expect(useAppStore.getState().sidebarCollapsed).toBe(true)
  })

  it('exposes counts, working activity, and focus/hover tooltips on the button', async () => {
    const user = userEvent.setup()
    useAppStore.setState({
      sidebarCollapsed: true,
      unreadConversationIds: ['one', 'two'],
      sectionNewCounts: { ...initialState.sectionNewCounts, projects: 3 },
      backgroundActivities: [{ id: 'job', label: 'Working', kind: 'build', startedAt: 1 }],
    })
    render(<Sidebar />)
    const chats = screen.getByRole('button', { name: 'Open chat history (2 unread)' })
    await user.hover(chats)
    expect(screen.getByRole('tooltip')).toHaveTextContent('2 unread')
    expect(chats).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id)
    expect(chats.parentElement).not.toHaveAttribute('tabindex')
    act(() => { chats.focus() })
    expect(screen.getByRole('tooltip')).toHaveStyle({ visibility: 'visible' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.unhover(chats)
    act(() => { chats.blur() })
    act(() => { chats.focus() })
    expect(screen.getByRole('tooltip')).toHaveTextContent('2 unread')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open projects (3 new)' })).toHaveTextContent('3')
    await user.click(screen.getByRole('button', { name: /Open activity feed.*working/ }))
    expect(useAppStore.getState().showActivityFeed).toBe(true)
    expect(useAppStore.getState().sidebarCollapsed).toBe(true)
  })

  it('keeps New Chat disabled with an accessible reason during an emergency stop', async () => {
    api.getEmergencyStop.mockResolvedValue({ active: true, activatedAt: 1 })
    useAppStore.setState({ sidebarCollapsed: true })
    render(<Sidebar />)
    const button = screen.getByRole('button', { name: 'New Chat' })
    await waitFor(() => expect(button).toBeDisabled())
    expect(button).toHaveAccessibleDescription('Conversation starts are frozen')
    expect(screen.getByRole('status')).toHaveTextContent('Conversation starts are frozen')
  })
})
