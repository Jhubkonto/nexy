/**
 * Markdown is the composer's single canonical draft format. The rendered
 * (WYSIWYG) composer edits a Tiptap/ProseMirror document instead, so every
 * keystroke has to serialise back to exactly the Markdown the send path,
 * draft cache, and slash-command matcher already expect.
 *
 * Both directions route through mdast so escaping, nested-list indentation and
 * GFM tables come from the same battle-tested remark stack that renders sent
 * messages, rather than from hand-rolled string concatenation.
 */
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { toMarkdown } from 'mdast-util-to-markdown'
import type { JSONContent } from '@tiptap/react'
import type { Nodes as MdastNodes, Parent as MdastParent, PhrasingContent, RootContent, TableCell, TableRow } from 'mdast'

/** The Tiptap/ProseMirror JSON document shape, re-exported for call sites. */
export type TiptapNode = JSONContent

const asRecord = (attrs: TiptapNode['attrs']): Record<string, unknown> => attrs ?? {}

// ---------------------------------------------------------------------------
// Markdown -> Tiptap
// ---------------------------------------------------------------------------

function parseMarkdown(markdown: string): MdastNodes {
  return fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
}

/**
 * Nodes the composer schema cannot represent (images, raw HTML, footnotes, …)
 * survive as literal Markdown text so a round trip never silently drops the
 * user's content.
 */
function literalText(node: MdastNodes): TiptapNode[] {
  const markdown = toMarkdown(node as RootContent, { extensions: [gfmToMarkdown()] }).trim()
  return markdown ? [{ type: 'text', text: markdown }] : []
}

function inlineToTiptap(nodes: PhrasingContent[], marks: TiptapNode['marks'] = []): TiptapNode[] {
  const out: TiptapNode[] = []

  const withMark = (type: string, attrs?: Record<string, unknown>) => [...(marks ?? []), { type, ...(attrs ? { attrs } : {}) }]

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        if (node.value) out.push({ type: 'text', text: node.value, ...(marks?.length ? { marks } : {}) })
        break
      case 'strong':
        out.push(...inlineToTiptap(node.children, withMark('bold')))
        break
      case 'emphasis':
        out.push(...inlineToTiptap(node.children, withMark('italic')))
        break
      case 'delete':
        out.push(...inlineToTiptap(node.children, withMark('strike')))
        break
      case 'inlineCode':
        out.push({ type: 'text', text: node.value, marks: withMark('code') })
        break
      case 'link':
        out.push(...inlineToTiptap(node.children, withMark('link', { href: node.url, ...(node.title ? { title: node.title } : {}) })))
        break
      case 'break':
        out.push({ type: 'hardBreak' })
        break
      case 'image':
        out.push({
          type: 'image',
          attrs: { src: node.url, alt: node.alt ?? null, title: node.title ?? null },
        })
        break
      default:
        out.push(...literalText(node).map((text) => (marks?.length ? { ...text, marks } : text)))
    }
  }

  return out
}

function cellToTiptap(cell: TableCell, header: boolean): TiptapNode {
  const inline = inlineToTiptap(cell.children)
  return {
    type: header ? 'tableHeader' : 'tableCell',
    content: [{ type: 'paragraph', ...(inline.length ? { content: inline } : {}) }],
  }
}

function rowToTiptap(row: TableRow, header: boolean): TiptapNode {
  return { type: 'tableRow', content: row.children.map((cell) => cellToTiptap(cell, header)) }
}

