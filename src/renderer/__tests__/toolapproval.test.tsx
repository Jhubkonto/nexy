import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToolApproval } from '../../renderer/components/ToolApproval'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn()
}))

vi.mock('../../renderer/store/app-store', () => ({
  useAppStore
}))

let mockStore: ReturnType<typeof createMockAppStore>

const SAMPLE_REQUEST = {
  requestId: 'req-1',
  tool: 'fileWrite',
  description: 'Write to /tmp/test.txt',
  args: { path: '/tmp/test.txt', content: 'Hello world' }
}

function setupStore(overrides = {}) {
  mockStore = createMockAppStore({
    toolApprovalRequests: [SAMPLE_REQUEST],
    ...overrides
  })
  setupStoreMock(useAppStore, mockStore)
}

describe('ToolApproval — Rendering', () => {
  beforeEach(() => setupStore())

  it('renders nothing when no requests', () => {
    setupStore({ toolApprovalRequests: [] })
    const { container } = render(<ToolApproval />)
    expect(container.innerHTML).toBe('')
  })

  it('renders tool request card with description and args', () => {
    render(<ToolApproval />)
    expect(screen.getByText('Tool Request')).toBeInTheDocument()
    expect(screen.getByText('Write to /tmp/test.txt')).toBeInTheDocument()
    expect(screen.getByText(/path: \/tmp\/test\.txt/)).toBeInTheDocument()
  })

  it('shows correct icon for tool type', () => {
    render(<ToolApproval />)
    expect(screen.getByText('Tool Request')).toBeInTheDocument()
  })

  it('shows fallback icon for unknown tool type', () => {
    setupStore({ toolApprovalRequests: [{ ...SAMPLE_REQUEST, tool: 'unknown' }] })
    render(<ToolApproval />)
    expect(screen.getByText('Tool Request')).toBeInTheDocument()
  })

  it('renders a completed plan as a plan decision instead of a generic tool request', () => {
    setupStore({
      toolApprovalRequests: [{
        requestId: 'plan-1',
        tool: 'exit_plan_mode',
        description: 'Review the completed plan',
        args: { plan: '1. Inspect\n2. Implement' }
      }]
    })
    render(<ToolApproval />)
    expect(screen.getByText('Plan ready')).toBeInTheDocument()
    expect(screen.getByText('Implement plan')).toBeInTheDocument()
    expect(screen.getByText('Keep planning')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    expect(screen.queryByText('Always')).not.toBeInTheDocument()
  })

  it('renders the full plan without the 120-character argument truncation', async () => {
    const tail = 'FINAL-STEP-MARKER'
    const plan = `# Plan\n\n${'Long explanatory sentence for the plan body. '.repeat(10)}${tail}`
    setupStore({
      toolApprovalRequests: [{
        requestId: 'plan-long',
        tool: 'exit_plan_mode',
        description: 'Review the completed plan',
        args: { plan }
      }]
    })
    const user = userEvent.setup()
    render(<ToolApproval />)
    expect(plan.length).toBeGreaterThan(120)
    expect(screen.getByText(new RegExp(tail))).toBeInTheDocument()
    expect(screen.queryByText(/Codex/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Expand/ }))
    expect(screen.getByRole('button', { name: /Collapse/ })).toBeInTheDocument()
  })
})

describe('ToolApproval — Actions', () => {
  beforeEach(() => setupStore())

  it('approve button calls respondToToolApproval(id, true, false)', async () => {
    const user = userEvent.setup()
    render(<ToolApproval />)
    await user.click(screen.getByText('Approve'))
    expect(mockStore.respondToToolApproval).toHaveBeenCalledWith('req-1', true, false)
  })

  it('deny button calls respondToToolApproval(id, false, false)', async () => {
    const user = userEvent.setup()
    render(<ToolApproval />)
    await user.click(screen.getByText('Deny'))
    expect(mockStore.respondToToolApproval).toHaveBeenCalledWith('req-1', false, false)
  })

  it('always button calls respondToToolApproval(id, true, true)', async () => {
    const user = userEvent.setup()
    render(<ToolApproval />)
    await user.click(screen.getByText('Always'))
    expect(mockStore.respondToToolApproval).toHaveBeenCalledWith('req-1', true, true)
  })

  it('implements or keeps planning using one-shot plan decisions', async () => {
    const user = userEvent.setup()
    setupStore({
      toolApprovalRequests: [{
        requestId: 'plan-1',
        tool: 'exit_plan_mode',
        description: 'Review the completed plan',
        args: { plan: 'Step one' }
      }]
    })
    render(<ToolApproval />)

    await user.click(screen.getByText('Implement plan'))
    expect(mockStore.respondToToolApproval).toHaveBeenCalledWith('plan-1', true, false)
  })
})

describe('ToolApproval — Countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setupStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows countdown timer starting at 60s', () => {
    render(<ToolApproval />)
    expect(screen.getByText('Auto-deny in 60s')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('countdown decrements every second', () => {
    render(<ToolApproval />)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.getByText('Auto-deny in 55s')).toBeInTheDocument()
  })

  it('auto-denies when countdown reaches zero', () => {
    render(<ToolApproval />)
    act(() => { vi.advanceTimersByTime(60000) })
    expect(mockStore.respondToToolApproval).toHaveBeenCalledWith('req-1', false, false)
  })

  it('progress bar changes color when time is low', () => {
    render(<ToolApproval />)

    let bar = screen.getByRole('progressbar')
    expect(bar.className).toContain('bg-gray-400')

    act(() => { vi.advanceTimersByTime(40000) })
    bar = screen.getByRole('progressbar')
    expect(bar.className).toContain('bg-gray-400')

    act(() => { vi.advanceTimersByTime(10000) })
    bar = screen.getByRole('progressbar')
    expect(bar.className).toContain('bg-gray-400')
  })

  it('renders multiple requests with independent countdowns', () => {
    setupStore({
      toolApprovalRequests: [
        SAMPLE_REQUEST,
        { ...SAMPLE_REQUEST, requestId: 'req-2', tool: 'shellExec', description: 'Run ls' }
      ]
    })
    render(<ToolApproval />)
    const bars = screen.getAllByRole('progressbar')
    expect(bars).toHaveLength(2)
  })
})
