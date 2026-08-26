import { Fragment } from 'preact'
import { ChevronDoubleLeftIcon, PlusIcon } from '@heroicons/react/24/outline'
import type { Column } from '@flux/shared'
import type { TaskWithBlocked } from '../stores'
import { DraggableTaskCard } from './DraggableTaskCard'
import { DroppableColumn } from './DroppableColumn'

// A collapsed column shrinks to a rail just wide enough for its rotated label.
const COLLAPSED_TRACK = '2.25rem'
// Expanded columns share the space evenly but never get narrower than this, so
// a board with a dozen columns scrolls sideways instead of squashing.
const EXPANDED_TRACK = 'minmax(15rem, 1fr)'

interface BoardColumnsProps {
  columns: Column[]
  collapsedColumns: Set<string>
  onToggleCollapse: (columnId: string) => void
  epicId?: string
  epicColor: string
  epicTitle: string
  condensed: boolean
  getColumnTasks: (columnId: string, epicId: string | undefined) => TaskWithBlocked[]
  getDropZoneId: (columnId: string, epicId: string | undefined) => string
  onTaskClick: (task: TaskWithBlocked) => void
  onAddTask: () => void
  addTaskTitle: string
}

/**
 * One swimlane's worth of board: a header row and a card row sharing a single
 * grid, so the two stay locked together when the lane scrolls sideways.
 * Rendered once per epic and once for unassigned tasks.
 */
export function BoardColumns({
  columns,
  collapsedColumns,
  onToggleCollapse,
  epicId,
  epicColor,
  epicTitle,
  condensed,
  getColumnTasks,
  getDropZoneId,
  onTaskClick,
  onAddTask,
  addTaskTitle,
}: BoardColumnsProps) {
  const isCollapsed = (column: Column) => collapsedColumns.has(column.id)
  const expandedCount = columns.filter(c => !isCollapsed(c)).length
  const firstExpandedId = columns.find(c => !isCollapsed(c))?.id

  const gridTemplateColumns = columns
    .map(column => (isCollapsed(column) ? COLLAPSED_TRACK : EXPANDED_TRACK))
    .join(' ')

  return (
    <div class="overflow-x-auto pb-1">
      <div
        class="grid gap-x-4 gap-y-3"
        style={{ gridTemplateColumns, gridTemplateRows: 'auto minmax(0, 1fr)' }}
      >
        {columns.map((column, index) => {
          const tasks = getColumnTasks(column.id, epicId)
          const track = index + 1

          if (isCollapsed(column)) {
            return (
              <button
                key={column.id}
                type="button"
                class="bg-base-200 rounded-lg flex items-center justify-center hover:bg-base-300 transition-colors relative min-h-32"
                style={{ gridColumn: track, gridRow: '1 / span 2' }}
                onClick={() => onToggleCollapse(column.id)}
                title={`Show ${column.label}`}
              >
                <span
                  class="w-2 h-2 rounded-full absolute top-3"
                  style={{ backgroundColor: column.color }}
                />
                <span
                  class="text-xs font-medium text-base-content/60 whitespace-nowrap"
                  style={{ transform: 'rotate(-90deg)' }}
                >
                  {column.label} ({tasks.length})
                </span>
              </button>
            )
          }

          return (
            <Fragment key={column.id}>
              <div
                class="flex items-center gap-2 min-w-0"
                style={{ gridColumn: track, gridRow: 1 }}
              >
                <span
                  class="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: column.color }}
                />
                <span class="font-medium text-sm truncate">{column.label}</span>
                <span class="text-base-content/40 text-sm flex-shrink-0">{tasks.length}</span>
                <div class="flex-1" />
                {column.id === firstExpandedId && (
                  <button
                    type="button"
                    class="w-5 h-5 rounded flex items-center justify-center text-base-content/40 hover:text-base-content/70 hover:bg-base-200 transition-colors flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddTask()
                    }}
                    title={addTaskTitle}
                  >
                    <PlusIcon className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  class="w-5 h-5 rounded flex items-center justify-center text-base-content/40 hover:text-base-content/70 hover:bg-base-200 transition-colors flex-shrink-0 disabled:opacity-30 disabled:hover:bg-transparent"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleCollapse(column.id)
                  }}
                  disabled={expandedCount <= 1}
                  title={
                    expandedCount <= 1
                      ? 'Keep at least one column open'
                      : `Hide ${column.label}`
                  }
                >
                  <ChevronDoubleLeftIcon className="h-3.5 w-3.5" />
                </button>
              </div>

              <div style={{ gridColumn: track, gridRow: 2 }}>
                <DroppableColumn
                  id={getDropZoneId(column.id, epicId)}
                  isEmpty={tasks.length === 0}
                >
                  {tasks.map((task, taskIndex) => (
                    <DraggableTaskCard
                      key={task.id}
                      task={task}
                      column={column}
                      epicColor={epicColor}
                      epicTitle={epicTitle}
                      taskNumber={taskIndex + 1}
                      onClick={() => onTaskClick(task)}
                      condensed={condensed}
                    />
                  ))}
                </DroppableColumn>
              </div>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
