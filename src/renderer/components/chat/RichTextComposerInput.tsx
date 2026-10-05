import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extensions'
import { markdownToTiptapDoc, tiptapDocToMarkdown } from '../../lib/tiptap-markdown'
import type { ComposerKeyEvent } from '../../hooks/chat-types'

export interface RichTextComposerHandle {
  focus: () => void
  isEmpty: () => boolean
}

interface RichTextComposerInputProps {
  /** The canonical Markdown draft. */
  value: string
  onValueChange: (markdown: string) => void
  onKeyDown?: (event: ComposerKeyEvent) => void
  placeholder?: string
  disabled?: boolean
  'aria-label'?: string
}

/**
 * The rendered (WYSIWYG) chat composer. A real ProseMirror editor owns this DOM,
 * so the caret, selection, undo/redo, IME, and rich paste are all native
 * behaviour rather than something we simulate.
 *
 * Markdown remains the single canonical draft: the document is serialised to
 * Markdown on every transaction, and the incoming `value` is only pushed back
 * into the editor when it changes from somewhere else (conversation switch,
 * voice insert, prompt insert). Without that guard the composer's own keystrokes
 * would round-trip and reset the caret on every character.
 */
export const RichTextComposerInput = forwardRef<RichTextComposerHandle, RichTextComposerInputProps>(
  function RichTextComposerInput({ value, onValueChange, onKeyDown, placeholder, disabled = false, 'aria-label': ariaLabel }, ref) {
    const lastSerializedMarkdownRef = useRef(value)
    // useEditor captures its options once, so the live callbacks are reached
    // through refs rather than being frozen at mount.
    const onValueChangeRef = useRef(onValueChange)
    const onKeyDownRef = useRef(onKeyDown)
    const valueRef = useRef(value)
    onValueChangeRef.current = onValueChange
    onKeyDownRef.current = onKeyDown
    valueRef.current = value

    const editor = useEditor({
      editable: !disabled,
      extensions: [
        StarterKit.configure({
          // Markdown has no underline, and emitting raw HTML would break the
          // draft contract.
          underline: false,
          link: { openOnClick: false, autolink: true },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        TableKit.configure({ table: { resizable: false } }),
        Image.configure({ inline: true, allowBase64: true }),
        Placeholder.configure({ placeholder: placeholder ?? '' }),
      ],
      content: markdownToTiptapDoc(value),
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
          class: 'chat-rich-input min-h-10 max-h-[400px] overflow-y-auto px-4 pb-2 pt-3 focus:outline-none',
        },
        // Routed through ProseMirror rather than a React bubble-phase handler so
        // the composer can consume a key before the editor acts on it. Enter
        // must send instead of inserting a paragraph break.
        handleKeyDown: (_view, event) => {
          onKeyDownRef.current?.(event)
          return event.defaultPrevented
        },
      },
      onUpdate: ({ editor: instance }) => {
        const markdown = tiptapDocToMarkdown(instance.getJSON())
        lastSerializedMarkdownRef.current = markdown
        // Mounting and loading content emit a transaction of their own. Without
        // this the composer would rewrite the user's draft on entering rendered
        // mode even though nothing was edited.
        if (markdown === valueRef.current) return
        onValueChangeRef.current(markdown)
      },
    })

    // Reflect external draft changes without disturbing in-progress typing.
    useEffect(() => {
      if (!editor) return
      if (value === lastSerializedMarkdownRef.current) return

      lastSerializedMarkdownRef.current = value
      editor.commands.setContent(markdownToTiptapDoc(value), { emitUpdate: false })
    }, [editor, value])

    useEffect(() => {
      editor?.setEditable(!disabled)
    }, [editor, disabled])

    useImperativeHandle(ref, () => ({
      focus: () => editor?.commands.focus('end'),
      isEmpty: () => editor?.isEmpty ?? true,
    }), [editor])

    return (
      <div
        className="markdown-body prose prose-sm dark:prose-invert max-w-none break-words text-sm text-nexy-text
          prose-p:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5
          prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold first:prose-headings:mt-0
          prose-h1:text-base prose-h2:text-[0.95rem] prose-h3:text-sm prose-h4:text-sm
          prose-blockquote:border-l-2 prose-blockquote:px-3 prose-blockquote:py-0.5 prose-blockquote:not-italic
          prose-del:text-nexy-muted"
      >
        <EditorContent editor={editor} />
      </div>
    )
  },
)
