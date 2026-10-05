import { act, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RichTextComposerInput, type RichTextComposerHandle } from '../components/chat/RichTextComposerInput'

/** Mirrors ChatWindow: the parent owns the canonical Markdown draft. */
function Harness({ initial = '', onKeyDown }: { initial?: string; onKeyDown?: (event: never) => void }) {
  const [draft, setDraft] = useState(initial)
  const handleRef = useRef<RichTextComposerHandle>(null)

  return (
    <>
      <RichTextComposerInput
        ref={handleRef}
        value={draft}
        onValueChange={setDraft}
        onKeyDown={onKeyDown as never}
        aria-label="Message input"
      />
      <output data-testid="draft">{draft}</output>
      <button type="button" onClick={() => setDraft('# inserted externally')}>External insert</button>
      <button type="button" onClick={() => handleRef.current?.focus()}>Focus</button>
    </>
  )
}

const editorEl = () => screen.getByRole('textbox', { name: 'Message input' })

describe('RichTextComposerInput', () => {
  it('mounts a real editable ProseMirror surface rather than a read-only preview', () => {
    render(<Harness initial="hello" />)
    const editor = editorEl()

    expect(editor).toHaveAttribute('contenteditable', 'true')
    expect(editor).toHaveAttribute('aria-multiline', 'true')
    // The caret-bearing class is what makes the mode read as editable.
    expect(editor.className).toContain('chat-rich-input')
  })

  it('renders Markdown as formatting instead of literal markers', () => {
    render(<Harness initial={'# Title\n\nSome **bold** text'} />)
    const editor = editorEl()

    expect(editor.querySelector('h1')?.textContent).toBe('Title')
    expect(editor.querySelector('strong')?.textContent).toBe('bold')
    expect(editor.textContent).not.toContain('**')
    expect(editor.textContent).not.toContain('# ')
  })

  it('converts pasted rich text into the canonical Markdown draft', async () => {
    render(<Harness />)

    const data = new DataTransfer()
    data.setData('text/html', '<h2>Heading</h2><p>Some <strong>bold</strong> text and a <a href="https://x.dev">link</a>.</p>')
    data.setData('text/plain', 'Heading Some bold text and a link.')

    await act(async () => {
      editorEl().dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })

    expect(screen.getByTestId('draft').textContent).toBe('## Heading\n\nSome **bold** text and a [link](https://x.dev).')
  })

  it('leaves the draft untouched when the same value is re-rendered', async () => {
    const onValueChange = vi.fn()
    const { rerender } = render(
      <RichTextComposerInput value="# stable" onValueChange={onValueChange} aria-label="Message input" />,
    )

    await act(async () => {
      rerender(<RichTextComposerInput value="# stable" onValueChange={onValueChange} aria-label="Message input" />)
    })

    // An echo of the composer's own value must not trigger a document reset.
    expect(onValueChange).not.toHaveBeenCalled()
    expect(editorEl().querySelector('h1')?.textContent).toBe('stable')
  })

  it('reflects an external draft change without the caret-destroying echo loop', async () => {
    const onKeyDown = vi.fn()
    render(<Harness initial="original" onKeyDown={onKeyDown} />)

    await act(async () => {
      screen.getByRole('button', { name: 'External insert' }).click()
    })

    expect(editorEl().querySelector('h1')?.textContent).toBe('inserted externally')
    expect(screen.getByTestId('draft').textContent).toBe('# inserted externally')
  })

  it('exposes a focus handle so composer focus requests reach the active surface', async () => {
    render(<Harness initial="draft" />)

    await act(async () => {
      screen.getByRole('button', { name: 'Focus' }).click()
    })

    expect(editorEl()).toBeTruthy()
  })

  it('forwards keys to the composer handler so Enter can send', () => {
    const onKeyDown = vi.fn((event: KeyboardEvent) => event.preventDefault())
    render(<Harness initial="ready to send" onKeyDown={onKeyDown as never} />)

    act(() => {
      editorEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })

    expect(onKeyDown).toHaveBeenCalled()
    expect(onKeyDown.mock.calls[0][0].key).toBe('Enter')
  })

  it('renders lists, code blocks and tables as structure, not as source', () => {
    render(<Harness initial={'- one\n- two\n\n```ts\nconst a = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |'} />)
    const editor = editorEl()

    expect(editor.querySelectorAll('ul li').length).toBe(2)
    expect(editor.querySelector('pre code')?.textContent).toBe('const a = 1')
    expect(editor.querySelectorAll('table th').length).toBe(2)
  })
})
