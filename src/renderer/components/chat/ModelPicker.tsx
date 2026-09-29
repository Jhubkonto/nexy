import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { getModelLabel } from '../../../shared/models'
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
  const modelLabel = getModelLabel(value, catalogModels, globalDefaultModel)
  const fullButtonLabel = sourceLabel ? `${modelLabel} · via ${sourceLabel}` : modelLabel
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const internalButtonRef = useRef<HTMLButtonElement | null>(null)
  const resolvedButtonRef = buttonRef ?? internalButtonRef
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const alignRight = menuClassName.includes('left-0')
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; openUpward: boolean } | null>(null)

  useEffect(() => {
    if (!showModelMenu) setModelSearch('')
  }, [showModelMenu])
  useClickOutside([modelMenuRef, resolvedButtonRef], () => setShowModelMenu(false), showModelMenu)

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
        {sourceLabel && (
          <span className="shrink-0 text-gray-400 dark:text-gray-500 opacity-80">· {sourceLabel}</span>
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
              const q = modelSearch.toLowerCase()
              const filteredModels = q
                ? group.models.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
                : group.models
              if (filteredModels.length === 0) return null
              return (
                <div key={group.sourceKey}>
                  <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 mt-0.5">
                    {group.sourceLabel}
                  </div>
                  {filteredModels.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between gap-2 transition-colors ${
                        model.id === value
                          ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                      }}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setShowModelMenu(false)
                        onSelectAvailableModel(group, model)
                      }}
                    >
                      <span className="min-w-0 truncate">{getModelLabel(model.id, catalogModels) !== model.id ? getModelLabel(model.id, catalogModels) : model.label}</span>
                      {model.source === 'legacy-candidate' && (
                        <span className="text-[9px] text-amber-600 dark:text-amber-400 shrink-0">Verify on first use</span>
                      )}
                      {availableGroups.length > 1 && (
                        <span className="text-[9px] text-gray-400 dark:text-gray-500 shrink-0">{group.sourceLabel}</span>
                      )}
                    </button>
                  ))}
                </div>
              )
            })}
            {modelSearch && availableGroups.every((g) => !g.models.some((m) => m.id.toLowerCase().includes(modelSearch.toLowerCase()) || m.label.toLowerCase().includes(modelSearch.toLowerCase()))) && (
              <p className="px-2 py-2 text-xs text-gray-400 dark:text-gray-500">No models match "{modelSearch}"</p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
