import { describe, expect, it } from 'vitest'
import { markdownToTiptapDoc, tiptapDocToMarkdown } from '../lib/tiptap-markdown'

/** The composer's contract: editing in rendered mode must not rewrite the draft. */
const roundTrip = (markdown: string) => tiptapDocToMarkdown(markdownToTiptapDoc(markdown))

describe('tiptap-markdown round trip', () => {
  it.each([
    ['headings', '# Title\n\n## Subtitle'],
    ['paragraph with emphasis', 'Plain **bold** and *italic* and ~~struck~~ text.'],
    ['inline code', 'Call `npm run typecheck` first.'],
    ['links', 'See [the docs](https://example.com/a?b=c) for details.'],
    ['bullet list', '- one\n- two\n- three'],
    ['nested bullet list', '- one\n  - nested\n    - deeper\n- two'],
    ['ordered list', '1. first\n2. second\n3. third'],
    ['task list', '- [ ] todo\n- [x] done'],
    ['blockquote', '> quoted line\n> second line'],
    ['thematic break', 'before\n\n---\n\nafter'],
    ['gfm table', '| a | b |\n| - | - |\n| 1 | 2 |'],
  ])('preserves %s', (_label, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown)
  })

  it('preserves a fenced code block with its language', () => {
    const markdown = '```ts\nconst x: number = 1\n```'
    expect(roundTrip(markdown)).toBe(markdown)
  })

  it('keeps fenced code contents literal rather than parsing them as Markdown', () => {
    const doc = markdownToTiptapDoc('```\n# not a heading\n- not a list\n```')
    const codeBlock = doc.content?.[0]

    expect(codeBlock?.type).toBe('codeBlock')
    expect(codeBlock?.content?.[0]?.text).toBe('# not a heading\n- not a list')
  })

  it('escapes literal text so it does not become formatting on the next parse', () => {
    const doc = markdownToTiptapDoc('a *literal* star')
    // Replace the emphasis with plain text containing the markers.
    const plain = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a *literal* star' }] }] }

    expect(roundTrip(tiptapDocToMarkdown(plain))).toBe(tiptapDocToMarkdown(plain))
    expect(markdownToTiptapDoc(tiptapDocToMarkdown(plain)).content?.[0]?.content?.[0]?.text).toBe('a *literal* star')
    expect(doc.content?.[0]?.content?.[1]?.marks?.[0]?.type).toBe('italic')
  })

  it('maps marks onto the expected Tiptap schema nodes', () => {
    const doc = markdownToTiptapDoc('**bold** [link](https://x.dev)')
    const paragraph = doc.content?.[0]

    expect(paragraph?.content?.[0]).toMatchObject({ type: 'text', text: 'bold', marks: [{ type: 'bold' }] })
    expect(paragraph?.content?.[2]).toMatchObject({
      type: 'text',
      text: 'link',
      marks: [{ type: 'link', attrs: { href: 'https://x.dev' } }],
    })
  })

  it('coalesces split styled runs instead of re-opening the markers', () => {
    const markdown = tiptapDocToMarkdown({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'bo', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'ld', marks: [{ type: 'bold' }] },
        ],
      }],
    })

    expect(markdown).toBe('**bold**')
  })

  it('represents a hard break rather than dropping it', () => {
    expect(markdownToTiptapDoc('a  \nb').content?.[0]?.content?.[1]).toEqual({ type: 'hardBreak' })
    expect(roundTrip('a  \nb')).toBe('a\\\nb')
  })

  it('always yields a block so the editor has somewhere to put the caret', () => {
    expect(markdownToTiptapDoc('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(tiptapDocToMarkdown({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('')
  })

  it('round-trips images without escaping them into visible backslashes', () => {
    const markdown = '![alt text](https://example.com/i.png)'
    expect(roundTrip(markdown)).toBe(markdown)
  })

  it('keeps genuinely unsupported nodes as literal text instead of discarding them', () => {
    expect(roundTrip('Hello <abbr>HTML</abbr> world')).toContain('abbr')
  })

  it('preserves a mixed document end to end', () => {
    const markdown = [
      '# Report',
      '',
      'Summary with **bold** and a [link](https://example.com).',
      '',
      '- item one',
      '  - nested item',
      '- item two',
      '',
      '```js',
      'const a = 1',
      '```',
      '',
      '> a quote',
      '',
      '| col | val |',
      '| - | - |',
      '| x | 1 |',
    ].join('\n')

    expect(roundTrip(markdown)).toBe(markdown)
  })
})
