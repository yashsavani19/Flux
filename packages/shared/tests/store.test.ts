import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Store } from '../src/types.js';
import {
  addDependency,
  addTaskComment,
  archiveDoneTasks,
  cleanupProject,
  createEpic,
  createProject,
  createTask,
  deleteColumn,
  deleteProject,
  deleteTaskComment,
  getColumns,
  getEpic,
  getProject,
  getProjectStats,
  getReadyTasks,
  getTasks,
  initStore,
  isTaskBlocked,
  removeDependency,
  setColumns,
  setStorageAdapter,
  updateTask,
} from '../src/store.js';
import { DEFAULT_COLUMNS, type Column } from '../src/types.js';

type AdapterData = Store & { project?: Store['projects'][number] };

function createAdapter(initial?: Partial<AdapterData>) {
  const data: AdapterData = {
    projects: [],
    epics: [],
    tasks: [],
    ...initial,
  };

  return {
    data,
    read: vi.fn(),
    write: vi.fn(),
  };
}

describe('store', () => {
  beforeEach(() => {
    const adapter = createAdapter();
    setStorageAdapter(adapter);
    initStore();
  });

  it('migrates legacy project data on init', () => {
    const legacyData: AdapterData = {
      project: { id: 'legacy', name: 'Legacy' },
      projects: undefined,
      tasks: [
        {
          id: 'task-1',
          title: 'Legacy task',
          status: 'todo',
          depends_on: [],
          notes: '',
        } as Store['tasks'][number],
      ],
      epics: [
        {
          id: 'epic-1',
          title: 'Legacy epic',
          status: 'todo',
          depends_on: [],
          notes: '',
          auto: false,
        } as Store['epics'][number],
      ],
    };
    const adapter = createAdapter(legacyData);

    setStorageAdapter(adapter);
    initStore();

    expect(adapter.data.projects).toHaveLength(1);
    expect(adapter.data.projects[0].id).toBe('legacy');
    expect(adapter.data.tasks[0].project_id).toBe('legacy');
    expect(adapter.data.epics[0].project_id).toBe('legacy');
    expect(adapter.data.project).toBeUndefined();
    expect(adapter.write).toHaveBeenCalledTimes(1);
  });

  it('removes tasks and epics when a project is deleted', () => {
    const project = createProject('Project');
    const epic = createEpic(project.id, 'Epic');
    createTask(project.id, 'Task', epic.id);

    deleteProject(project.id);

    expect(getProject(project.id)).toBeUndefined();
    expect(getTasks(project.id)).toHaveLength(0);
  });

  it('falls back to the original columns and defaults for an uncustomised project', () => {
    const project = createProject('Legacy defaults');
    const task = createTask(project.id, 'Task');
    const epic = createEpic(project.id, 'Epic');

    expect(getColumns(project.id)).toEqual(DEFAULT_COLUMNS);
    expect(task.status).toBe('planning');
    expect(epic.status).toBe('planning');
  });

  it('renames a column without changing its id or moving its tasks', () => {
    const project = createProject('Renames');
    const task = createTask(project.id, 'Task');
    const renamed = getColumns(project.id).map(column =>
      column.id === 'planning' ? { ...column, label: 'Ideas' } : column
    );

    setColumns(project.id, renamed);

    expect(getColumns(project.id).find(column => column.id === 'planning')?.label).toBe('Ideas');
    expect(getTasks(project.id)[0].status).toBe('planning');
    expect(task.id).toBe(getTasks(project.id)[0].id);
  });

  it('moves every task and epic before deleting a column', () => {
    const project = createProject('Deletion');
    const taskA = createTask(project.id, 'Task A');
    const taskB = createTask(project.id, 'Task B');
    const epic = createEpic(project.id, 'Epic');
    updateTask(taskB.id, { status: 'todo' });

    deleteColumn(project.id, 'planning', 'todo');

    expect(getTasks(project.id)).toHaveLength(2);
    expect(getTasks(project.id).map(task => task.id).sort()).toEqual([taskA.id, taskB.id].sort());
    expect(getTasks(project.id).every(task => task.status === 'todo')).toBe(true);
    expect(getEpic(epic.id)?.status).toBe('todo');
  });

  it('refuses to remove the last ready-role or done-role column', () => {
    const project = createProject('Required roles');

    expect(() => deleteColumn(project.id, 'todo', 'planning')).toThrow('ready to start');
    expect(() => deleteColumn(project.id, 'done', 'todo')).toThrow('finished work');
  });

  it('uses a custom done-role column for dependencies, ready tasks, and stats', () => {
    const project = createProject('Custom completion');
    const columns: Column[] = [
      { id: 'ideas', label: 'Ideas', color: '#a855f7', role: 'backlog', order: 0 },
      { id: 'queued', label: 'Queued', color: '#6b7280', role: 'ready', order: 1 },
      { id: 'building', label: 'Building', color: '#3b82f6', role: 'active', order: 2 },
      { id: 'shipped', label: 'Shipped', color: '#22c55e', role: 'done', order: 3 },
    ];
    setColumns(project.id, columns);
    const blocker = createTask(project.id, 'Blocker');
    const dependent = createTask(project.id, 'Dependent', undefined, { depends_on: [blocker.id] });

    expect(isTaskBlocked(dependent.id)).toBe(true);
    updateTask(blocker.id, { status: 'shipped' });

    expect(isTaskBlocked(dependent.id)).toBe(false);
    expect(getReadyTasks(project.id).map(task => task.id)).toContain(dependent.id);
    expect(getReadyTasks(project.id).map(task => task.id)).not.toContain(blocker.id);
    expect(getProjectStats(project.id)).toEqual({ total: 2, done: 1 });
  });

  it('tracks dependencies and blocked state', () => {
    const project = createProject('Project');
    const blocker = createTask(project.id, 'Blocker');
    const blocked = createTask(project.id, 'Blocked');

    expect(addDependency(blocked.id, blocker.id)).toBe(true);
    expect(isTaskBlocked(blocked.id)).toBe(true);

    updateTask(blocker.id, { status: 'done' });
    expect(isTaskBlocked(blocked.id)).toBe(false);

    expect(removeDependency(blocked.id, blocker.id)).toBe(true);
    expect(isTaskBlocked(blocked.id)).toBe(false);
  });

  it('archives done tasks and cleans up empty epics', () => {
    const project = createProject('Project');
    const epic = createEpic(project.id, 'Epic');
    const doneTask = createTask(project.id, 'Done', epic.id);
    const todoTask = createTask(project.id, 'Todo');

    updateTask(doneTask.id, { status: 'done' });

    expect(archiveDoneTasks(project.id)).toBe(1);
    expect(getTasks(project.id)).toHaveLength(1);
    expect(getTasks(project.id)[0].id).toBe(todoTask.id);

    const result = cleanupProject(project.id, false, true);
    expect(result).toEqual({ archivedTasks: 0, deletedEpics: 1 });
  });

  it('adds and deletes task comments', () => {
    const project = createProject('Project');
    const task = createTask(project.id, 'Task');
    const comment = addTaskComment(task.id, 'First', 'user');

    expect(comment?.body).toBe('First');
    expect(task.comments).toHaveLength(1);

    const deleted = deleteTaskComment(task.id, comment!.id);
    expect(deleted).toBe(true);
    expect(task.comments).toHaveLength(0);
  });

  it('detects circular dependencies on update', () => {
    const project = createProject('Project');
    const taskA = createTask(project.id, 'Task A');
    const taskB = createTask(project.id, 'Task B');

    // A depends on B
    updateTask(taskA.id, { depends_on: [taskB.id] });

    // B depending on A would create a cycle
    expect(() => updateTask(taskB.id, { depends_on: [taskA.id] })).toThrow('Circular dependency detected');
  });

  it('detects indirect circular dependencies', () => {
    const project = createProject('Project');
    const taskA = createTask(project.id, 'Task A');
    const taskB = createTask(project.id, 'Task B');
    const taskC = createTask(project.id, 'Task C');

    // A -> B -> C
    updateTask(taskA.id, { depends_on: [taskB.id] });
    updateTask(taskB.id, { depends_on: [taskC.id] });

    // C -> A would create a cycle
    expect(() => updateTask(taskC.id, { depends_on: [taskA.id] })).toThrow('Circular dependency detected');
  });

  it('rejects non-existent dependencies on create', () => {
    const project = createProject('Project');

    expect(() => createTask(project.id, 'Task', undefined, { depends_on: ['nonexistent'] })).toThrow('Dependency not found');
  });

  it('rejects non-existent dependencies on update', () => {
    const project = createProject('Project');
    const task = createTask(project.id, 'Task');

    expect(() => updateTask(task.id, { depends_on: ['nonexistent'] })).toThrow('Dependency not found');
  });

  it('prevents circular dependency via addDependency', () => {
    const project = createProject('Project');
    const taskA = createTask(project.id, 'Task A');
    const taskB = createTask(project.id, 'Task B');

    addDependency(taskA.id, taskB.id);
    // B -> A would create a cycle, addDependency returns false
    expect(addDependency(taskB.id, taskA.id)).toBe(false);
  });

  it('detects self-dependency as circular', () => {
    const project = createProject('Project');
    const task = createTask(project.id, 'Task');

    expect(() => updateTask(task.id, { depends_on: [task.id] })).toThrow('Circular dependency detected');
  });

  it('addDependency rejects nonexistent dependency', () => {
    const project = createProject('Project');
    const task = createTask(project.id, 'Task');

    expect(addDependency(task.id, 'nonexistent')).toBe(false);
  });

  it('creates task with acceptance_criteria', () => {
    const project = createProject('Project');
    const task = createTask(project.id, 'Task', undefined, {
      acceptance_criteria: ['Processes in <100ms', 'Returns valid JSON'],
    });

    expect(task.acceptance_criteria).toHaveLength(2);
    expect(task.acceptance_criteria?.[0]).toBe('Processes in <100ms');
  });

  it('creates task with guardrails and generates IDs', () => {
    const project = createProject('Project');
    const task = createTask(project.id, 'Task', undefined, {
      guardrails: [
        { number: 999, text: 'Do not delete data' } as any,
        { id: 'existing-id', number: 9999, text: 'Always backup' },
      ],
    });

    expect(task.guardrails).toHaveLength(2);
    expect(task.guardrails?.[0].id).toBeDefined();
    expect(task.guardrails?.[0].number).toBe(999);
    expect(task.guardrails?.[1].id).toBe('existing-id');
  });

  it('updates task acceptance_criteria (replace mode)', () => {
    const project = createProject('Project');
    const task = createTask(project.id, 'Task', undefined, {
      acceptance_criteria: ['Original criterion'],
    });

    const updated = updateTask(task.id, { acceptance_criteria: ['New criterion 1', 'New criterion 2'] });

    expect(updated?.acceptance_criteria).toHaveLength(2);
    expect(updated?.acceptance_criteria?.[0]).toBe('New criterion 1');
  });

  it('updates task guardrails (replace mode)', () => {
    const project = createProject('Project');
    const task = createTask(project.id, 'Task', undefined, {
      guardrails: [{ id: 'g1', number: 1, text: 'Original' }],
    });

    const updated = updateTask(task.id, { guardrails: [{ number: 999, text: 'New guardrail' } as any] });

    expect(updated?.guardrails).toHaveLength(1);
    expect(updated?.guardrails?.[0].number).toBe(999);
    expect(updated?.guardrails?.[0].id).toBeDefined();
  });

  it('clears acceptance_criteria with empty array', () => {
    const project = createProject('Project');
    const task = createTask(project.id, 'Task', undefined, {
      acceptance_criteria: ['Criterion 1'],
    });

    const updated = updateTask(task.id, { acceptance_criteria: [] });

    expect(updated?.acceptance_criteria).toHaveLength(0);
  });

  it('clears guardrails with empty array', () => {
    const project = createProject('Project');
    const task = createTask(project.id, 'Task', undefined, {
      guardrails: [{ id: 'g1', number: 999, text: 'Guardrail' }],
    });

    const updated = updateTask(task.id, { guardrails: [] });

    expect(updated?.guardrails).toHaveLength(0);
  });
});
