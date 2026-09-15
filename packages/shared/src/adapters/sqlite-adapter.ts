import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { StoreWithWebhooks } from '../types.js';
import type { StorageAdapter } from '../store.js';

const defaultData: StoreWithWebhooks = {
  projects: [],
  epics: [],
  tasks: [],
};

type Identified = { id: string };
type TokenIdentified = { token: string };

function cloneStore(data: StoreWithWebhooks): StoreWithWebhooks {
  return JSON.parse(JSON.stringify(data)) as StoreWithWebhooks;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// Apply only the fields changed by this writer. Unchanged fields keep the
// newest committed value, so two agents editing different parts of one record
// do not silently undo each other.
function mergeRecord<T extends object>(baseline: T, current: T, updated: T): T {
  const baselineRecord = baseline as Record<string, unknown>;
  const currentRecord = current as Record<string, unknown>;
  const updatedRecord = updated as Record<string, unknown>;
  const result = { ...currentRecord };
  const keys = new Set([...Object.keys(baselineRecord), ...Object.keys(updatedRecord)]);

  for (const key of keys) {
    const baselineHasKey = Object.prototype.hasOwnProperty.call(baselineRecord, key);
    const updatedHasKey = Object.prototype.hasOwnProperty.call(updatedRecord, key);
    const changed = baselineHasKey !== updatedHasKey
      || !valuesEqual(baselineRecord[key], updatedRecord[key]);

    if (!changed) continue;
    if (!updatedHasKey || updatedRecord[key] === undefined) {
      delete result[key];
    } else {
      result[key] = updatedRecord[key];
    }
  }

  return result as T;
}

// Three-way merge: baseline is what this adapter originally read, current is
// the latest committed state, and updated is this adapter's local state.
// Local deletions remain deletions, remote additions survive, and a stale
// writer cannot revive a record another writer already deleted.
function mergeCollection<T extends object>(
  baseline: T[],
  current: T[],
  updated: T[],
  getKey: (item: T) => string
): T[] {
  const baselineByKey = new Map(baseline.map(item => [getKey(item), item]));
  const updatedByKey = new Map(updated.map(item => [getKey(item), item]));
  const result = new Map(current.map(item => [getKey(item), item]));

  for (const key of baselineByKey.keys()) {
    if (!updatedByKey.has(key)) result.delete(key);
  }

  for (const [key, updatedItem] of updatedByKey) {
    const baselineItem = baselineByKey.get(key);
    if (!baselineItem) {
      result.set(key, updatedItem);
      continue;
    }

    const currentItem = result.get(key);
    if (!currentItem) continue;
    result.set(key, mergeRecord(baselineItem, currentItem, updatedItem));
  }

  return Array.from(result.values());
}

function mergeStores(
  baseline: StoreWithWebhooks,
  current: StoreWithWebhooks,
  updated: StoreWithWebhooks
): StoreWithWebhooks {
  const byId = <T extends Identified>(item: T) => item.id;
  const byToken = <T extends TokenIdentified>(item: T) => item.token;

  return {
    ...current,
    projects: mergeCollection(baseline.projects, current.projects, updated.projects, byId),
    epics: mergeCollection(baseline.epics, current.epics, updated.epics, byId),
    tasks: mergeCollection(baseline.tasks, current.tasks, updated.tasks, byId),
    blobs: mergeCollection(baseline.blobs || [], current.blobs || [], updated.blobs || [], byId),
    webhooks: mergeCollection(baseline.webhooks || [], current.webhooks || [], updated.webhooks || [], byId),
    webhook_deliveries: mergeCollection(
      baseline.webhook_deliveries || [],
      current.webhook_deliveries || [],
      updated.webhook_deliveries || [],
      byId
    ),
    api_keys: mergeCollection(baseline.api_keys || [], current.api_keys || [], updated.api_keys || [], byId),
    cli_auth_requests: mergeCollection(
      baseline.cli_auth_requests || [],
      current.cli_auth_requests || [],
      updated.cli_auth_requests || [],
      byToken
    ),
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
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS store (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)');

  const selectStmt = db.prepare('SELECT data FROM store WHERE id = 1');
  const insertStmt = db.prepare('INSERT INTO store (id, data) VALUES (1, ?)');
  const updateStmt = db.prepare('UPDATE store SET data = ? WHERE id = 1');

  let _data: StoreWithWebhooks = cloneStore(defaultData);
  let baseline: StoreWithWebhooks = cloneStore(defaultData);

  // Helper to read fresh data from DB
  const readFromDb = (): StoreWithWebhooks => {
    const row = selectStmt.get() as { data?: string } | null;
    if (row?.data) {
      try {
        return JSON.parse(row.data) as StoreWithWebhooks;
      } catch {
        return cloneStore(defaultData);
      }
    }
    return cloneStore(defaultData);
  };

  return {
    get data() {
      return _data;
    },
    read() {
      // Always refresh from DB - critical for concurrent access
      _data = readFromDb();
      if (!selectStmt.get()) {
        // Initialize DB if empty
        insertStmt.run(JSON.stringify(_data));
      }
      baseline = cloneStore(_data);
    },
    write() {
      // Begin the write lock before reading so another process cannot change the
      // document between this merge and its commit.
      db.transaction(() => {
        const current = readFromDb();
        const merged = mergeStores(baseline, current, _data);
        const serialized = JSON.stringify(merged);
        const row = selectStmt.get();
        if (row) {
          updateStmt.run(serialized);
        } else {
          insertStmt.run(serialized);
        }
        _data = merged;
        baseline = cloneStore(merged);
      }).immediate();
    },
  };
}
