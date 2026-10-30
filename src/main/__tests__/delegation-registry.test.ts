import { beforeEach, describe, expect, it, vi } from 'vitest'

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../ws-server', () => ({ broadcastToMobile: publish }))

import {
  addDelegationNode,
  cancelDelegationForConversation,
  cancelDelegationNode,
  createDelegationRun,
  getDelegationRuns,
  resetDelegationRegistryForTest,
  updateDelegationNode,
} from '../delegation-registry'

describe('delegation registry', () => {
  beforeEach(() => {
    resetDelegationRegistryForTest()
    publish.mockClear()
  })

  it('exposes safe snapshots without cancellation callbacks and bounds live tails', () => {
    const { runId, rootId } = createDelegationRun({ conversationId: 'chat-a', backend: 'nexy', label: 'Coordinator' })
    addDelegationNode(runId, {
      id: 'child-a', parentId: rootId, label: 'Researcher', task: 'Inspect the code', backend: 'nexy',
      capabilities: { canCancel: true, canSteer: false, canViewTail: true }, onCancel: vi.fn(),
    })
    updateDelegationNode(runId, 'child-a', { tail: 'x'.repeat(9_000) })

    const child = getDelegationRuns('chat-a')[0].nodes.find((node) => node.id === 'child-a')!
    expect(child.tail).toHaveLength(8 * 1024)
    expect(child).not.toHaveProperty('cancel')
    expect(publish).toHaveBeenCalled()
  })

  it('cancels one child without cancelling its coordinator, and fans out by conversation', () => {
    const rootCancel = vi.fn()
    const childCancel = vi.fn()
    const { runId, rootId } = createDelegationRun({
      conversationId: 'chat-a', backend: 'nexy', label: 'Coordinator', onCancel: rootCancel,
    })
    addDelegationNode(runId, {
      id: 'child-a', parentId: rootId, label: 'Builder', backend: 'nexy',
      capabilities: { canCancel: true, canSteer: false, canViewTail: true }, onCancel: childCancel,
    })

    expect(cancelDelegationNode('child-a')).toBe('accepted')
    expect(childCancel).toHaveBeenCalledTimes(1)
    expect(rootCancel).not.toHaveBeenCalled()

    cancelDelegationForConversation('chat-a')
    expect(rootCancel).toHaveBeenCalledTimes(1)
    // A cancel-requested child is not invoked twice by a later stop-all action.
    expect(childCancel).toHaveBeenCalledTimes(1)
  })
})
