import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ChatWindow } from '../../renderer/components/ChatWindow'
import { MessageBubbleBase } from '../../renderer/components/MessageBubble'
import { MarkdownRenderer } from '../../renderer/components/MarkdownRenderer'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn(),
}))

vi.mock('../../renderer/store/app-store', () => ({ useAppStore }))

let mockApi: MockApi

beforeEach(() => {
  mockApi = setupMockApi()
  mockApi.getMessages = vi.fn().mockResolvedValue([])
  mockApi.onStreamResponse = vi.fn().mockReturnValue(() => {})
  setupStoreMock(useAppStore, createMockAppStore({
    currentConversationId: 'conversation-1',
    authState: { authenticated: true, user: { login: 'test', name: 'Test', avatar_url: '' } },
  }))
})

describe('ChatWindow in-chat search', () => {
  it('opens the message search with Ctrl+F instead of the browser find dialog', () => {
    render(<ChatWindow />)

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })

    const searchbox = screen.getByRole('searchbox', { name: 'Find in chat' })
    expect(searchbox).toBeInTheDocument()
    expect(searchbox.parentElement).toHaveClass('absolute')
    expect(screen.getByText('0/0')).toBeInTheDocument()
  })

  it('marks only the matching search phrase inside the selected message', () => {
    render(
      <MessageBubbleBase
        id="message-1"
        role="user"
        content="Find a Needle in this message."
        isLastAssistant={false}
        isGenerating={false}
        onCopy={vi.fn()}
        searchQuery="needle"
      />,
    )

    expect(screen.getByText('Needle', { selector: 'mark[data-chat-search-match="true"]' })).toBeInTheDocument()
    expect(document.querySelectorAll('mark[data-chat-search-match="true"]')).toHaveLength(1)
  })

  it('marks the phrase without discarding Markdown formatting', () => {
    render(<MarkdownRenderer content="A **Needle** in formatted text." searchQuery="needle" />)

    const match = screen.getByText('Needle', { selector: 'mark[data-chat-search-match="true"]' })
    expect(match.closest('strong')).not.toBeNull()
  })
})
