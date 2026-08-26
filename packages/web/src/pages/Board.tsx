import { useEffect, useMemo, useState } from "preact/hooks";
import { route, RoutableProps } from "preact-router";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  API_ORIGIN,
  getProject,
  getTasks,
  getEpics,
  updateEpic,
  updateTask,
  cleanupProject,
  type TaskWithBlocked,
} from "../stores";
import type { Epic } from "@flux/shared";
import { EPIC_COLORS } from "@flux/shared";
import {
  TaskForm,
  EpicForm,
  BoardColumns,
  ManageColumnsModal,
  ThemeToggle,
} from "../components";
import { useBoardPreferences } from "../hooks/useBoardPreferences";
import { useProjectColumns } from "../hooks/useProjectColumns";
import {
  ArrowLeftIcon,
  Bars3BottomLeftIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon,
  ViewColumnsIcon,
} from "@heroicons/react/24/outline";

interface BoardProps extends RoutableProps {
  projectId?: string;
}

// Get color for epic based on index
const getEpicColor = (epicId: string, epics: Epic[]): string => {
  const index = epics.findIndex((e) => e.id === epicId);
  return EPIC_COLORS[index % EPIC_COLORS.length];
};

export function Board({ projectId }: BoardProps) {
  const [tasks, setTasks] = useState<TaskWithBlocked[]>([]);
  const [epics, setEpics] = useState<Epic[]>([]);
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);

  // Modal state
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [epicFormOpen, setEpicFormOpen] = useState(false);
  const [manageColumnsOpen, setManageColumnsOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskWithBlocked | undefined>(
    undefined
  );
  const [editingEpic, setEditingEpic] = useState<Epic | undefined>(undefined);
  const [defaultEpicId, setDefaultEpicId] = useState<string | undefined>(
    undefined
  );

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterEpicId, setFilterEpicId] = useState<string | "all">("all");
  const [filterStatus, setFilterStatus] = useState<string | "all">("all");

  // Cleanup dialog state
  const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false);
  const [cleanupArchiveTasks, setCleanupArchiveTasks] = useState(true);
  const [cleanupArchiveEpics, setCleanupArchiveEpics] = useState(true);

  // This project's board columns
  const {
    columns,
    error: columnsError,
    reload: reloadColumns,
    applySaved: applySavedColumns,
  } = useProjectColumns(projectId ?? "");

  // Board preferences (persisted to localStorage)
  const {
    viewMode,
    collapsedColumns,
    collapsedEpics,
    setViewMode,
    toggleColumnCollapse,
    expandAllColumns,
    pruneCollapsedColumns,
    toggleEpicCollapse,
  } = useBoardPreferences(projectId ?? "");

  // Configure sensors with activation constraint to allow clicks
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    if (!projectId) {
      route("/");
      return;
    }
    loadProject();
  }, [projectId]);

  // A column that no longer exists must not keep a slot in the saved preferences.
  useEffect(() => {
    pruneCollapsedColumns(columns.map((c) => c.id));
  }, [columns, pruneCollapsedColumns]);

  useEffect(() => {
    if (!projectId) return;
    const eventsBase = API_ORIGIN;
    let source: EventSource | null = null;
    let refreshTimeout: number | null = null;
    let reconnectTimeout: number | null = null;
    let isMounted = true;

    const scheduleRefresh = () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }
      refreshTimeout = window.setTimeout(() => {
        refreshData();
      }, 100);
    };

    const connect = () => {
      if (!isMounted) return;

      source = new EventSource(`${eventsBase}/api/events`);

      source.addEventListener("data-changed", scheduleRefresh);

      source.addEventListener("connected", () => {
        // Refresh data on reconnect to catch any missed updates
        scheduleRefresh();
      });

      source.onerror = () => {
        source?.close();
        // Reconnect after 2 seconds
        if (isMounted) {
          reconnectTimeout = window.setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      isMounted = false;
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }
      if (reconnectTimeout) {
        window.clearTimeout(reconnectTimeout);
      }
      source?.close();
    };
  }, [projectId]);

  const loadProject = async () => {
    if (!projectId) return;
    setLoading(true);
    const project = await getProject(projectId);
    if (!project) {
      route("/");
      return;
    }
    setProjectName(project.name);
    await refreshData();
    setLoading(false);
  };

  const refreshData = async () => {
    if (!projectId) return;
    const [tasksData, epicsData] = await Promise.all([
      getTasks(projectId),
      getEpics(projectId),
    ]);
    setTasks(tasksData);
    setEpics(epicsData);
  };

  // Handle drag end
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const dropZoneId = over.id as string;
    const [newStatus, epicPart] = dropZoneId.split(":");
    const newEpicId = epicPart === "unassigned" ? undefined : epicPart;

    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    if (task.status !== newStatus || task.epic_id !== newEpicId) {
      await updateTask(taskId, {
        status: newStatus,
        epic_id: newEpicId,
      });
      await refreshData();
    }
  };

  // Task form handlers
  const openNewTask = (epicId?: string) => {
    setEditingTask(undefined);
    setDefaultEpicId(epicId);
    setTaskFormOpen(true);
  };

  const toggleEpicAuto = async (epic: Epic, auto: boolean) => {
    const updated = await updateEpic(epic.id, { auto });
    if (updated) {
      setEpics((prev) => prev.map((item) => (item.id === epic.id ? updated : item)));
    }
  };

  const openEditTask = (task: TaskWithBlocked) => {
    setEditingTask(task);
    setTaskFormOpen(true);
  };

  const closeTaskForm = () => {
    setTaskFormOpen(false);
    setEditingTask(undefined);
    setDefaultEpicId(undefined);
  };

  // Epic form handlers
  const openNewEpic = () => {
    setEditingEpic(undefined);
    setEpicFormOpen(true);
  };

  const closeEpicForm = () => {
    setEpicFormOpen(false);
    setEditingEpic(undefined);
  };

  // Cleanup handlers
  const handleCleanup = async () => {
    if (!projectId) return;
    await cleanupProject(projectId, cleanupArchiveTasks, cleanupArchiveEpics);
    setCleanupDialogOpen(false);
    setCleanupArchiveTasks(true);
    setCleanupArchiveEpics(true);
    await refreshData();
  };

  // Count of finished tasks (for the archive dialog). "Finished" is whatever
  // this board's columns say it is, not a hardcoded 'done'.
  const doneTaskCount = useMemo(() => {
    const doneIds = new Set(
      columns.filter((c) => c.role === "done").map((c) => c.id)
    );
    return tasks.filter((t) => doneIds.has(t.status)).length;
  }, [tasks, columns]);

  // Tasks per column, used by the manage dialog to say what a delete will move.
  const taskCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const task of tasks) {
      counts[task.status] = (counts[task.status] ?? 0) + 1;
    }
    return counts;
  }, [tasks]);

  const hiddenColumnCount = columns.filter((c) =>
    collapsedColumns.has(c.id)
  ).length;

  // Filter tasks
  const filterTask = (task: TaskWithBlocked): boolean => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesTitle = task.title.toLowerCase().includes(query);
      const commentsText = task.comments?.map(c => c.body).join(" ") || "";
      const matchesComments = commentsText.toLowerCase().includes(query);
      if (!matchesTitle && !matchesComments) return false;
    }
    if (filterStatus !== "all" && task.status !== filterStatus) return false;
    return true;
  };

  // Get tasks for a specific column and epic
  const getColumnTasks = (columnId: string, epicId: string | undefined) =>
    tasks
      .filter((t) => t.epic_id === epicId && t.status === columnId)
      .filter(filterTask);

  // Get task count for an epic
  const getEpicTaskCount = (epicId: string | undefined) =>
    tasks.filter((t) => t.epic_id === epicId).filter(filterTask).length;

  // Generate drop zone ID
  const getDropZoneId = (columnId: string, epicId: string | undefined) =>
    `${columnId}:${epicId ?? "unassigned"}`;

  // Get total task count
  const totalTaskCount = tasks.filter(filterTask).length;

  if (loading) {
    return (
      <div class="min-h-screen bg-base-200 flex items-center justify-center">
        <span class="loading loading-spinner loading-lg text-primary"></span>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <div class="min-h-screen bg-base-200">
        {/* Header */}
        <div class="navbar bg-base-100 shadow-lg mb-4">
          <div class="flex-1 flex items-center">
            <button class="btn btn-ghost btn-circle" onClick={() => route("/")}>
              <ArrowLeftIcon className="h-5 w-5" />
            </button>
            <div class="flex items-center gap-2 px-2">
              <Squares2X2Icon className="h-6 w-6 text-primary" />
              <h1 class="text-xl font-bold">{projectName}</h1>
              <span class="text-base-content/50 text-lg ml-1">
                {totalTaskCount} tasks
              </span>
            </div>
          </div>
          <div class="flex gap-2">
            <ThemeToggle />
            <button
              class="btn btn-primary btn-sm"
              onClick={() => openNewTask()}
            >
              New task
            </button>
            <button class="btn btn-neutral btn-sm" onClick={openNewEpic}>
              New epic
            </button>
          </div>
        </div>

        <div class="px-6 pb-0">
          {columnsError && (
            <div class="alert alert-warning mb-4 text-sm">
              <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />
              <span>
                This board’s columns could not be loaded ({columnsError}). The
                standard four are shown instead.
              </span>
              <button class="btn btn-sm btn-ghost" onClick={reloadColumns}>
                Try again
              </button>
            </div>
          )}

          {/* Filter Bar */}
          <div class="bg-base-100 rounded-xl p-4 shadow-sm mb-6">
            <div class="flex items-center gap-4 flex-wrap">
              <div class="relative flex-1 min-w-48 max-w-sm">
                <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-base-content/40" />
                <input
                  type="text"
                  placeholder="Search tasks..."
                  class="input input-bordered w-full pl-10 text-sm"
                  value={searchQuery}
                  onInput={(e) =>
                    setSearchQuery((e.target as HTMLInputElement).value)
                  }
                />
              </div>
              <select
                class="select select-bordered text-sm font-medium"
                value={filterEpicId}
                onChange={(e) =>
                  setFilterEpicId((e.target as HTMLSelectElement).value)
                }
              >
                <option value="all">All epics</option>
                {epics.map((epic) => (
                  <option key={epic.id} value={epic.id}>
                    {epic.title}
                  </option>
                ))}
                <option value="unassigned">Unassigned</option>
              </select>
              <select
                class="select select-bordered text-sm font-medium"
                value={filterStatus}
                onChange={(e) =>
                  setFilterStatus((e.target as HTMLSelectElement).value)
                }
              >
                <option value="all">All columns</option>
                {columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.label}
                  </option>
                ))}
              </select>
              {(searchQuery ||
                filterEpicId !== "all" ||
                filterStatus !== "all") && (
                <button
                  class="btn btn-ghost btn-sm"
                  onClick={() => {
                    setSearchQuery("");
                    setFilterEpicId("all");
                    setFilterStatus("all");
                  }}
                >
                  Clear
                </button>
              )}
              <div class="flex-1" />
              <button
                class="btn btn-ghost btn-sm"
                onClick={() => setManageColumnsOpen(true)}
                title="Add, rename, reorder or remove board columns"
              >
                <ViewColumnsIcon className="h-4 w-4" />
                Manage columns
              </button>
              {hiddenColumnCount > 0 && (
                <button
                  class="btn btn-ghost btn-sm"
                  onClick={expandAllColumns}
                  title="Show every hidden column again"
                >
                  <EyeIcon className="h-4 w-4" />
                  Show all columns ({hiddenColumnCount} hidden)
                </button>
              )}
              <button
                class="btn btn-ghost btn-sm"
                onClick={() => setCleanupDialogOpen(true)}
                title="Clean up board"
              >
                Clean up
              </button>
              {/* View Toggle */}
              <div class="join">
                <button
                  class={`btn btn-sm join-item ${
                    viewMode === "normal" ? "btn-primary" : "btn-ghost"
                  }`}
                  onClick={() => setViewMode("normal")}
                  title="Normal view"
                >
                  <ViewColumnsIcon className="h-4 w-4" />
                </button>
                <button
                  class={`btn btn-sm join-item ${
                    viewMode === "condensed" ? "btn-primary" : "btn-ghost"
                  }`}
                  onClick={() => setViewMode("condensed")}
                  title="Condensed view"
                >
                  <Bars3BottomLeftIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Swimlanes */}
        <div class="px-6 pb-6 space-y-4">
          {/* Epic Swimlanes */}
          {epics
            .filter(
              (epic) => filterEpicId === "all" || filterEpicId === epic.id
            )
            .map((epic) => {
              const isCollapsed = collapsedEpics.has(epic.id);
              const epicColor = getEpicColor(epic.id, epics);
              const taskCount = getEpicTaskCount(epic.id);

              return (
                <div
                  key={epic.id}
                  class="bg-base-100 rounded-xl shadow-sm overflow-hidden"
                >
                  {/* Epic Header */}
                  <div
                    class="p-4 flex items-center gap-3 cursor-pointer hover:bg-base-200 transition-colors"
                    onClick={() => toggleEpicCollapse(epic.id)}
                  >
                    <ChevronRightIcon
                      className={`h-5 w-5 text-base-content/40 transition-transform ${
                        isCollapsed ? "" : "rotate-90"
                      }`}
                    />
                    <span
                      class="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: epicColor }}
                    />
                    <span class="font-semibold">{epic.title}</span>
                    <span class="text-base-content/40 text-sm bg-base-200 px-2 py-0.5 rounded">
                      {taskCount} task{taskCount !== 1 ? "s" : ""}
                    </span>
                    <div class="ml-auto flex items-center gap-3">
                      <div
                        class="flex items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <label class="flex items-center gap-2 text-xs text-base-content/60">
                          {epic.auto && (
                            <span class="loading loading-infinity loading-xs text-warning" />
                          )}
                          <span>Auto</span>
                          <input
                            type="checkbox"
                            class="toggle toggle-xs"
                            checked={epic.auto}
                            onChange={(e) =>
                              toggleEpicAuto(
                                epic,
                                (e.target as HTMLInputElement).checked
                              )
                            }
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Epic Content */}
                  {!isCollapsed && (
                    <div class="px-4 pb-4">
                      <BoardColumns
                        columns={columns}
                        collapsedColumns={collapsedColumns}
                        onToggleCollapse={toggleColumnCollapse}
                        epicId={epic.id}
                        epicColor={epicColor}
                        epicTitle={epic.title}
                        condensed={viewMode === "condensed"}
                        getColumnTasks={getColumnTasks}
                        getDropZoneId={getDropZoneId}
                        onTaskClick={openEditTask}
                        onAddTask={() => openNewTask(epic.id)}
                        addTaskTitle="Add task to this epic"
                      />
                    </div>
                  )}
                </div>
              );
            })}

          {/* Unassigned Lane */}
          {(filterEpicId === "all" || filterEpicId === "unassigned") && (
            <div class="bg-base-100 rounded-xl shadow-sm overflow-hidden">
              <div
                class="p-4 flex items-center gap-3 cursor-pointer hover:bg-base-200 transition-colors"
                onClick={() => toggleEpicCollapse("unassigned")}
              >
                <ChevronRightIcon
                  className={`h-5 w-5 text-base-content/40 transition-transform ${
                    collapsedEpics.has("unassigned") ? "" : "rotate-90"
                  }`}
                />
                <span class="w-3 h-3 rounded-full bg-base-content/40 flex-shrink-0" />
                <span class="font-semibold">Unassigned</span>
                <span class="text-base-content/40 text-sm bg-base-200 px-2 py-0.5 rounded">
                  {getEpicTaskCount(undefined)} task
                  {getEpicTaskCount(undefined) !== 1 ? "s" : ""}
                </span>
              </div>

              {!collapsedEpics.has("unassigned") && (
                <div class="px-4 pb-4">
                  <BoardColumns
                    columns={columns}
                    collapsedColumns={collapsedColumns}
                    onToggleCollapse={toggleColumnCollapse}
                    epicId={undefined}
                    epicColor="#9ca3af"
                    epicTitle="Unassigned"
                    condensed={viewMode === "condensed"}
                    getColumnTasks={getColumnTasks}
                    getDropZoneId={getDropZoneId}
                    onTaskClick={openEditTask}
                    onAddTask={() => openNewTask(undefined)}
                    addTaskTitle="Add unassigned task"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modals */}
        <TaskForm
          isOpen={taskFormOpen}
          onClose={closeTaskForm}
          onSave={refreshData}
          task={editingTask}
          projectId={projectId!}
          defaultEpicId={defaultEpicId}
        />
        <EpicForm
          isOpen={epicFormOpen}
          onClose={closeEpicForm}
          onSave={refreshData}
          epic={editingEpic}
          projectId={projectId!}
        />
        <ManageColumnsModal
          isOpen={manageColumnsOpen}
          onClose={() => setManageColumnsOpen(false)}
          projectId={projectId!}
          columns={columns}
          taskCounts={taskCounts}
          loadError={columnsError}
          onSaved={async (saved) => {
            applySavedColumns(saved);
            await refreshData();
          }}
        />

        {/* Cleanup Dialog */}
        {cleanupDialogOpen && (
          <div class="modal modal-open">
            <div class="modal-box">
              <h3 class="font-bold text-lg">Clean up board</h3>
              <div class="py-4 space-y-3">
                <label class="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    class="checkbox"
                    checked={cleanupArchiveTasks}
                    onChange={(e) =>
                      setCleanupArchiveTasks(
                        (e.target as HTMLInputElement).checked
                      )
                    }
                  />
                  <span>Archive finished tasks</span>
                  {doneTaskCount > 0 && (
                    <span class="text-base-content/50 text-sm">
                      ({doneTaskCount} task{doneTaskCount !== 1 ? "s" : ""})
                    </span>
                  )}
                </label>
                <label class="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    class="checkbox"
                    checked={cleanupArchiveEpics}
                    onChange={(e) =>
                      setCleanupArchiveEpics(
                        (e.target as HTMLInputElement).checked
                      )
                    }
                  />
                  <span>Archive empty epics</span>
                </label>
              </div>
              <div class="modal-action">
                <button
                  class="btn btn-ghost"
                  onClick={() => {
                    setCleanupDialogOpen(false);
                    setCleanupArchiveTasks(true);
                    setCleanupArchiveEpics(true);
                  }}
                >
                  Cancel
                </button>
                <button
                  class="btn btn-primary"
                  onClick={handleCleanup}
                  disabled={!cleanupArchiveTasks && !cleanupArchiveEpics}
                >
                  Clean
                </button>
              </div>
            </div>
            <div
              class="modal-backdrop bg-black/50"
              onClick={() => {
                setCleanupDialogOpen(false);
                setCleanupArchiveTasks(true);
                setCleanupArchiveEpics(true);
              }}
            />
          </div>
        )}
      </div>
    </DndContext>
  );
}
