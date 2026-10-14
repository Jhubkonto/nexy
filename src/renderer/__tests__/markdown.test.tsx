import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MarkdownRenderer } from '../../renderer/components/MarkdownRenderer'
import { setupMockApi } from '../../test/mocks/api'
import { useAppStore } from '../../renderer/store/app-store'

// Mock clipboard API
beforeEach(() => {
  setupMockApi()
  useAppStore.setState({ toasts: [] })
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true
  })
})

describe('MarkdownRenderer', () => {
  it('renders plain text', () => {
    render(<MarkdownRenderer content="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders bold and italic text', () => {
    render(<MarkdownRenderer content="**bold** and *italic*" />)
    expect(screen.getByText('bold')).toBeInTheDocument()
    expect(screen.getByText('italic')).toBeInTheDocument()
  })

  it('renders links with target=_blank', () => {
    render(<MarkdownRenderer content="[Click me](https://example.com)" />)
    const link = screen.getByText('Click me')
    expect(link.closest('a')).toHaveAttribute('target', '_blank')
    expect(link.closest('a')).toHaveAttribute('href', 'https://example.com')
  })

  it('turns metadata-backed provider citation IDs into clickable sources', () => {
    render(<MarkdownRenderer
      content="According to CiteTurn1view0, the result is available."
      citations={[{ id: 'CiteTurn1view0', title: 'Example source', url: 'https://example.com/source' }]}
    />)
    const links = document.querySelectorAll('a[href="https://example.com/source"]')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveTextContent('1')
    expect(links[1]).toHaveTextContent('Example source')
  })

  it('reveals a local generated file and reports when it is unavailable', async () => {
    const api = setupMockApi()
    api.appOpenPath.mockResolvedValueOnce({ ok: false, error: 'File or folder not found' })
    render(<MarkdownRenderer content="[Generated archive](/C:/work/archive.zip)" />)

    fireEvent.click(screen.getByRole('button', { name: 'Generated archive — show local file in folder' }))

    await waitFor(() => expect(api.appOpenPath).toHaveBeenCalledWith('C:/work/archive.zip'))
    expect(useAppStore.getState().toasts).toContainEqual(expect.objectContaining({
      type: 'error',
      message: "Couldn't open local file: File or folder not found",
    }))
  })

  it('preserves literal Markdown in raw mode', () => {
    const source = '# Heading\n\n**bold**\n```ts\nconst value = 1\n```'
    const { container } = render(<MarkdownRenderer content={source} viewMode="raw" citations={[{ id: 'CiteTurn1', url: 'https://example.com' }]} />)
    expect(container.querySelector('h1')).not.toBeInTheDocument()
    expect(container.querySelector('code')).not.toBeInTheDocument()
    expect(container.querySelector('a')).not.toBeInTheDocument()
    expect(container.querySelector('pre')?.textContent).toBe(source)
  })

  it('hides unresolved provider citation markers instead of showing internal tokens', () => {
    render(<MarkdownRenderer content="A useful answer CiteTurn0search0【citeTurn1search2†turn1search2】 continues." />)
    expect(screen.getByText('A useful answer continues.')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('CiteTurn0search0')
    expect(document.body).not.toHaveTextContent('citeTurn1search2')
  })

  it('renders code blocks with pre wrapper', () => {
    render(<MarkdownRenderer content={'```js\nconsole.log("hi")\n```'} />)
    const pre = document.querySelector('pre')
    expect(pre).toBeInTheDocument()
  })

  it('renders inline code', () => {
    render(<MarkdownRenderer content="Use `npm install` to install" />)
    const code = screen.getByText('npm install')
    expect(code.tagName).toBe('CODE')
  })

  it('renders tables', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    render(<MarkdownRenderer content={md} />)
    expect(document.querySelector('table')).toBeInTheDocument()
  })

  it('renders lists', () => {
    const md = `- Item 1
- Item 2
- Item 3`
    const { container } = render(<MarkdownRenderer content={md} />)
    const listItems = container.querySelectorAll('li')
    expect(listItems.length).toBeGreaterThanOrEqual(1)
    expect(container.querySelector('ul')).toBeInTheDocument()
  })

  it('has copy button on code blocks', () => {
    render(<MarkdownRenderer content={'```\nsome code\n```'} />)
    const copyBtn = screen.getByText('Copy')
    expect(copyBtn).toBeInTheDocument()
  })

  it('renders strikethrough text', () => {
    const { container } = render(<MarkdownRenderer content="~~struck~~" />)
    expect(container.querySelector('del')).toBeInTheDocument()
    expect(container.querySelector('del')).toHaveTextContent('struck')
  })

  it('renders task list checkboxes', () => {
    const md = '- [ ] todo\n- [x] done'
    const { container } = render(<MarkdownRenderer content={md} />)
    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    expect(checkboxes.length).toBe(2)
    expect(checkboxes[0]).toBeDisabled()
    expect(checkboxes[0]).not.toBeChecked()
    expect(checkboxes[1]).toBeDisabled()
    expect(checkboxes[1]).toBeChecked()
  })

  it('renders blockquotes', () => {
    const { container } = render(<MarkdownRenderer content="> quoted text" />)
    const blockquote = container.querySelector('blockquote')
    expect(blockquote).toBeInTheDocument()
    expect(blockquote).toHaveTextContent('quoted text')
  })

  it('renders headings with correct tags', () => {
    const { container } = render(<MarkdownRenderer content={'# H1\n## H2'} />)
    expect(container.querySelector('h1')).toBeInTheDocument()
    expect(container.querySelector('h2')).toBeInTheDocument()
  })

  it('renders images with alt attribute', () => {
    const { container } = render(<MarkdownRenderer content="![a diagram](diagram.png)" />)
    const img = container.querySelector('img')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('alt', 'a diagram')
    expect(img).toHaveAttribute('src', 'diagram.png')
  })
})
