import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { MAX_CONVERSATION_TITLE_LENGTH } from '../../shared/conversation-title'
import { Button, ModalShell } from './ui/primitives'

interface RenameConversationDialogProps {
  conversationTitle: string
  onConfirm: (title: string) => Promise<boolean | void> | boolean | void
  onCancel: () => void
}

export function RenameConversationDialog({ conversationTitle, onConfirm, onCancel }: RenameConversationDialogProps) {
  const [title, setTitle] = useState(conversationTitle)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  const confirm = async () => {
    const normalized = title.trim()
    if (!normalized) return
    setBusy(true)
    try {
      const saved = await onConfirm(normalized)
      if (saved !== false) onCancel()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title="Rename chat"
      ariaLabel="Rename chat"
      maxWidth="max-w-md"
      height=""
      compactHeader
      panelClassName="rounded-nexy-lg border-nexy-border shadow-nexy"
      bodyClassName="p-5"
      footerClassName="bg-nexy-surface px-5 py-3"
      onClose={busy ? () => {} : onCancel}
      footer={(
        <>
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => { void confirm() }} disabled={busy || !title.trim()}>
            {busy ? 'Saving…' : 'Rename'}
          </Button>
        </>
      )}
    >
      <label className="block text-sm font-medium text-nexy-text" htmlFor="conversation-title">
        Chat title
        <input
          ref={inputRef}
          id="conversation-title"
          value={title}
          maxLength={MAX_CONVERSATION_TITLE_LENGTH}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void confirm() } }}
          className="mt-2 w-full rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised px-3 py-2 text-sm text-nexy-text outline-none focus:border-nexy-accent"
        />
      </label>
      <p className="mt-1 text-[11px] text-nexy-muted">Titles are limited to {MAX_CONVERSATION_TITLE_LENGTH} characters.</p>
    </ModalShell>
  )
}

export function RenameConversationButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onClick() }}
      className="p-1 rounded-nexy-sm text-nexy-muted hover:text-nexy-accent hover:bg-nexy-recessed"
      title="Rename"
      aria-label="Rename conversation"
    >
      <Pencil className="w-3 h-3" />
    </button>
  )
}
