import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('column REST API', () => {
  const scratchDir = mkdtempSync(join(tmpdir(), 'flux-columns-rest-'));
  const dataFile = join(scratchDir, 'data.json');
  let server: ReturnType<typeof Bun.spawn>;
  let baseUrl: string;
  let projectId: string;

  beforeAll(async () => {
    const portProbe = Bun.serve({ port: 0, fetch: () => new Response('probe') });
    const port = portProbe.port;
    portProbe.stop(true);
    baseUrl = `http://127.0.0.1:${port}`;
    server = Bun.spawn({
      cmd: [process.execPath, 'run', 'packages/server/src/index.ts'],
      cwd: join(import.meta.dir, '../../..'),
      env: {
        ...process.env,
        PORT: String(port),
        FLUX_DATA: dataFile,
        FLUX_API_KEY: '',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(`${baseUrl}/health`);
        if (response.ok) break;
      } catch {
        // Server is still starting.
      }
      await Bun.sleep(50);
    }

    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Column API test' }),
    });
    expect(response.status).toBe(201);
    projectId = (await response.json()).id;
  });

  afterAll(async () => {
    server?.kill();
    await server?.exited;
    rmSync(scratchDir, { recursive: true, force: true });
  });

  it('returns legacy defaults and accepts a whole-list replacement', async () => {
    const defaults = await fetch(`${baseUrl}/api/projects/${projectId}/columns`);
    expect(defaults.status).toBe(200);
    expect((await defaults.json()).map((column: { id: string }) => column.id)).toEqual([
      'planning', 'todo', 'in_progress', 'done',
    ]);

    const columns = [
      { id: 'ideas', label: 'Ideas', color: '#a855f7', role: 'backlog', order: 0 },
      { id: 'queued', label: 'Queued', color: '#6b7280', role: 'ready', order: 1 },
      { id: 'review', label: 'Review', color: '#3b82f6', role: 'active', order: 2 },
      { id: 'building', label: 'Building', color: '#06b6d4', role: 'active', order: 3 },
      { id: 'shipped', label: 'Shipped', color: '#22c55e', role: 'done', order: 4 },
    ];
    const replaced = await fetch(`${baseUrl}/api/projects/${projectId}/columns`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(columns),
    });

    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toEqual(columns);
  });

  it('rejects unknown task and epic statuses with valid ids and labels', async () => {
    const taskResponse = await fetch(`${baseUrl}/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bad status', status: 'missing' }),
    });
    const taskBody = await taskResponse.json();
    expect(taskResponse.status).toBe(400);
    expect(taskBody.error).toContain('Unknown status "missing"');
    expect(taskBody.error).toContain('review (Review)');
    expect(taskBody.error).toContain('shipped (Shipped)');

    const validTaskResponse = await fetch(`${baseUrl}/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Valid task' }),
    });
    const validTask = await validTaskResponse.json();
    const taskPatchResponse = await fetch(`${baseUrl}/api/tasks/${validTask.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'missing' }),
    });
    expect(taskPatchResponse.status).toBe(400);
    expect((await taskPatchResponse.json()).error).toContain('ideas (Ideas)');

    const epicResponse = await fetch(`${baseUrl}/api/projects/${projectId}/epics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bad epic status', status: 'missing' }),
    });
    const epicBody = await epicResponse.json();
    expect(epicResponse.status).toBe(400);
    expect(epicBody.error).toContain('queued (Queued)');

    const validEpicResponse = await fetch(`${baseUrl}/api/projects/${projectId}/epics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Valid epic' }),
    });
    const validEpic = await validEpicResponse.json();
    const epicPatchResponse = await fetch(`${baseUrl}/api/epics/${validEpic.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'missing' }),
    });
    expect(epicPatchResponse.status).toBe(400);
    expect((await epicPatchResponse.json()).error).toContain('shipped (Shipped)');
  });

  it('clears workers on active-to-ready moves and keeps them on active-to-active moves', async () => {
    const createdResponse = await fetch(`${baseUrl}/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Worker transitions', status: 'queued' }),
    });
    const task = await createdResponse.json();

    const activatedResponse = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'review', agent_name: 'agent-1' }),
    });
    expect((await activatedResponse.json()).workers).toEqual(['agent-1']);

    const continuedResponse = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'building' }),
    });
    expect((await continuedResponse.json()).workers).toEqual(['agent-1']);

    const queuedResponse = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'queued' }),
    });
    expect((await queuedResponse.json()).workers).toEqual([]);

    const injectedResponse = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workers: ['phantom'] }),
    });
    expect((await injectedResponse.json()).workers).toEqual([]);
  });

  it('rejects stale column snapshots instead of overwriting a newer editor', async () => {
    const created = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Column concurrency' }),
    });
    const project = await created.json();
    const defaults = await fetch(`${baseUrl}/api/projects/${project.id}/columns`).then(response => response.json());
    const renamed = defaults.map((column: { id: string }) =>
      column.id === 'planning' ? { ...column, label: 'Ideas' } : column
    );

    const first = await fetch(`${baseUrl}/api/projects/${project.id}/columns`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns: renamed, expectedColumns: defaults }),
    });
    expect(first.status).toBe(200);

    const stale = await fetch(`${baseUrl}/api/projects/${project.id}/columns`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns: defaults, expectedColumns: defaults }),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toContain('changed since this editor was opened');
    const current = await fetch(`${baseUrl}/api/projects/${project.id}/columns`).then(response => response.json());
    expect(current.find((column: { id: string }) => column.id === 'planning').label).toBe('Ideas');
  });

  it('counts and moves archived tasks through a rename-plus-add delete save', async () => {
    const created = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Archived column moves' }),
    });
    const project = await created.json();
    const defaults = await fetch(`${baseUrl}/api/projects/${project.id}/columns`).then(response => response.json());
    const visible = await fetch(`${baseUrl}/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Visible' }),
    }).then(response => response.json());
    const archived = await fetch(`${baseUrl}/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Archived' }),
    }).then(response => response.json());
    await fetch(`${baseUrl}/api/tasks/${archived.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });

    const counts = await fetch(`${baseUrl}/api/projects/${project.id}/column-task-counts`).then(response => response.json());
    expect(counts.planning).toBe(2);

    const stranded = await fetch(`${baseUrl}/api/projects/${project.id}/columns`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(defaults.filter((column: { id: string }) => column.id !== 'planning')),
    });
    expect(stranded.status).toBe(400);

    const staged = [
      ...defaults.map((column: { id: string }) =>
        column.id === 'planning' ? { ...column, label: 'Ideas' } : column
      ),
      { id: 'triage', label: 'Triage', color: '#f59e0b', role: 'ready', order: defaults.length },
    ];
    const saved = await fetch(`${baseUrl}/api/projects/${project.id}/columns`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns: staged, expectedColumns: defaults }),
    });
    expect(saved.status).toBe(200);
    const savedColumns = await saved.json();
    expect(savedColumns.find((column: { id: string }) => column.id === 'planning').label).toBe('Ideas');

    const removed = await fetch(`${baseUrl}/api/projects/${project.id}/columns/planning`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moveTasksTo: 'triage', expectedColumns: savedColumns }),
    });
    expect(removed.status).toBe(200);
    expect((await removed.json()).some((column: { id: string }) => column.id === 'planning')).toBe(false);
    expect(await fetch(`${baseUrl}/api/tasks/${visible.id}`).then(response => response.json())).toMatchObject({ status: 'triage' });
    expect(await fetch(`${baseUrl}/api/tasks/${archived.id}`).then(response => response.json())).toMatchObject({ status: 'triage', archived: true });
  });

  it('enforces backlog-to-active transitions over REST without partial creates', async () => {
    const created = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'REST transition gate' }),
    });
    const project = await created.json();

    const directCreate = await fetch(`${baseUrl}/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Direct active', status: 'in_progress' }),
    });
    expect(directCreate.status).toBe(400);
    expect(await fetch(`${baseUrl}/api/projects/${project.id}/tasks`).then(response => response.json())).toEqual([]);

    const task = await fetch(`${baseUrl}/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Gated task' }),
    }).then(response => response.json());
    const rejected = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(rejected.status).toBe(400);
    expect(await fetch(`${baseUrl}/api/tasks/${task.id}`).then(response => response.json())).toMatchObject({ status: 'planning' });
  });

  it('rejects column changes through the general project patch route', async () => {
    const response = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns: [] }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('columns endpoint');
  });

  it('allows project-scoped keys to read columns but keeps configuration writes server-only', async () => {
    const hiddenProjectResponse = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hidden project', visibility: 'private' }),
    });
    const hiddenProject = await hiddenProjectResponse.json();
    const keyResponse = await fetch(`${baseUrl}/api/auth/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project reader', project_ids: [projectId] }),
    });
    const { key } = await keyResponse.json();
    const headers = { Authorization: `Bearer ${key}` };

    const readable = await fetch(`${baseUrl}/api/projects/${projectId}/columns`, { headers });
    expect(readable.status).toBe(200);

    const hidden = await fetch(`${baseUrl}/api/projects/${hiddenProject.id}/columns`, { headers });
    expect(hidden.status).toBe(404);

    const write = await fetch(`${baseUrl}/api/projects/${projectId}/columns`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(await readable.json()),
    });
    expect(write.status).toBe(401);
  });
});