function blocksToTiptap(nodes: RootContent[]): TiptapNode[] {
  const out: TiptapNode[] = []

  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph': {
        const inline = inlineToTiptap(node.children)
        out.push({ type: 'paragraph', ...(inline.length ? { content: inline } : {}) })
        break
      }
      case 'heading': {
        const inline = inlineToTiptap(node.children)
        out.push({ type: 'heading', attrs: { level: node.depth }, ...(inline.length ? { content: inline } : {}) })
        break
      }
      case 'code':
        out.push({
          type: 'codeBlock',
          attrs: { language: node.lang ?? null },
          ...(node.value ? { content: [{ type: 'text', text: node.value }] } : {}),
        })
        break
      case 'blockquote':
        out.push({ type: 'blockquote', content: blocksToTiptap(node.children) })
        break
      case 'thematicBreak':
        out.push({ type: 'horizontalRule' })
        break
      case 'list': {
        // A list is a task list when any item carries a checkbox; mdast models
        // that per item, Tiptap models it per list.
        const isTask = node.children.some((item) => typeof item.checked === 'boolean')
        const items = node.children.map((item) => {
          const content = blocksToTiptap(item.children)
          const body = content.length ? content : [{ type: 'paragraph' }]
          return isTask
            ? { type: 'taskItem', attrs: { checked: item.checked === true }, content: body }
            : { type: 'listItem', content: body }
        })

        if (isTask) out.push({ type: 'taskList', content: items })
        else if (node.ordered) out.push({ type: 'orderedList', attrs: { start: node.start ?? 1 }, content: items })
        else out.push({ type: 'bulletList', content: items })
        break
      }
      case 'table': {
        const [header, ...body] = node.children
        const rows = [
          ...(header ? [rowToTiptap(header, true)] : []),
          ...body.map((row) => rowToTiptap(row, false)),
        ]
        if (rows.length) out.push({ type: 'table', content: rows })
        break
      }
      default: {
        const inline = literalText(node)
        if (inline.length) out.push({ type: 'paragraph', content: inline })
      }
    }
  }

  return out
}

