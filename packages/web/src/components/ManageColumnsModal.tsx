import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import type { Column, ColumnRole } from '@flux/shared'
import {
  COLUMN_COLORS,
  COLUMN_ROLES,
  COLUMN_ROLE_CONFIG,
  columnsEqual,
  slugifyColumnId,
  validateColumns,
} from '@flux/shared'
import { deleteColumn, saveColumns } from '../stores'
import { ConfirmModal } from './ConfirmModal'
import { Modal } from './Modal'

interface ManageColumnsModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  columns: Column[]
  /** Live task count per column id, so a delete can say what it will move. */
  taskCounts: Record<string, number>
  /** Set when the saved columns could not be read at all. */
  loadError: string | null
  onSaved: (columns: Column[]) => void | Promise<void>
}

// A row keeps one `uid` for as long as the dialog is open. The column's real
// id can still change while a brand-new column is being named, and a changing
// key would tear the row's input out of the DOM mid-keystroke.
type DraftColumn = Column & { uid: string }

let uidCounter = 0
function nextUid(): string {
  uidCounter += 1
  return `row-${uidCounter}`
}

function toDraft(columns: Column[]): DraftColumn[] {
  return columns.map((column, index) => ({ ...column, order: index, uid: nextUid() }))
}

function withOrder(columns: DraftColumn[]): DraftColumn[] {
  return columns.map((column, index) => ({ ...column, order: index }))
}

// What actually gets sent to the server: the shared Column shape, nothing else.
function toColumns(draft: DraftColumn[]): Column[] {
  return draft.map(({ uid: _uid, ...column }, index) => ({ ...column, order: index }))
}

