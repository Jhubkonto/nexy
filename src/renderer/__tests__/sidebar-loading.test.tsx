import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '../../renderer/components/Sidebar'
import { setupMockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn()
}))

vi.mock('../../renderer/store/app-store', () => ({ useAppStore }))

let mockStore: ReturnType<typeof createMockAppStore>

beforeEach(() => {
  setupMockApi()
})

describe('Sidebar loading states', () => {
  const activities = [
    { id: 'build', kind: 'build', label: 'Building', startedAt: 1 },
    { id: 'task', kind: 'build', label: 'Working', startedAt: 2 },
  ]

  it('shows decorative compact loading dots alongside the count and keeps activity clickable', async () => {
    const user = userEvent.setup()
    mockStore = createMockAppStore({ sidebarCollapsed: true, backgroundActivities: activities })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    const activity = screen.getByRole('button', { name: 'Open activity feed (2 active) (working…)' })
    const indicator = activity.querySelector('.nexy-sidebar-compact-loading')
    expect(indicator).toHaveAttribute('aria-hidden', 'true')
    expect(indicator?.children).toHaveLength(3)
    expect(activity.querySelector('.animate-spin')).toBeNull()
    expect(activity.querySelector('.nexy-sidebar-badge')).toHaveTextContent('2')
    expect(activity).toBeEnabled()
    await user.tab()
    await user.tab()
    await user.tab()
    expect(activity).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Open activity feed (2 active) (working…)')
    await user.keyboard('{Escape}')
    await user.hover(activity)
    expect(screen.getByRole('tooltip')).toHaveTextContent('(working…)')
    await user.click(activity)
    expect(mockStore.setShowActivityFeed).toHaveBeenCalledWith(true)
    expect(mockStore.toggleSidebarCollapsed).not.toHaveBeenCalled()
  })

  it('keeps the spinner for expanded running buttons', () => {
    mockStore = createMockAppStore({ backgroundActivities: activities })
    setupStoreMock(useAppStore, mockStore)

    const { container } = render(<Sidebar />)
    const activity = screen.getByRole('button', { name: /Open activity feed.*working/ })
    expect(activity.querySelector('.nexy-sidebar-working .animate-spin')).toBeInTheDocument()
    expect(activity.querySelector('.nexy-sidebar-badge')).toHaveTextContent('2')
    expect(container.querySelector('.nexy-sidebar-compact-loading')).toBeNull()
  })

  it('shows no loading indicators on idle compact navigation buttons', () => {
    mockStore = createMockAppStore({ sidebarCollapsed: true })
    setupStoreMock(useAppStore, mockStore)

    const { container } = render(<Sidebar />)
    expect(container.querySelector('.nexy-sidebar-compact-loading, .nexy-sidebar-working')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open projects' })).toBeEnabled()
  })

  it('removes the compact loading indicator when work finishes', () => {
    mockStore = createMockAppStore({ sidebarCollapsed: true, backgroundActivities: activities })
    setupStoreMock(useAppStore, mockStore)
    const { container, rerender } = render(<Sidebar />)
    expect(container.querySelector('.nexy-sidebar-compact-loading')).toBeInTheDocument()

    mockStore = createMockAppStore({ sidebarCollapsed: true })
    setupStoreMock(useAppStore, mockStore)
    rerender(<Sidebar />)
    expect(container.querySelector('.nexy-sidebar-compact-loading')).toBeNull()
    expect(screen.queryByRole('button', { name: /Open activity feed/ })).not.toBeInTheDocument()
  })

  it('renders nav buttons for Projects, Agents, and Chats', () => {
    mockStore = createMockAppStore({})
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.getByLabelText('Open projects')).toBeInTheDocument()
    expect(screen.getByLabelText('Open agents')).toBeInTheDocument()
    expect(screen.getByLabelText('Open chat history')).toBeInTheDocument()
  })

  it('highlights the active section pane button', () => {
    mockStore = createMockAppStore({ activeSectionPane: 'agents' })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    const agentsBtn = screen.getByLabelText('Open agents')
    expect(agentsBtn.className).toContain('bg-gray-100')
  })

  it('hides the status strip when no CLI or API provider is configured', () => {
    mockStore = createMockAppStore({ authState: { authenticated: false, mode: 'none', user: null } })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.queryByLabelText('Available CLI tools and configured API providers')).not.toBeInTheDocument()
  })
})
