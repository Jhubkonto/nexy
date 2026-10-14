import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageBubble, stripInjectedBlocks } from '../../renderer/components/MessageBubble'
import { setupMockApi } from '../../test/mocks/api'

beforeEach(() => {
  setupMockApi()
})

const baseProps = {
  id: 'msg-1',
  role: 'user' as const,
  content: 'Hello there',
  isLastAssistant: false,
  isGenerating: false,
  onCopy: vi.fn()
}

function openAssistantActions() {
  fireEvent.click(screen.getByRole('button', { name: 'More message actions' }))
}

describe('MessageBubble', () => {
  it('renders user message content as plain text', () => {
    render(<MessageBubble {...baseProps} />)
    expect(screen.getByText('Hello there')).toBeInTheDocument()
  })

  it('renders historical context snapshots with missing array fields safely', () => {
    render(
      <MessageBubble
        {...baseProps}
        contextSnapshot={JSON.stringify({
          historyLength: 3,
          estimatedTokens: 600,
          model: 'legacy-model',
          timestamp: Date.now(),
        })}
      />,
    )

    expect(screen.getByRole('button', { name: 'Toggle context snapshot' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle context snapshot' }))
    expect(screen.getByText('3 messages')).toBeInTheDocument()
    expect(screen.getByText('legacy-model')).toBeInTheDocument()
  })

  it('strips injected context from user-facing content', () => {
    expect(stripInjectedBlocks('[Project Context]\nsecret\n[/Project Context]\nHello')).toBe('Hello')
    expect(stripInjectedBlocks('{"projectId":"p1","sourceContext":{"useProjectWiki":true}}\nHello')).toBe('Hello')
  })

  it('renders assistant message with markdown', () => {
    render(
      <MessageBubble
        {...baseProps}
        role="assistant"
        content="**Bold** text"
      />
    )
    expect(screen.getByText('Bold')).toBeInTheDocument()
  })

  it('shows attachment chips when present', () => {
    render(
      <MessageBubble
        {...baseProps}
        attachments={[
          { id: 'a1', name: 'file.txt', size: 1024 },
          { id: 'a2', name: 'code.ts', size: 2048 }
        ]}
      />
    )
    expect(screen.getByText(/file\.txt/)).toBeInTheDocument()
    expect(screen.getByText(/code\.ts/)).toBeInTheDocument()
    expect(screen.getByText(/1\.0KB/)).toBeInTheDocument()
  })

  it('uses the high-resolution attachment source in the image preview', () => {
    render(
      <MessageBubble
        {...baseProps}
        attachments={[{
          id: 'image-1',
          name: 'screen.png',
          size: 2048,
          type: 'image',
          thumbnailDataUrl: 'data:image/jpeg;base64,thumbnail',
          previewDataUrl: 'data:image/jpeg;base64,preview',
        }]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview screen.png' }))

    expect(screen.getByRole('dialog').querySelector('img')).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,preview',
    )
  })

  it('shows copy action on hover', () => {
    render(<MessageBubble {...baseProps} />)
    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)

    expect(screen.getByRole('button', { name: 'Copy' })).toHaveAttribute('title', 'Copy')
  })

  it('calls onCopy when copy button clicked', () => {
    const onCopy = vi.fn()
    render(<MessageBubble {...baseProps} onCopy={onCopy} />)

    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(onCopy).toHaveBeenCalledWith('Hello there')
  })

  it('shows green highlight on copy button after click', () => {
    render(<MessageBubble {...baseProps} onCopy={vi.fn()} />)

    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(screen.getByRole('button', { name: 'Copy' })).toHaveClass('bg-green-50')
  })

  it('shows save to wiki action for assistant messages and calls handler', () => {
    const onSaveToWiki = vi.fn()
    render(
      <MessageBubble
        {...baseProps}
        role="assistant"
        onSaveToWiki={onSaveToWiki}
      />
    )

    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)
    openAssistantActions()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save to wiki' }))

    expect(onSaveToWiki).toHaveBeenCalledWith('msg-1', 'Hello there')
    expect(screen.queryByRole('menu', { name: 'Message actions' })).not.toBeInTheDocument()
  })

  it('offers save as prompt for a user message and strips injected context', () => {
    const onSaveAsPrompt = vi.fn()
    render(
      <MessageBubble
        {...baseProps}
        content={'[Project Context]\nsecret\n[/Project Context]\nReusable prompt'}
        onSaveAsPrompt={onSaveAsPrompt}
      />
    )

    const container = screen.getByText('Reusable prompt').closest('.group')!
    fireEvent.mouseEnter(container)
    fireEvent.click(screen.getByRole('button', { name: 'Save as prompt' }))

    expect(onSaveAsPrompt).toHaveBeenCalledWith('Reusable prompt')
  })

  it('offers save as prompt for an assistant response', () => {
    const onSaveAsPrompt = vi.fn()
    render(<MessageBubble {...baseProps} role="assistant" onSaveAsPrompt={onSaveAsPrompt} />)

    openAssistantActions()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save as prompt' }))

    expect(onSaveAsPrompt).toHaveBeenCalledWith('Hello there')
  })

  it('offers delete from here for user and assistant messages', () => {
    const onDeleteUser = vi.fn()
    const { unmount } = render(<MessageBubble {...baseProps} onDeleteAfter={onDeleteUser} />)

    fireEvent.mouseEnter(screen.getByText('Hello there').closest('.group')!)
    fireEvent.click(screen.getByRole('button', { name: 'Delete from here' }))
    expect(onDeleteUser).toHaveBeenCalledOnce()

    unmount()
    const onDeleteAssistant = vi.fn()
    render(<MessageBubble {...baseProps} role="assistant" onDeleteAfter={onDeleteAssistant} />)
    openAssistantActions()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete from here' }))
    expect(onDeleteAssistant).toHaveBeenCalledOnce()
  })

  it('offers fork from here for user and assistant messages', () => {
    const onForkUser = vi.fn()
    render(<MessageBubble {...baseProps} onForkFromHere={onForkUser} />)

    fireEvent.mouseEnter(screen.getByText('Hello there').closest('.group')!)
    fireEvent.click(screen.getByRole('button', { name: 'Fork from here' }))
    expect(onForkUser).toHaveBeenCalledOnce()

    const onForkAssistant = vi.fn()
    render(<MessageBubble {...baseProps} role="assistant" onForkFromHere={onForkAssistant} />)
    openAssistantActions()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fork from here' }))
    expect(onForkAssistant).toHaveBeenCalledOnce()
  })

  it('shows saved state for assistant messages linked to wiki entries', () => {
    render(
      <MessageBubble
        {...baseProps}
        role="assistant"
        onSaveToWiki={vi.fn()}
        hasWikiEntry={true}
      />
    )

    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)
    openAssistantActions()

    expect(screen.getByRole('menuitem', { name: 'Saved to wiki' })).toHaveClass('text-blue-600')
  })

  it('keeps frequent assistant actions visible and moves secondary actions into overflow', () => {
    render(
      <MessageBubble
        {...baseProps}
        role="assistant"
        onSaveToWiki={vi.fn()}
        onSaveAsArtifact={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Copy' })).toHaveAttribute('title', 'Copy response')
    expect(screen.queryByRole('menuitem', { name: 'Save to wiki' })).not.toBeInTheDocument()

    openAssistantActions()

    expect(screen.getByRole('menu', { name: 'Message actions' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Save to wiki' })).toHaveAttribute('title', 'Save to wiki')
    expect(screen.getByRole('menuitem', { name: 'Save as artifact' })).toHaveAttribute('title', 'Save as artifact')
    expect(screen.getByRole('menuitem', { name: 'Save to wiki' }).querySelector('svg')).toHaveClass('lucide-book-open')
    expect(screen.getByRole('menuitem', { name: 'Save as artifact' }).querySelector('svg')).toHaveClass('lucide-package')
  })

  it('shows regenerate action for last assistant message', () => {
    const onRegenerate = vi.fn()
    render(
      <MessageBubble
        {...baseProps}
        role="assistant"
        isLastAssistant={true}
        onRegenerate={onRegenerate}
      />
    )

    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)
    openAssistantActions()

    expect(screen.getByRole('menuitem', { name: 'Regenerate' })).toHaveAttribute('title', 'Regenerate')
  })

  it('shows choose model action for model_not_available errors', () => {
    const onPickModel = vi.fn()
    render(
      <MessageBubble
        {...baseProps}
        role="assistant"
        isError={true}
        errorType="model_not_available"
        retryable={false}
        onPickModel={onPickModel}
      />
    )
    expect(screen.getByText('Choose model')).toBeInTheDocument()
  })

  it('shows edit action for user messages', () => {
    const onEdit = vi.fn()
    render(<MessageBubble {...baseProps} onEdit={onEdit} />)

    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)

    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('title', 'Edit')
  })

  it('calls onEdit on user double-click', () => {
    const onEdit = vi.fn()
    render(<MessageBubble {...baseProps} onEdit={onEdit} />)
    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.doubleClick(container)
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('shows edited indicator for edited user message', () => {
    render(<MessageBubble {...baseProps} isEdited={true} />)
    expect(screen.getByText('edited')).toBeInTheDocument()
  })

  it('hides actions while generating', () => {
    render(<MessageBubble {...baseProps} isGenerating={true} />)

    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)

    expect(screen.queryByText('Copy')).not.toBeInTheDocument()
  })

  it('shows persistent BookOpen indicator for assistant messages linked to wiki entries', () => {
    render(
      <MessageBubble
        {...baseProps}
        role="assistant"
        onSaveToWiki={vi.fn()}
        hasWikiEntry={true}
      />
    )

    expect(screen.getAllByLabelText('Saved to wiki').length).toBeGreaterThan(0)
  })

  it('does not show BookOpen indicator when hasWikiEntry is false', () => {
    render(
      <MessageBubble
        {...baseProps}
        role="assistant"
        onSaveToWiki={vi.fn()}
        hasWikiEntry={false}
      />
    )

    expect(screen.queryByLabelText('Saved to wiki')).not.toBeInTheDocument()
  })
})