export function ManageColumnsModal({
  isOpen,
  onClose,
  projectId,
  columns,
  taskCounts,
  loadError,
  onSaved,
}: ManageColumnsModalProps) {
  const [draft, setDraft] = useState<DraftColumn[]>(() => toDraft(columns))
  const [baseline, setBaseline] = useState<Column[]>(() =>
    columns.map((column, order) => ({ ...column, order }))
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [moveTasksTo, setMoveTasksTo] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const activeSession = useRef<string | null>(null)

  const adoptColumns = (nextColumns: Column[]) => {
    const normalised = nextColumns.map((column, order) => ({ ...column, order }))
    setDraft(toDraft(normalised))
    setBaseline(normalised)
    setSaveError(null)
  }

  // Start from the latest board snapshot on open. While the editor is open,
  // harmless SSE reloads do not reset the draft; a genuine remote change is
  // adopted only while the local draft is still clean.
  useEffect(() => {
    if (!isOpen) {
      activeSession.current = null
      return
    }
    const opening = activeSession.current !== projectId
    const localDirty = !columnsEqual(toColumns(draft), baseline)
    if (opening || (!localDirty && !columnsEqual(columns, baseline))) {
      activeSession.current = projectId
      adoptColumns(columns)
      setDeleteTargetId(null)
      setDeleteError(null)
    }
  }, [isOpen, projectId, columns, draft, baseline])

  const validationError = useMemo(() => validateColumns(toColumns(draft)), [draft])
  const dirty = !columnsEqual(toColumns(draft), baseline)
  const remoteChanged = isOpen && !loadError && !columnsEqual(columns, baseline)
  const deleteTarget = draft.find(c => c.id === deleteTargetId) ?? null
  const moveOptions = draft.filter(c => c.id !== deleteTargetId)

  const isNew = (id: string) => !baseline.some(column => column.id === id)

  const updateColumn = (index: number, patch: Partial<Column>) => {
    setSaveError(null)
    setDraft(prev =>
      prev.map((column, i) => (i === index ? { ...column, ...patch } : column))
    )
  }

  // The id is what every task's status holds, so it is fixed the moment a column
  // is saved. Only a column that has never been saved re-slugs as you type.
  const handleLabelChange = (index: number, label: string) => {
    setSaveError(null)
    setDraft(prev =>
      prev.map((column, i) => {
        if (i !== index) return column
        if (!isNew(column.id)) return { ...column, label }
        const others = prev.filter((_, j) => j !== i).map(c => c.id)
        return { ...column, label, id: slugifyColumnId(label, others) }
      })
    )
  }

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= draft.length) return
    setSaveError(null)
    setDraft(prev => {
      const next = [...prev]
      const [column] = next.splice(index, 1)
      next.splice(target, 0, column)
      return withOrder(next)
    })
  }

  const handleAdd = () => {
    setSaveError(null)
    setDraft(prev => {
      const label = 'New column'
      const id = slugifyColumnId(label, prev.map(c => c.id))
      const color =
        COLUMN_COLORS.find(candidate => !prev.some(c => c.color === candidate)) ?? COLUMN_COLORS[0]
      return withOrder([
        ...prev,
        { id, label, color, role: 'ready' as ColumnRole, order: prev.length, uid: nextUid() },
      ])
    })
  }

  // Why a column cannot be removed, in the shared validator's own words. Only
  // meaningful once the list itself is valid - otherwise every row would report
  // whatever is wrong somewhere else.
  const blockedReason = (column: DraftColumn): string | null => {
    if (validationError) return null
    return validateColumns(toColumns(draft.filter(c => c.uid !== column.uid)))
  }

  const handleDeleteClick = (column: DraftColumn) => {
    // A column that was never saved has no tasks and no server record - drop it.
    if (isNew(column.id)) {
      setDraft(prev => withOrder(prev.filter(c => c.uid !== column.uid)))
      return
    }
    setDeleteError(null)
    setDeleteTargetId(column.id)
    setMoveTasksTo(draft.find(c => c.id !== column.id)?.id ?? '')
  }

  const handleDeleteConfirmed = async () => {
    if (!deleteTarget || !moveTasksTo || deleting || remoteChanged) return
    setDeleting(true)
    setDeleteError(null)
    try {
      // Save staged edits first: a rename, or a freshly added destination
      // column, has to exist on the server before the tasks can be moved into it.
      let savedSnapshot = baseline
      if (dirty) {
        savedSnapshot = await saveColumns(
          projectId,
          toColumns(draft),
          loadError ? undefined : baseline
        )
        adoptColumns(savedSnapshot)
        await onSaved(savedSnapshot)
      }
      const remaining = await deleteColumn(
        projectId,
        deleteTarget.id,
        moveTasksTo,
        loadError ? undefined : savedSnapshot
      )
      adoptColumns(remaining)
      await onSaved(remaining)
      setDeleteTargetId(null)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not remove the column.')
    } finally {
      setDeleting(false)
    }
  }

  const handleSave = async () => {
    if (saving || remoteChanged) return
    const error = validateColumns(toColumns(draft))
    if (error) {
      setSaveError(error)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await saveColumns(
        projectId,
        toColumns(draft),
        loadError ? undefined : baseline
      )
      await onSaved(saved)
      onClose()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save the columns.')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    if (saving || deleting) return
    onClose()
  }

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title="Manage columns"
        boxClassName="max-w-2xl"
      >
        <p class="text-sm text-base-content/60 -mt-2 mb-4">
          Columns appear on the board from left to right, in this order.
        </p>

        {loadError && (
          <div class="alert alert-warning mb-4 text-sm">
            <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />
            <span>
              This board’s saved columns could not be read ({loadError}). You are looking at
              the standard four — saving will replace whatever is stored.
            </span>
          </div>
        )}

        {remoteChanged && (
          <div class="alert alert-warning mb-4 text-sm">
            <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />
            <span>
              These columns changed elsewhere while you were editing. Reload the latest version before saving.
            </span>
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              onClick={() => {
                adoptColumns(columns)
                setDeleteTargetId(null)
                setDeleteError(null)
              }}
            >
              Reload latest
            </button>
          </div>
        )}

        <div class="max-h-[55vh] overflow-y-auto pr-1 space-y-3">
          {draft.map((column, index) => {
            const reason = blockedReason(column)
            const removeBlocked = reason ?? (validationError ? 'Fix the problem below first.' : null)
            const count = taskCounts[column.id] ?? 0
            return (
              <div key={column.uid} class="border border-base-300 rounded-lg p-3">
                <div class="flex items-center gap-2">
                  <div class="join join-vertical">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs join-item px-1"
                      onClick={() => move(index, -1)}
                      disabled={index === 0 || remoteChanged}
                      title="Move up"
                      aria-label={`Move ${column.label} up`}
                    >
                      <ArrowUpIcon className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs join-item px-1"
                      onClick={() => move(index, 1)}
                      disabled={index === draft.length - 1 || remoteChanged}
                      title="Move down"
                      aria-label={`Move ${column.label} down`}
                    >
                      <ArrowDownIcon className="h-3 w-3" />
                    </button>
                  </div>
                  <span
                    class="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: column.color }}
                  />
                  <input
                    type="text"
                    class="input input-bordered input-sm flex-1 min-w-0"
                    value={column.label}
                    placeholder="Column name"
                    aria-label="Column name"
                    onInput={(e) =>
                      handleLabelChange(index, (e.target as HTMLInputElement).value)
                    }
                    disabled={remoteChanged}
                  />
                  <span class="text-xs text-base-content/50 whitespace-nowrap">
                    {count} task{count === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs text-error disabled:text-base-content/30"
                    onClick={() => handleDeleteClick(column)}
                    disabled={!!removeBlocked || remoteChanged}
                    title={removeBlocked ?? `Remove ${column.label}`}
                    aria-label={`Remove ${column.label}`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>

                <div class="mt-3 flex flex-wrap items-center gap-2 pl-9">
                  <span class="text-xs text-base-content/60 w-28">Colour</span>
                  {COLUMN_COLORS.map(color => (
                    <button
                      key={color}
                      type="button"
                      class={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${
                        column.color === color ? 'ring-2 ring-offset-2 ring-offset-base-100 ring-base-content/40' : ''
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => updateColumn(index, { color })}
                      disabled={remoteChanged}
                      title={`Use this colour for ${column.label}`}
                      aria-label={`Use colour ${color}`}
                    />
                  ))}
                </div>

                <div class="mt-3 flex flex-wrap items-center gap-2 pl-9">
                  <span class="text-xs text-base-content/60 w-28">What it means</span>
                  <select
                    class="select select-bordered select-sm"
                    value={column.role}
                    aria-label={`What ${column.label} means`}
                    onChange={(e) =>
                      updateColumn(index, {
                        role: (e.target as HTMLSelectElement).value as ColumnRole,
                      })
                    }
                    disabled={remoteChanged}
                  >
                    {COLUMN_ROLES.map(role => (
                      <option key={role} value={role}>
                        {COLUMN_ROLE_CONFIG[role].label}
                      </option>
                    ))}
                  </select>
                </div>
                <p class="text-xs text-base-content/50 mt-1 pl-9 ml-[7.5rem]">
                  {COLUMN_ROLE_CONFIG[column.role].description}
                </p>

                {reason && (
                  <p class="text-xs text-base-content/50 mt-2 pl-9">{reason}</p>
                )}
              </div>
            )
          })}
        </div>

        <button
          type="button"
          class="btn btn-ghost btn-sm mt-3"
          onClick={handleAdd}
          disabled={remoteChanged}
        >
          <PlusIcon className="h-4 w-4" />
          Add column
        </button>

        {(validationError || saveError) && (
          <div class="alert alert-error mt-4 text-sm">
            <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />
            <span>{saveError ?? validationError}</span>
          </div>
        )}

        <div class="modal-action">
          <button type="button" class="btn btn-ghost" onClick={handleClose} disabled={saving || deleting}>
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onClick={handleSave}
            disabled={saving || deleting || remoteChanged || !!validationError || !dirty}
          >
            {saving ? <span class="loading loading-spinner loading-sm"></span> : 'Save columns'}
          </button>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!deleteTarget}
        title={deleteTarget ? `Remove ${deleteTarget.label}?` : 'Remove column?'}
        description={
          deleteTarget ? (
            <span class="block space-y-3">
              <span class="block">
                {(taskCounts[deleteTarget.id] ?? 0) === 0
                  ? `Nothing is in ${deleteTarget.label} right now.`
                  : taskCounts[deleteTarget.id] === 1
                  ? `Moving 1 task out of ${deleteTarget.label}. Nothing is deleted — pick where it should go.`
                  : `Moving ${taskCounts[deleteTarget.id]} tasks out of ${deleteTarget.label}. Nothing is deleted — pick where they should go.`}
              </span>
              <span class="block">
                <span class="block text-xs text-base-content/60 mb-1">Move tasks to</span>
                <select
                  class="select select-bordered select-sm w-full"
                  value={moveTasksTo}
                  aria-label="Move tasks to"
                  onChange={(e) => setMoveTasksTo((e.target as HTMLSelectElement).value)}
                >
                  {moveOptions.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </span>
              {dirty && (
                <span class="block text-xs text-base-content/60">
                  Your other unsaved changes are saved at the same time.
                </span>
              )}
              {deleteError && (
                <span class="block text-error text-xs">{deleteError}</span>
              )}
            </span>
          ) : undefined
        }
        confirmLabel="Move tasks and remove"
        confirmClassName="btn-error"
        confirmDisabled={!moveTasksTo || remoteChanged}
        isLoading={deleting}
        onConfirm={handleDeleteConfirmed}
        onClose={() => {
          if (!deleting) {
            setDeleteTargetId(null)
            setDeleteError(null)
          }
        }}
      />
    </>
  )
}
