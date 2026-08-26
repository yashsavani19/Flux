import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('column MCP tools', () => {
  const scratchDir = mkdtempSync(join(tmpdir(), 'flux-columns-mcp-'));
  const dataFile = join(scratchDir, 'data.json');
  const client = new Client({ name: 'column-test', version: '1.0.0' });
  const projectId = 'mcp-columns-project';
  let transport: StdioClientTransport;

  beforeAll(async () => {
    writeFileSync(dataFile, JSON.stringify({
      projects: [{
        id: projectId,
        name: 'MCP column test',
        columns: [
          { id: 'planning', label: 'Planning', color: '#a855f7', role: 'backlog', order: 0 },
          { id: 'todo', label: 'To do', color: '#6b7280', role: 'ready', order: 1 },
          { id: 'in_progress', label: 'In progress', color: '#3b82f6', role: 'active', order: 2 },
          { id: 'review', label: 'Review', color: '#06b6d4', role: 'active', order: 3 },
          { id: 'done', label: 'Done', color: '#22c55e', role: 'done', order: 4 },
        ],
      }],
      epics: [],
      tasks: [],
    }));
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ['run', 'packages/mcp/src/index.ts'],
      cwd: join(import.meta.dir, '../../..'),
      env: {
        PATH: process.env.PATH ?? '',
        FLUX_DATA: dataFile,
      },
      stderr: 'pipe',
    });
    await client.connect(transport);
  });

  afterAll(async () => {
    await transport?.close();
    rmSync(scratchDir, { recursive: true, force: true });
  });

  it('lists discoverable columns without a global status enum', async () => {
    const tools = await client.listTools();
    const listColumns = tools.tools.find(tool => tool.name === 'list_columns');
    const moveTask = tools.tools.find(tool => tool.name === 'move_task_status');
    expect(listColumns).toBeDefined();
    expect((moveTask?.inputSchema.properties?.status as { enum?: string[] }).enum).toBeUndefined();

    const result = await client.callTool({
      name: 'list_columns',
      arguments: { project_id: projectId },
    });
    const columns = JSON.parse((result.content[0] as { text: string }).text);
    expect(columns[0]).toEqual({ id: 'planning', label: 'Planning', role: 'backlog', order: 0 });
  });

  it('rejects an unknown status with the project valid ids and labels', async () => {
    const created = await client.callTool({
      name: 'create_task',
      arguments: { project_id: projectId, title: 'Task' },
    });
    const taskId = (created.content[0] as { text: string }).text.match(/ID: (.+)$/)![1];
    const result = await client.callTool({
      name: 'move_task_status',
      arguments: { task_id: taskId, status: 'missing' },
    });
    const text = (result.content[0] as { text: string }).text;

    expect(result.isError).toBe(true);
    expect(text).toContain('Unknown status "missing"');
    expect(text).toContain('planning (Planning)');
    expect(text).toContain('done (Done)');
  });

  it('clears workers on non-active destinations in both task move paths', async () => {
    const created = await client.callTool({
      name: 'create_task',
      arguments: { project_id: projectId, title: 'Worker transitions' },
    });
    const taskId = (created.content[0] as { text: string }).text.match(/ID: (.+)$/)![1];

    await client.callTool({ name: 'move_task_status', arguments: { task_id: taskId, status: 'todo' } });
    await client.callTool({
      name: 'move_task_status',
      arguments: { task_id: taskId, status: 'in_progress', agent_name: 'agent-1' },
    });
    const continuedUpdate = await client.callTool({
      name: 'update_task',
      arguments: { task_id: taskId, status: 'review' },
    });
    const continuedUpdateText = (continuedUpdate.content[0] as { text: string }).text;
    const continuedUpdateTask = JSON.parse(continuedUpdateText.slice(continuedUpdateText.indexOf('{')));
    expect(continuedUpdateTask.workers).toEqual(['agent-1']);
    const updateResult = await client.callTool({
      name: 'update_task',
      arguments: { task_id: taskId, status: 'todo' },
    });
    const updateText = (updateResult.content[0] as { text: string }).text;
    const updatedTask = JSON.parse(updateText.slice(updateText.indexOf('{')));
    expect(updatedTask.workers).toEqual([]);

    await client.callTool({
      name: 'move_task_status',
      arguments: { task_id: taskId, status: 'in_progress', agent_name: 'agent-1' },
    });
    await client.callTool({ name: 'move_task_status', arguments: { task_id: taskId, status: 'review' } });
    const activeListed = await client.callTool({
      name: 'list_tasks',
      arguments: { project_id: projectId },
    });
    const activeTasks = JSON.parse((activeListed.content[0] as { text: string }).text);
    expect(activeTasks.find((task: { id: string }) => task.id === taskId).workers).toEqual(['agent-1']);
    await client.callTool({ name: 'move_task_status', arguments: { task_id: taskId, status: 'todo' } });
    const listed = await client.callTool({
      name: 'list_tasks',
      arguments: { project_id: projectId },
    });
    const tasks = JSON.parse((listed.content[0] as { text: string }).text);
    expect(tasks.find((task: { id: string }) => task.id === taskId).workers).toEqual([]);
  });
});
