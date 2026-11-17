import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { getModelLabel, sourceQualifiedModel } from '../../../shared/models'
import type { AvailableModelEntry, AvailableModelGroup, CatalogModel } from '../../../shared/types'
import { useClickOutside } from '../../hooks/useClickOutside'

interface ModelPickerProps {
  value: string
  sourceLabel?: string
  availableGroups: AvailableModelGroup[]
  catalogModels: CatalogModel[]
  globalDefaultModel?: string
  includeDefault?: boolean
  buttonRef?: RefObject<HTMLButtonElement | null>
  buttonClassName?: string
  menuClassName?: string
  emptyLabel?: string
  onSelectDefault?: () => void
  onSelectAvailableModel: (group: AvailableModelGroup, model: AvailableModelEntry) => void
}

const MENU_WIDTH = 288
const MENU_MAX_HEIGHT = 320
const MENU_MARGIN = 4

export function ModelPicker({
  value,
  sourceLabel,
  availableGroups,
  catalogModels,
  globalDefaultModel,
  includeDefault = true,
  buttonRef,
  buttonClassName = 'flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 px-1.5 py-1 rounded-md transition-colors max-w-[220px]',
  menuClassName = '',
  emptyLabel = 'No models configured',
  onSelectDefault,
  onSelectAvailableModel,
}: ModelPickerProps) {
  const selectedGroup = availableGroups.find((group) => group.models.some((model) => sourceQualifiedModel(group.sourceKey, model.id) === value))
  const selectedEntry = selectedGroup?.models.find((model) => sourceQualifiedModel(selectedGroup.sourceKey, model.id) === value)
  const modelLabel = selectedEntry ? (getModelLabel(selectedEntry.id, catalogModels) === selectedEntry.id ? selectedEntry.label : getModelLabel(selectedEntry.id, catalogModels)) : getModelLabel(value, catalogModels, globalDefaultModel)
  const displaySource = sourceLabel ?? selectedGroup?.sourceLabel
  const fullButtonLabel = displaySource ? `${modelLabel} · via ${displaySource}` : modelLabel
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const internalButtonRef = useRef<HTMLButtonElement | null>(null)
  const resolvedButtonRef = buttonRef ?? internalButtonRef
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const alignRight = menuClassName.includes('left-0')
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; openUpward: boolean } | null>(null)

  useEffect(() => {
    if (!showModelMenu) { setModelSearch(''); setOpenGroup(null) }
  }, [showModelMenu])
  useClickOutside([modelMenuRef, resolvedButtonRef], () => setShowModelMenu(false), showModelMenu)
  useEffect(() => {
    if (!showModelMenu) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (openGroup) setOpenGroup(null)
        else { setShowModelMenu(false); resolvedButtonRef.current?.focus() }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showModelMenu, openGroup, resolvedButtonRef])

  useLayoutEffect(() => {
    if (!showModelMenu || !resolvedButtonRef.current) {
      setMenuPosition(null)
      return
    }
    const computePosition = () => {
      const rect = resolvedButtonRef.current!.getBoundingClientRect()
      const openUpward = rect.bottom + MENU_MAX_HEIGHT > window.innerHeight && rect.top - MENU_MAX_HEIGHT > 0
      const left = alignRight
        ? rect.left
        : Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - MENU_MARGIN)
      const top = openUpward ? rect.top - MENU_MARGIN : rect.bottom + MENU_MARGIN
      setMenuPosition({ top, left: Math.max(left, MENU_MARGIN), openUpward })
    }
    computePosition()
    window.addEventListener('resize', computePosition)
    window.addEventListener('scroll', computePosition, true)
    return () => {
      window.removeEventListener('resize', computePosition)
      window.removeEventListener('scroll', computePosition, true)
    }
  }, [showModelMenu, alignRight, resolvedButtonRef])

  return (
    <div className="relative flex items-center">
      <button
        ref={resolvedButtonRef}
        type="button"
        aria-label={`Conversation model: ${fullButtonLabel}`}
        title={fullButtonLabel}
        className={buttonClassName}
        onClick={() => setShowModelMenu((prev) => !prev)}
      >
        <span className="min-w-0 max-w-[140px] truncate">{modelLabel}</span>
        {displaySource && (
          <span className="shrink-0 text-gray-400 dark:text-gray-500 opacity-80">· {displaySource}</span>
        )}
        <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
      </button>
      {showModelMenu && menuPosition && createPortal(
        <div
          ref={modelMenuRef}
          data-model-picker-menu
          style={{
            position: 'fixed',
            top: menuPosition.openUpward ? undefined : menuPosition.top,
            bottom: menuPosition.openUpward ? window.innerHeight - menuPosition.top : undefined,
            left: menuPosition.left,
            width: MENU_WIDTH,
            maxHeight: MENU_MAX_HEIGHT,
          }}
          className={`z-50 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg flex flex-col ${menuClassName}`}
        >
          <div className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 border-b border-gray-100 dark:border-gray-700">Active: {fullButtonLabel}</div>
          <div className="p-1.5 border-b border-gray-100 dark:border-gray-700">
            <input
              autoFocus
              type="text"
              placeholder="Search models..."
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              className="w-full px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div className="overflow-auto max-h-64 p-1">
            {includeDefault && !modelSearch && (
              <button
                type="button"
                className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${'default' === value ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setShowModelMenu(false)
                  onSelectDefault?.()
                }}
              >
                {globalDefaultModel && globalDefaultModel !== 'default'
                  ? `Global default (${getModelLabel(globalDefaultModel, catalogModels)})`
                  : 'Global default'}
              </button>
            )}
            {availableGroups.length === 0 && (
              <p className="px-2 py-2 text-xs text-gray-400 dark:text-gray-500">{emptyLabel}</p>
            )}
            {availableGroups.map((group) => {
              const q = modelSearch.trim().toLowerCase()
              const matchesProvider = group.sourceLabel.toLowerCase().includes(q)
              const filteredModels = !q || matchesProvider ? group.models : group.models.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
              if (!filteredModels.length) return null
              const groupKey = `${group.sourceType}:${group.sourceKey}`
              return (
                <div key={groupKey}>
                  <button type="button" aria-expanded={openGroup === groupKey}
                    className="w-full text-left px-2 py-2 rounded text-xs flex justify-between text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    onClick={() => setOpenGroup(openGroup === groupKey ? null : groupKey)}>
                    <span>{group.sourceLabel}</span><ChevronRight className="w-3 h-3" aria-hidden="true" />
                  </button>
                  {openGroup === groupKey && (
                    <div className="fixed z-50 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-auto p-1"
                      style={{ width: MENU_WIDTH, maxHeight: MENU_MAX_HEIGHT, left: menuPosition.left + MENU_WIDTH * 2 + MENU_MARGIN <= window.innerWidth ? menuPosition.left + MENU_WIDTH : Math.max(MENU_MARGIN, menuPosition.left - MENU_WIDTH), top: menuPosition.openUpward ? undefined : menuPosition.top, bottom: menuPosition.openUpward ? window.innerHeight - menuPosition.top : undefined }}>
                      <div className="px-2 py-2 text-xs font-medium text-gray-500">{group.sourceLabel}</div>
                      {filteredModels.map((model) => (
                        <button key={model.id} type="button"
                          className={`w-full text-left px-2 py-1.5 rounded text-xs flex justify-between gap-2 ${(selectedGroup ? group === selectedGroup && sourceQualifiedModel(group.sourceKey, model.id) === value : model.id === value) ? 'bg-gray-100 dark:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-700'} text-gray-700 dark:text-gray-200`}
                          onClick={(event) => { event.preventDefault(); event.stopPropagation(); setShowModelMenu(false); onSelectAvailableModel(group, model) }}>
                          <span className="min-w-0 truncate">{getModelLabel(model.id, catalogModels) !== model.id ? getModelLabel(model.id, catalogModels) : model.label}</span>
                          {model.source === 'legacy-candidate' && <span className="text-[9px] text-amber-600 shrink-0">Verify on first use</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {modelSearch && availableGroups.every((g) => !g.sourceLabel.toLowerCase().includes(modelSearch.toLowerCase()) && !g.models.some((m) => m.id.toLowerCase().includes(modelSearch.toLowerCase()) || m.label.toLowerCase().includes(modelSearch.toLowerCase()))) && (
              <p className="px-2 py-2 text-xs text-gray-400">No models match "{modelSearch}"</p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
