import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { Store } from '../types.js';
import type { StorageAdapter } from '../store.js';

function createDefaultData(): Store {
  return {
    projects: [],
    epics: [],
    tasks: [],
  };
}

type CollectionKey = 'projects' | 'epics' | 'tasks' | 'blobs';
type CollectionSnapshot = Record<CollectionKey, Map<string, string>>;

function snapshotCollection(value: unknown): Map<string, string> {
  if (!Array.isArray(value)) return new Map();
  return new Map(value.map(item => [item.id, JSON.stringify(item)]));
}

function snapshotCollections(store: Store): CollectionSnapshot {
  return {
    projects: snapshotCollection(store.projects),
    epics: snapshotCollection(store.epics),
    tasks: snapshotCollection(store.tasks),
    blobs: snapshotCollection(store.blobs),
  };
}

export function createSqliteAdapter(filePath: string): StorageAdapter {
  // Ensure directory exists
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(filePath, { create: true });

  // WAL mode for better concurrency with multiple readers
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS store (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)');

  const selectStmt = db.prepare('SELECT data FROM store WHERE id = 1');
  const insertStmt = db.prepare('INSERT OR IGNORE INTO store (id, data) VALUES (1, ?)');
  const updateStmt = db.prepare('UPDATE store SET data = ? WHERE id = 1');

  let _data: Store = createDefaultData();
  let _snapshot = snapshotCollections(_data);

  // Helper to read fresh data from DB
  const readFromDb = (): Store => {
    const row = selectStmt.get() as { data?: string } | null;
    if (row?.data) {
      try {
        return JSON.parse(row.data) as Store;
      } catch {
        return createDefaultData();
      }
    }
    return createDefaultData();
  };

  return {
    get data() {
      return _data;
    },
    read() {
      // Always refresh from DB - critical for concurrent access
      _data = readFromDb();
      _snapshot = snapshotCollections(_data);
      if (!selectStmt.get()) {
        // Initialize DB if empty
        insertStmt.run(JSON.stringify(_data));
      }
    },
    write() {
      // Acquire the write lock before reading so separate processes cannot both
      // read the same row and then fail while upgrading to writers.
      const merged = db.transaction(() => {
        // Re-read current state inside transaction
        const current = readFromDb();

        // Apply only this adapter's changes over the current database row. A full
        // stale overlay would resurrect another process's deletes and revert its
        // updates, while a wholesale overwrite would lose its newly created rows.
        const merged: Store = {
          projects: mergeById(current.projects, _data.projects, _snapshot.projects),
          epics: mergeById(current.epics, _data.epics, _snapshot.epics),
          tasks: mergeById(current.tasks, _data.tasks, _snapshot.tasks),
          blobs: mergeById(current.blobs || [], _data.blobs || [], _snapshot.blobs),
        };

        const serialized = JSON.stringify(merged);
        const row = selectStmt.get();
        if (row) {
          updateStmt.run(serialized);
        } else {
          insertStmt.run(serialized);
        }

        return merged;
      }).immediate();

      // Do not advance local state until SQLite has committed successfully.
      _data = merged;
      _snapshot = snapshotCollections(merged);
    },
  };
}

/**
 * Three-way merge arrays by ID using this adapter's last database snapshot.
 *
 * New or locally changed items overwrite the current row, locally deleted items
 * are removed, and unchanged local items defer to the current row. That last case
 * prevents a stale adapter from undoing another process's update or deletion.
 */
function mergeById<T extends { id: string }>(
  current: T[],
  updated: T[],
  snapshot: Map<string, string>,
): T[] {
  const result = new Map(current.map(item => [item.id, item]));
  const updatedIds = new Set<string>();

  for (const item of updated) {
    updatedIds.add(item.id);
    const previous = snapshot.get(item.id);
    if (previous === undefined || previous !== JSON.stringify(item)) {
      result.set(item.id, item);
    }
  }

  for (const id of snapshot.keys()) {
    if (!updatedIds.has(id)) {
      result.delete(id);
    }
  }

  return Array.from(result.values());
}
