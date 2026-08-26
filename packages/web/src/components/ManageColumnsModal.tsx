import { useEffect, useMemo, useState } from 'preact/hooks'
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

function withOrder(columns: Column[]): Column[] {
  return columns.map((column, index) => ({ ...column, order: index }))
}

function sameList(a: Column[], b: Column[]): boolean {
  return JSON.stringify(withOrder(a)) === JSON.stringify(withOrder(b))
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
  const [draft, setDraft] = useState<Column[]>(columns)
  const [savedIds, setSavedIds] = useState<string[]>(() => columns.map(c => c.id))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [moveTasksTo, setMoveTasksTo] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Start from whatever is currently on the board every time the modal opens.
  useEffect(() => {
    if (!isOpen) return
    setDraft(withOrder(columns))
    setSavedIds(columns.map(c => c.id))
    setSaveError(null)
    setDeleteTargetId(null)
    setDeleteError(null)
  }, [isOpen, columns])

  const validationError = useMemo(() => validateColumns(draft), [draft])
  const dirty = !sameList(draft, columns)
  const deleteTarget = draft.find(c => c.id === deleteTargetId) ?? null
  const moveOptions = draft.filter(c => c.id !== deleteTargetId)

  const isNew = (id: string) => !savedIds.includes(id)

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
      return withOrder([...prev, { id, label, color, role: 'ready' as ColumnRole, order: prev.length }])
    })
  }

  // Why a column cannot be removed, in the shared validator's own words.
  const blockedReason = (column: Column): string | null =>
    validateColumns(draft.filter(c => c.id !== column.id))

  const handleDeleteClick = (column: Column) => {
    // A column that was never saved has no tasks and no server record - drop it.
    if (isNew(column.id)) {
      setDraft(prev => withOrder(prev.filter(c => c.id !== column.id)))
      return
    }
    setDeleteError(null)
    setDeleteTargetId(column.id)
    setMoveTasksTo(draft.find(c => c.id !== column.id)?.id ?? '')
  }

  const handleDeleteConfirmed = async () => {
    if (!deleteTarget || !moveTasksTo || deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      // Save staged edits first: a rename, or a freshly added destination
      // column, has to exist on the server before the tasks can be moved into it.
      if (dirty) {
        await saveColumns(projectId, withOrder(draft))
      }
      const remaining = await deleteColumn(projectId, deleteTarget.id, moveTasksTo)
      setDraft(withOrder(remaining))
      setSavedIds(remaining.map(c => c.id))
      await onSaved(remaining)
      setDeleteTargetId(null)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not remove the column.')
    } finally {
      setDeleting(false)
    }
  }

  const handleSave = async () => {
    if (saving) return
    const error = validateColumns(draft)
    if (error) {
      setSaveError(error)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await saveColumns(projectId, withOrder(draft))
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

        <div class="max-h-[55vh] overflow-y-auto pr-1 space-y-3">
          {draft.map((column, index) => {
            const reason = blockedReason(column)
            const count = taskCounts[column.id] ?? 0
            return (
              <div key={column.id} class="border border-base-300 rounded-lg p-3">
                <div class="flex items-center gap-2">
                  <div class="join join-vertical">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs join-item px-1"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      title="Move up"
                      aria-label={`Move ${column.label} up`}
                    >
                      <ArrowUpIcon className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs join-item px-1"
                      onClick={() => move(index, 1)}
                      disabled={index === draft.length - 1}
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
                  />
                  <span class="text-xs text-base-content/50 whitespace-nowrap">
                    {count} task{count === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs text-error disabled:text-base-content/30"
                    onClick={() => handleDeleteClick(column)}
                    disabled={!!reason}
                    title={reason ?? `Remove ${column.label}`}
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

        <button type="button" class="btn btn-ghost btn-sm mt-3" onClick={handleAdd}>
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
            disabled={saving || deleting || !!validationError || !dirty}
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
                  : `${taskCounts[deleteTarget.id]} task${
                      taskCounts[deleteTarget.id] === 1 ? '' : 's'
                    } sit in ${deleteTarget.label}. No task is deleted — pick where they should go.`}
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
        confirmDisabled={!moveTasksTo}
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
