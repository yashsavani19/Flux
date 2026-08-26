import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('column MCP tools', () => {
  const scratchDir = mkdtempSync(join(tmpdir(), 'flux-columns-mcp-'));
  const dataFile = join(scratchDir, 'data.sqlite');
  const client = new Client({ name: 'column-test', version: '1.0.0' });
  let transport: StdioClientTransport;
  let projectId: string;

  beforeAll(async () => {
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
    const created = await client.callTool({
      name: 'create_project',
      arguments: { name: 'MCP column test' },
    });
    const text = (created.content[0] as { text: string }).text;
    projectId = text.match(/ID: (.+)$/)![1];
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
});
