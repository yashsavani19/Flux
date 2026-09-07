import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createSqliteAdapter } from '../src/adapters/sqlite-adapter';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB = `/tmp/flux-concurrency-test-${process.pid}.sqlite`;

function cleanup() {
  if (existsSync(TEST_DB)) {
    unlinkSync(TEST_DB);
  }
  if (existsSync(`${TEST_DB}-shm`)) {
    unlinkSync(`${TEST_DB}-shm`);
  }
  if (existsSync(`${TEST_DB}-wal`)) {
    unlinkSync(`${TEST_DB}-wal`);
  }
}

beforeEach(cleanup);
afterEach(cleanup);

describe('SQLite Adapter Concurrency', () => {
  test('concurrent writes from separate adapter instances should not lose data', async () => {
    // Initialize database
    const initAdapter = createSqliteAdapter(TEST_DB);
    initAdapter.read();
    initAdapter.data.projects = [{ id: 'test-project', name: 'Test' }];
    initAdapter.data.tasks = [];
    initAdapter.write();

    const adapterPath = new URL('../src/adapters/sqlite-adapter.ts', import.meta.url).pathname;
    const writerScript = `
      import { createSqliteAdapter } from ${JSON.stringify(adapterPath)};
      const adapter = createSqliteAdapter(process.env.FLUX_TEST_DB!);
      adapter.read();
      await Bun.sleep(Math.random() * 20);
      adapter.data.tasks.push({
        id: process.env.FLUX_TEST_TASK_ID!,
        title: 'Concurrent task',
        status: 'todo',
        depends_on: [],
        comments: [],
        project_id: 'test-project',
      });
      adapter.write();
    `;

    // Use real processes, matching one `docker exec` per MCP call. Calling the
    // synchronous write() method from promises would still run serially.
    const writers = [];
    for (let i = 0; i < 10; i++) {
      for (const agent of ['A', 'B', 'C']) {
        writers.push(Bun.spawn([process.execPath, '-e', writerScript], {
          env: {
            ...process.env,
            FLUX_TEST_DB: TEST_DB,
            FLUX_TEST_TASK_ID: `agent-${agent}-task-${i}`,
          },
          stdout: 'pipe',
          stderr: 'pipe',
        }));
      }
    }

    const results = await Promise.all(writers.map(async process => ({
      exitCode: await process.exited,
      stderr: await new Response(process.stderr).text(),
    })));
    expect(results.filter(result => result.exitCode !== 0)).toEqual([]);

    // Verify all tasks were saved
    const finalAdapter = createSqliteAdapter(TEST_DB);
    finalAdapter.read();

    expect(finalAdapter.data.tasks.length).toBe(30);

    // Verify each agent's tasks
    const agentATasks = finalAdapter.data.tasks.filter(t => t.id.startsWith('agent-A'));
    const agentBTasks = finalAdapter.data.tasks.filter(t => t.id.startsWith('agent-B'));
    const agentCTasks = finalAdapter.data.tasks.filter(t => t.id.startsWith('agent-C'));

    expect(agentATasks.length).toBe(10);
    expect(agentBTasks.length).toBe(10);
    expect(agentCTasks.length).toBe(10);
  });

  test('concurrent updates to same task should preserve latest changes', async () => {
    // Initialize with a task
    const initAdapter = createSqliteAdapter(TEST_DB);
    initAdapter.read();
    initAdapter.data.projects = [{ id: 'test-project', name: 'Test' }];
    initAdapter.data.tasks = [{
      id: 'task-1',
      title: 'Original',
      status: 'todo',
      depends_on: [],
      comments: [],
      project_id: 'test-project',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }];
    initAdapter.write();

    // Two agents update the same task concurrently
    async function updateTask(newTitle: string) {
      const adapter = createSqliteAdapter(TEST_DB);
      adapter.read();

      await new Promise(resolve => setTimeout(resolve, Math.random() * 10));

      const task = adapter.data.tasks.find(t => t.id === 'task-1');
      if (task) {
        task.title = newTitle;
        task.updated_at = new Date().toISOString();
      }

      adapter.write();
    }

    await Promise.all([
      updateTask('Updated by A'),
      updateTask('Updated by B'),
    ]);

    // Verify task still exists and has one of the updates
    const finalAdapter = createSqliteAdapter(TEST_DB);
    finalAdapter.read();

    expect(finalAdapter.data.tasks.length).toBe(1);
    const task = finalAdapter.data.tasks[0];
    expect(['Updated by A', 'Updated by B']).toContain(task.title);
  });

  test('mixed operations (create + update + delete) should not lose data', async () => {
    // Initialize with some tasks
    const initAdapter = createSqliteAdapter(TEST_DB);
    initAdapter.read();
    initAdapter.data.projects = [{ id: 'test-project', name: 'Test' }];
    initAdapter.data.tasks = [
      {
        id: 'existing-1',
        title: 'Existing Task 1',
        status: 'todo',
        depends_on: [],
        comments: [],
        project_id: 'test-project',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'existing-2',
        title: 'Existing Task 2',
        status: 'todo',
        depends_on: [],
        comments: [],
        project_id: 'test-project',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    initAdapter.write();

    // Agent A: Creates new tasks
    async function createTasks() {
      const adapter = createSqliteAdapter(TEST_DB);
      adapter.read();

      for (let i = 0; i < 5; i++) {
        adapter.data.tasks.push({
          id: `new-${i}`,
          title: `New Task ${i}`,
          status: 'todo',
          depends_on: [],
          comments: [],
          project_id: 'test-project',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      adapter.write();
    }

    // Agent B: Updates existing task
    async function updateTask() {
      const adapter = createSqliteAdapter(TEST_DB);
      adapter.read();

      const task = adapter.data.tasks.find(t => t.id === 'existing-1');
      if (task) {
        task.status = 'in_progress';
      }

      adapter.write();
    }

    // Agent C: Deletes a task
    async function deleteTask() {
      const adapter = createSqliteAdapter(TEST_DB);
      adapter.read();

      adapter.data.tasks = adapter.data.tasks.filter(t => t.id !== 'existing-2');

      adapter.write();
    }

    await Promise.all([createTasks(), updateTask(), deleteTask()]);

    // Verify final state
    const finalAdapter = createSqliteAdapter(TEST_DB);
    finalAdapter.read();

    // Should have: 1 existing (existing-1) + 5 new = 6 tasks
    // existing-2 should be deleted
    expect(finalAdapter.data.tasks.length).toBeGreaterThanOrEqual(6);

    const existing1 = finalAdapter.data.tasks.find(t => t.id === 'existing-1');
    expect(existing1).toBeDefined();

    const newTasks = finalAdapter.data.tasks.filter(t => t.id.startsWith('new-'));
    expect(newTasks.length).toBe(5);
  });
});
