import { ArrowDownIcon, CheckCircleIcon, PaperClipIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { Column, ColumnRole } from '@flux/shared'
import type { TaskWithBlocked } from '../stores'

interface DraggableTaskCardProps {
  task: TaskWithBlocked
  column?: Column
  epicColor?: string
  epicTitle?: string
  taskNumber?: number
  onClick?: () => void
  condensed?: boolean
}

// How far through the work a card in this kind of column is. `undefined` means
// an indeterminate bar - work is in flight with no meaningful percentage.
const PROGRESS_BY_ROLE: Record<ColumnRole, { className: string; value?: number }> = {
  backlog: { className: 'progress-secondary', value: 0 },
  ready: { className: '', value: 0 },
  active: { className: 'progress-warning' },
  done: { className: 'progress-success', value: 100 },
}

// A badge tinted with the column's own colour, so a custom column reads the
// same on a card as it does in the board header.
function columnBadgeStyle(color: string) {
  return { backgroundColor: `${color}26`, color, borderColor: 'transparent' }
}

export function DraggableTaskCard({
  task,
  column,
  epicColor = '#9ca3af',
  epicTitle = 'Unassigned',
  taskNumber,
  onClick,
  condensed = false,
}: DraggableTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  const handleClick = () => {
    if (!isDragging && onClick) {
      onClick()
    }
  }

  const progress = column ? PROGRESS_BY_ROLE[column.role] : undefined
  // Only a column whose role is 'active' has agents on it.
  const showWorkers = column?.role === 'active' && task.workers && task.workers.length > 0

  const renderProgress = (width: string) =>
    progress ? (
      <progress
        class={`progress ${progress.className} ${width} flex-shrink-0`}
        value={progress.value}
        max={progress.value === undefined ? undefined : 100}
      />
    ) : null

  // Shared indicator badges for acceptance criteria and guardrails
  const renderMetaIndicators = (compact = false) => (
    <>
      {task.acceptance_criteria && task.acceptance_criteria.length > 0 && (
        <div class={`flex items-center ${compact ? 'gap-0.5 flex-shrink-0' : 'gap-1'} text-xs text-success/70`} title="Acceptance criteria">
          <CheckCircleIcon className="h-3.5 w-3.5" />
          <span>{task.acceptance_criteria.length}</span>
        </div>
      )}
      {task.guardrails && task.guardrails.length > 0 && (
        <div class={`flex items-center ${compact ? 'gap-0.5 flex-shrink-0' : 'gap-1'} text-xs text-info/70`} title="Guardrails">
          <ShieldCheckIcon className="h-3.5 w-3.5" />
          <span>{task.guardrails.length}</span>
        </div>
      )}
      {task.blob_ids && task.blob_ids.length > 0 && (
        <div class={`flex items-center ${compact ? 'gap-0.5 flex-shrink-0' : 'gap-1'} text-xs text-base-content/50`} title="Attachments">
          <PaperClipIcon className="h-3.5 w-3.5" />
          <span>{task.blob_ids.length}</span>
        </div>
      )}
    </>
  )

  // Condensed view
  if (condensed) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        class={`bg-base-100 rounded-lg shadow-sm px-3 py-2 cursor-grab hover:shadow-md transition-shadow active:cursor-grabbing touch-none ${
          task.blocked ? 'ring-2 ring-warning/50' : ''
        }`}
        onClick={handleClick}
        {...(listeners as any)}
        role={attributes.role}
        tabIndex={attributes.tabIndex}
        aria-pressed={attributes['aria-pressed']}
        aria-roledescription={attributes['aria-roledescription']}
        aria-describedby={attributes['aria-describedby']}
      >
        <div class="flex items-center gap-2">
          <span
            class="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: epicColor }}
          />
          <span class="font-medium text-sm truncate flex-1">{task.title}</span>
          {task.blocked && (
            <span class="text-xs bg-warning/20 text-warning px-1.5 py-0.5 rounded font-medium flex-shrink-0">
              Blocked
            </span>
          )}
          {renderMetaIndicators(true)}
          {renderProgress('w-8')}
          {showWorkers &&
            task.workers!.map(name => (
              <span key={name} class="badge badge-primary badge-xs flex-shrink-0">{name}</span>
            ))}
        </div>
      </div>
    )
  }

  // Normal view
  return (
    <div
      ref={setNodeRef}
      style={style}
      class={`bg-base-100 rounded-lg shadow-sm p-4 cursor-grab hover:shadow-md transition-shadow active:cursor-grabbing touch-none ${
        task.blocked ? 'ring-2 ring-warning/50' : ''
      }`}
      onClick={handleClick}
      {...(listeners as any)}
      role={attributes.role}
      tabIndex={attributes.tabIndex}
      aria-pressed={attributes['aria-pressed']}
      aria-roledescription={attributes['aria-roledescription']}
      aria-describedby={attributes['aria-describedby']}
    >
      {/* Epic Label */}
      <div class="flex items-center gap-1.5 mb-2">
        <span
          class="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: epicColor }}
        />
        <span class="text-xs text-base-content/50 font-medium">{epicTitle}</span>
        {task.blocked && (
          <span class="ml-auto text-xs bg-warning/20 text-warning px-1.5 py-0.5 rounded font-medium">
            Blocked
          </span>
        )}
      </div>

      {/* Title */}
      <h4 class="font-semibold text-sm mb-1">{task.title}</h4>

      {/* Latest comment preview */}
      {task.comments && task.comments.length > 0 && (
        <p class="text-xs text-base-content/50 mb-3 line-clamp-2">
          {task.comments[task.comments.length - 1].body}
        </p>
      )}

      {/* Footer */}
      <div class="flex items-center justify-between mt-auto pt-2 gap-2">
        <div class="flex items-center gap-2 min-w-0 flex-wrap">
          {renderProgress('w-10')}
          {column ? (
            <span class="badge badge-xs max-w-32 truncate" style={columnBadgeStyle(column.color)}>
              {column.label}
            </span>
          ) : (
            <span class="badge badge-ghost badge-xs max-w-32 truncate">{task.status}</span>
          )}
          {showWorkers &&
            task.workers!.map(name => (
              <span key={name} class="badge badge-primary badge-xs">{name}</span>
            ))}
          {task.depends_on.length > 0 && (
            <div class={`flex items-center gap-1 text-xs ${task.blocked ? 'text-warning' : 'text-base-content/40'}`}>
              <ArrowDownIcon className="h-3.5 w-3.5" />
              <span>{task.depends_on.length}</span>
            </div>
          )}
          {renderMetaIndicators()}
        </div>

        {/* Task Number */}
        {taskNumber && (
          <span class="text-xs text-base-content/40 flex-shrink-0">#{taskNumber}</span>
        )}
      </div>
    </div>
  )
}
