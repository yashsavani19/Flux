import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createSqliteAdapter } from '../src/adapters/sqlite-adapter';
import { deleteTask, setStorageAdapter } from '../src/store';
import { unlinkSync, existsSync } from 'fs';
import type { Blob, Task } from '../src/types';

const TEST_DB = `/tmp/flux-delete-test-${process.pid}.sqlite`;
const SECOND_DB = `/tmp/flux-delete-test-${process.pid}-second.sqlite`;

function cleanup() {
  for (const dbPath of [TEST_DB, SECOND_DB]) {
    for (const suffix of ['', '-shm', '-wal']) {
      if (existsSync(`${dbPath}${suffix}`)) unlinkSync(`${dbPath}${suffix}`);
    }
  }
}

beforeEach(cleanup);
afterEach(cleanup);

function task(id: string, depends_on: string[] = []): Task {
  return {
    id,
    title: `Task ${id}`,
    status: 'todo',
    depends_on,
    comments: [],
    project_id: 'p1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function seed() {
  const adapter = createSqliteAdapter(TEST_DB);
  adapter.read();
  adapter.data.projects = [{ id: 'p1', name: 'Test' }];
  adapter.data.tasks = [task('t1'), task('t2'), task('t3')];
  adapter.write();
  return adapter;
}

describe('SQLite adapter honours deletes', () => {
  test('a deleted task stays deleted', () => {
    const adapter = seed();

    adapter.data.tasks = adapter.data.tasks.filter(t => t.id !== 't2');
    adapter.write();

    const fresh = createSqliteAdapter(TEST_DB);
    fresh.read();
    expect(fresh.data.tasks.map(t => t.id).sort()).toEqual(['t1', 't3']);
  });

  test('a deleted task does not resurrect on the next unrelated write', () => {
    const adapter = seed();

    adapter.data.tasks = adapter.data.tasks.filter(t => t.id !== 't2');
    adapter.write();

    // Any later write re-reads the DB and merges; the deleted task must not come back.
    adapter.data.tasks[0]!.title = 'renamed';
    adapter.write();

    const fresh = createSqliteAdapter(TEST_DB);
    fresh.read();
    expect(fresh.data.tasks.map(t => t.id).sort()).toEqual(['t1', 't3']);
  });

  test('deleting a task persists the depends_on cleanup on surviving tasks', () => {
    const adapter = createSqliteAdapter(TEST_DB);
    adapter.read();
    adapter.data.projects = [{ id: 'p1', name: 'Test' }];
    adapter.data.tasks = [task('t1'), task('t2', ['t1'])];
    adapter.write();

    setStorageAdapter(adapter);
    expect(deleteTask('t1')).toBe(true);

    const fresh = createSqliteAdapter(TEST_DB);
    fresh.read();
    expect(fresh.data.tasks.map(t => t.id)).toEqual(['t2']);
    expect(fresh.data.tasks[0]!.depends_on).toEqual([]);
  });

  test('projects, epics and blobs can be deleted too', () => {
    const adapter = createSqliteAdapter(TEST_DB);
    adapter.read();
    adapter.data.projects = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];
    adapter.data.epics = [{ id: 'e1', title: 'E', status: 'todo', depends_on: [], notes: '', auto: false, project_id: 'p1' }];
    const blob: Blob = {
      id: 'b1',
      task_id: 't1',
      filename: 'a.png',
      mime_type: 'image/png',
      size: 1,
      hash: 'h',
      created_at: '',
    };
    adapter.data.blobs = [blob];
    adapter.write();

    adapter.data.projects = adapter.data.projects.filter(p => p.id !== 'p2');
    adapter.data.epics = [];
    adapter.data.blobs = [];
    adapter.write();

    const fresh = createSqliteAdapter(TEST_DB);
    fresh.read();
    expect(fresh.data.projects.map(p => p.id)).toEqual(['p1']);
    expect(fresh.data.epics).toEqual([]);
    expect(fresh.data.blobs).toEqual([]);
  });

  test('a delete does NOT wipe rows this process never saw (no lost updates)', () => {
    const a = seed();

    // Another process creates a task that adapter `a` has never read.
    const b = createSqliteAdapter(TEST_DB);
    b.read();
    b.data.tasks.push(task('t4-from-other-process'));
    b.write();

    // `a`, working from its stale snapshot, deletes t2.
    a.data.tasks = a.data.tasks.filter(t => t.id !== 't2');
    a.write();

    const fresh = createSqliteAdapter(TEST_DB);
    fresh.read();
    // t2 gone (intended), t4 preserved (never seen by `a`, so not a deletion).
    expect(fresh.data.tasks.map(t => t.id).sort()).toEqual(['t1', 't3', 't4-from-other-process']);
  });

  test('stale adapters can delete different tasks without resurrecting either one', () => {
    const a = seed();
    const b = createSqliteAdapter(TEST_DB);
    b.read();

    a.data.tasks = a.data.tasks.filter(t => t.id !== 't1');
    a.write();

    b.data.tasks = b.data.tasks.filter(t => t.id !== 't2');
    b.write();

    const fresh = createSqliteAdapter(TEST_DB);
    fresh.read();
    expect(fresh.data.tasks.map(t => t.id)).toEqual(['t3']);
  });

  test('two stale adapters can delete the same task', () => {
    const a = seed();
    const b = createSqliteAdapter(TEST_DB);
    b.read();

    a.data.tasks = a.data.tasks.filter(t => t.id !== 't2');
    b.data.tasks = b.data.tasks.filter(t => t.id !== 't2');
    a.write();
    b.write();

    const fresh = createSqliteAdapter(TEST_DB);
    fresh.read();
    expect(fresh.data.tasks.map(t => t.id).sort()).toEqual(['t1', 't3']);
  });

  test('an unrelated stale write preserves another adapter update and delete', () => {
    const stale = seed();
    const other = createSqliteAdapter(TEST_DB);
    other.read();

    other.data.tasks.find(t => t.id === 't1')!.title = 'updated elsewhere';
    other.data.tasks = other.data.tasks.filter(t => t.id !== 't2');
    other.write();

    stale.data.tasks.push(task('t4-local-create'));
    stale.write();

    const fresh = createSqliteAdapter(TEST_DB);
    fresh.read();
    expect(fresh.data.tasks.find(t => t.id === 't1')!.title).toBe('updated elsewhere');
    expect(fresh.data.tasks.map(t => t.id).sort()).toEqual(['t1', 't3', 't4-local-create']);
  });

  test('the last writer wins when delete and update target the same id', () => {
    const deleter = seed();
    const updater = createSqliteAdapter(TEST_DB);
    updater.read();

    deleter.data.tasks = deleter.data.tasks.filter(t => t.id !== 't2');
    deleter.write();

    updater.data.tasks.find(t => t.id === 't2')!.title = 're-created by later update';
    updater.write();

    const fresh = createSqliteAdapter(TEST_DB);
    fresh.read();
    expect(fresh.data.tasks.find(t => t.id === 't2')!.title).toBe('re-created by later update');
  });

  test('a delete wins when it is the last write for a concurrently updated id', () => {
    const deleter = seed();
    const updater = createSqliteAdapter(TEST_DB);
    updater.read();

    updater.data.tasks.find(t => t.id === 't2')!.title = 'concurrent update';
    updater.write();

    deleter.data.tasks = deleter.data.tasks.filter(t => t.id !== 't2');
    deleter.write();

    const fresh = createSqliteAdapter(TEST_DB);
    fresh.read();
    expect(fresh.data.tasks.some(t => t.id === 't2')).toBe(false);
  });

  test('a long-lived adapter does not resurrect a row deleted after its last write', () => {
    const longLived = seed();
    const creator = createSqliteAdapter(TEST_DB);
    creator.read();
    creator.data.tasks.push(task('t4-from-other-process'));
    creator.write();

    // This write teaches the long-lived adapter about t4 through the merge.
    longLived.data.tasks.find(t => t.id === 't1')!.title = 'first local update';
    longLived.write();

    const deleter = createSqliteAdapter(TEST_DB);
    deleter.read();
    deleter.data.tasks = deleter.data.tasks.filter(t => t.id !== 't4-from-other-process');
    deleter.write();

    longLived.data.tasks.find(t => t.id === 't3')!.title = 'second local update';
    longLived.write();

    const fresh = createSqliteAdapter(TEST_DB);
    fresh.read();
    expect(fresh.data.tasks.map(t => t.id).sort()).toEqual(['t1', 't2', 't3']);
  });

  test('write before read preserves existing rows', () => {
    seed();
    const adapter = createSqliteAdapter(TEST_DB);
    adapter.data.tasks.push(task('t4-without-read'));
    adapter.write();

    const fresh = createSqliteAdapter(TEST_DB);
    fresh.read();
    expect(fresh.data.tasks.map(t => t.id).sort()).toEqual(['t1', 't2', 't3', 't4-without-read']);
  });

  test('undefined blobs do not hide a concurrent blob creation', () => {
    const stale = createSqliteAdapter(TEST_DB);
    stale.read();
    const creator = createSqliteAdapter(TEST_DB);
    creator.read();
    creator.data.blobs = [{
      id: 'b1',
      task_id: 't1',
      filename: 'a.png',
      mime_type: 'image/png',
      size: 1,
      hash: 'h',
      created_at: '',
    }];
    creator.write();

    stale.data.projects.push({ id: 'p1', name: 'unrelated write' });
    stale.write();

    const fresh = createSqliteAdapter(TEST_DB);
    fresh.read();
    expect(fresh.data.blobs?.map(blob => blob.id)).toEqual(['b1']);
  });

  test('delete then recreate of the same id in one write keeps the recreation', () => {
    const adapter = seed();
    adapter.data.tasks = adapter.data.tasks.filter(t => t.id !== 't2');
    adapter.data.tasks.push({ ...task('t2'), title: 're-created locally' });
    adapter.write();

    const fresh = createSqliteAdapter(TEST_DB);
    fresh.read();
    expect(fresh.data.tasks.find(t => t.id === 't2')!.title).toBe('re-created locally');
  });

  test('unread adapters do not share mutable default arrays', () => {
    const first = createSqliteAdapter(TEST_DB);
    const leaked = task('must-not-leak');
    first.data.tasks.push(leaked);

    try {
      const second = createSqliteAdapter(SECOND_DB);
      expect(second.data.tasks).toEqual([]);
    } finally {
      const index = first.data.tasks.indexOf(leaked);
      if (index !== -1) first.data.tasks.splice(index, 1);
    }
  });

  test('a malformed collection can reach the store migration layer', () => {
    const db = new Database(TEST_DB, { create: true });
    db.exec('CREATE TABLE store (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)');
    db.prepare('INSERT INTO store (id, data) VALUES (1, ?)').run(JSON.stringify({
      projects: [],
      epics: [],
      tasks: {},
    }));
    db.close();

    const adapter = createSqliteAdapter(TEST_DB);
    expect(() => adapter.read()).not.toThrow();
  });

  test('concurrent creates from separate adapters are still all preserved', async () => {
    const init = createSqliteAdapter(TEST_DB);
    init.read();
    init.data.projects = [{ id: 'p1', name: 'Test' }];
    init.data.tasks = [];
    init.write();

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => (async () => {
        const adapter = createSqliteAdapter(TEST_DB);
        adapter.read();
        await new Promise(r => setTimeout(r, Math.random() * 10));
        adapter.data.tasks.push(task(`concurrent-${i}`));
        adapter.write();
      })())
    );

    const fresh = createSqliteAdapter(TEST_DB);
    fresh.read();
    expect(fresh.data.tasks).toHaveLength(20);
  });
});
