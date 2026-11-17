import { useEffect, useRef, useState } from 'react'
import { useClickOutside } from '../../hooks/useClickOutside'
import { NexyIcon, type NexyIconName } from '../ui/icons/NexyIcon'

interface ComposerActionsMenuProps {
  disabled?: boolean
  imageHint?: string
  showContextInspector: boolean
  onAttachFiles: () => void | Promise<void>
  onAttachFolder: () => void | Promise<void>
  onPasteClipboardImage?: () => void | Promise<void>
  onOpenPromptLibrary?: () => void
  onAttachArtifact?: () => void
  onToggleContextInspector: () => void
}

interface MenuAction {
  label: string
  icon: NexyIconName
  disabled?: boolean
  title?: string
  onSelect: () => void | Promise<void>
}

export function ComposerActionsMenu({
  disabled = false,
  imageHint,
  showContextInspector,
  onAttachFiles,
  onAttachFolder,
  onPasteClipboardImage,
  onOpenPromptLibrary,
  onAttachArtifact,
  onToggleContextInspector,
}: ComposerActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useClickOutside([buttonRef, menuRef], () => setOpen(false), open)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const actions: MenuAction[] = [
    { label: 'Attach files', icon: 'attach', disabled, title: imageHint, onSelect: onAttachFiles },
    { label: 'Attach folder', icon: 'folder', disabled, onSelect: onAttachFolder },
    ...(onPasteClipboardImage
      ? [{ label: 'Paste image from clipboard', icon: 'clipboard' as const, disabled, onSelect: onPasteClipboardImage }]
      : []),
    ...(onOpenPromptLibrary
      ? [{ label: 'Insert prompt', icon: 'prompt' as const, disabled, onSelect: onOpenPromptLibrary }]
      : []),
    ...(onAttachArtifact
      ? [{ label: 'Attach artifact', icon: 'artifact' as const, disabled, onSelect: onAttachArtifact }]
      : []),
    {
      label: showContextInspector ? 'Close context inspector' : 'Open context inspector',
      icon: 'inspect',
      onSelect: onToggleContextInspector,
    },
  ]

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`rounded-nexy-sm border p-1.5 transition-colors ${
          open || showContextInspector
            ? 'border-nexy-border bg-nexy-raised text-nexy-text shadow-nexy'
            : 'border-transparent text-nexy-muted hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text'
        }`}
        title="More message actions"
        aria-label="More message actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <NexyIcon name="menu" className="h-4 w-4" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Message actions"
          className="absolute bottom-full left-0 z-30 mb-1 min-w-52 rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised p-1 text-nexy-text shadow-nexy"
        >
          {actions.map(({ label, icon, disabled: actionDisabled, onSelect, title }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              title={title}
              disabled={actionDisabled}
              className="flex w-full items-center gap-2 rounded-nexy-sm border border-transparent px-2 py-1.5 text-left text-xs hover:border-nexy-border hover:bg-nexy-recessed disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                setOpen(false)
                void onSelect()
              }}
            >
              <NexyIcon name={icon} className="h-3.5 w-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
