import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('column REST API', () => {
  const scratchDir = mkdtempSync(join(tmpdir(), 'flux-columns-rest-'));
  const dataFile = join(scratchDir, 'data.sqlite');
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
      { id: 'shipped', label: 'Shipped', color: '#22c55e', role: 'done', order: 3 },
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
});