/** Builds the Tiptap document for a Markdown draft. */
export function markdownToTiptapDoc(markdown: string): TiptapNode {
  const root = parseMarkdown(markdown ?? '')
  const content = blocksToTiptap((root as MdastParent).children as RootContent[])
  // ProseMirror requires at least one block, otherwise the editor has nowhere
  // to put the caret.
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

// ---------------------------------------------------------------------------
// Tiptap -> Markdown
// ---------------------------------------------------------------------------

function textToMdast(node: TiptapNode): PhrasingContent {
  let result: PhrasingContent = { type: 'text', value: node.text ?? '' }
  const markTypes = new Set((node.marks ?? []).map((mark) => mark.type))

  // Innermost first: code must hug the text, the link has to end up outermost
  // so its label carries the other marks.
  if (markTypes.has('code')) result = { type: 'inlineCode', value: node.text ?? '' }
  if (markTypes.has('strike')) result = { type: 'delete', children: [result] }
  if (markTypes.has('italic')) result = { type: 'emphasis', children: [result] }
  if (markTypes.has('bold')) result = { type: 'strong', children: [result] }

  const link = (node.marks ?? []).find((mark) => mark.type === 'link')
  if (link) {
    const attrs = asRecord(link.attrs)
    result = {
      type: 'link',
      url: typeof attrs.href === 'string' ? attrs.href : '',
      ...(typeof attrs.title === 'string' && attrs.title ? { title: attrs.title } : {}),
      children: [result],
    }
  }

  return result
}

const markKey = (node: TiptapNode) =>
  JSON.stringify((node.marks ?? []).map((mark) => [mark.type, asRecord(mark.attrs)]))

function inlineToMdast(nodes: TiptapNode[] = []): PhrasingContent[] {
  const out: PhrasingContent[] = []
  // Tiptap can split a styled run across several text nodes. Coalescing runs
  // that share identical marks keeps the serialiser from emitting `**a****b**`.
  const runs: TiptapNode[] = []

  for (const node of nodes) {
    const previous = runs[runs.length - 1]
    if (node.type === 'text' && previous?.type === 'text' && markKey(previous) === markKey(node)) {
      runs[runs.length - 1] = { ...previous, text: `${previous.text ?? ''}${node.text ?? ''}` }
      continue
    }
    runs.push(node)
  }

  for (const node of runs) {
    if (node.type === 'hardBreak') {
      out.push({ type: 'break' })
      continue
    }
    if (node.type === 'image') {
      const attrs = asRecord(node.attrs)
      out.push({
        type: 'image',
        url: typeof attrs.src === 'string' ? attrs.src : '',
        ...(typeof attrs.alt === 'string' && attrs.alt ? { alt: attrs.alt } : {}),
        ...(typeof attrs.title === 'string' && attrs.title ? { title: attrs.title } : {}),
      })
      continue
    }
    if (node.type !== 'text') continue

    out.push(textToMdast(node))
  }

  return out
}

function cellToMdast(node: TiptapNode): TableCell {
  // Tables are inline-only in GFM, so nested blocks collapse into one cell line.
  const inline = (node.content ?? []).flatMap((child, index) => {
    const content = child.type === 'paragraph' || child.type === 'heading' ? inlineToMdast(child.content) : inlineToMdast([child])
    return index > 0 && content.length ? [{ type: 'text', value: ' ' } as PhrasingContent, ...content] : content
  })
  return { type: 'tableCell', children: inline }
}

function blocksToMdast(nodes: TiptapNode[] = []): RootContent[] {
  const out: RootContent[] = []

  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph':
        out.push({ type: 'paragraph', children: inlineToMdast(node.content) })
        break
      case 'heading':
        out.push({
          type: 'heading',
          depth: (Number(asRecord(node.attrs).level) || 1) as 1 | 2 | 3 | 4 | 5 | 6,
          children: inlineToMdast(node.content),
        })
        break
      case 'codeBlock': {
        const language = asRecord(node.attrs).language
        out.push({
          type: 'code',
          lang: typeof language === 'string' && language ? language : null,
          value: (node.content ?? []).map((child) => child.text ?? '').join(''),
        })
        break
      }
      case 'blockquote':
        out.push({ type: 'blockquote', children: blocksToMdast(node.content) as never })
        break
      case 'horizontalRule':
        out.push({ type: 'thematicBreak' })
        break
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        const ordered = node.type === 'orderedList'
        const start = Number(asRecord(node.attrs).start)
        out.push({
          type: 'list',
          ordered,
          start: ordered ? (Number.isFinite(start) && start > 0 ? start : 1) : null,
          spread: false,
          children: (node.content ?? []).map((item) => ({
            type: 'listItem' as const,
            spread: false,
            checked: item.type === 'taskItem' ? asRecord(item.attrs).checked === true : null,
            children: blocksToMdast(item.content) as never,
          })),
        })
        break
      }
      case 'table': {
        const rows = (node.content ?? []).map((row) => ({
          type: 'tableRow' as const,
          children: (row.content ?? []).map(cellToMdast),
        }))
        if (rows.length) out.push({ type: 'table', align: [], children: rows })
        break
      }
      case 'image':
        // Tolerated at block level in case the schema is configured with a
        // non-inline image node.
        out.push({ type: 'paragraph', children: inlineToMdast([node]) })
        break
      default:
        if (node.content?.length) out.push(...blocksToMdast(node.content))
        else if (node.text) out.push({ type: 'paragraph', children: [{ type: 'text', value: node.text }] })
    }
  }

  return out
}

/** Serialises the editor document back to the canonical Markdown draft. */
export function tiptapDocToMarkdown(doc: TiptapNode | null | undefined): string {
  if (!doc) return ''

  const children = blocksToMdast(doc.content)
  if (!children.length) return ''

  return toMarkdown(
    { type: 'root', children },
    {
      // tablePipeAlign off keeps tables in the compact form people actually
      // type, so toggling Raw -> Rendered -> Raw does not re-pad their cells.
      extensions: [gfmToMarkdown({ tablePipeAlign: false })],
      bullet: '-',
      emphasis: '*',
      strong: '*',
      fences: true,
      rule: '-',
    },
  ).trimEnd()
}
