// Agent options for tasks
export type Agent = 'claude' | 'codex' | 'gemini' | 'other';

export const AGENTS: Agent[] = ['claude', 'codex', 'gemini', 'other'];

export const AGENT_CONFIG: Record<Agent, { label: string }> = {
  claude: { label: 'Claude' },
  codex: { label: 'Codex' },
  gemini: { label: 'Gemini' },
  other: { label: 'Other' },
};

// Priority levels: P0 = urgent, P1 = normal, P2 = low
export type Priority = 0 | 1 | 2;

export const PRIORITIES: Priority[] = [0, 1, 2];

export const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; ansi: string }> = {
  0: { label: 'P0', color: '#ef4444', ansi: '\x1b[31m' }, // red - urgent
  1: { label: 'P1', color: '#f59e0b', ansi: '\x1b[33m' }, // yellow - normal
  2: { label: 'P2', color: '#6b7280', ansi: '\x1b[90m' }, // gray - low
};

export type CommentAuthor = 'user' | 'mcp';

export type TaskComment = {
  id: string;
  body: string;
  author: CommentAuthor;
  agent_name?: string;
  created_at: string;
};

// Guardrail for agent loop integration (higher number = more critical)
export type Guardrail = {
  id: string;
  number: number;
  text: string;
};

// Task represents a single work item.
export type Task = {
  id: string;
  title: string;
  status: string; // e.g. "todo" | "in_progress" | "done"
  depends_on: string[];
  comments?: TaskComment[];
  epic_id?: string;
  project_id: string;
  agent?: Agent; // Optional agent assignment
  archived?: boolean; // Whether the task is archived
  priority?: Priority; // P0 = urgent, P1 = normal, P2 = low
  blocked_reason?: string; // External blocker (meeting, approval, etc.)
  acceptance_criteria?: string[]; // Observable behavioral outcomes for verification
  guardrails?: Guardrail[]; // Numbered instructions (higher = more critical)
  blob_ids?: string[]; // References to Blob.id
  workers?: string[]; // Agent team members currently working on this task
  created_at?: string;
  updated_at?: string;
};

// Epic represents a grouped set of tasks.
export type Epic = {
  id: string;
  title: string;
  status: string;
  depends_on: string[];
  notes: string;
  auto: boolean;
  project_id: string;
};

// Project visibility: public = anyone can read, private = key required
export type ProjectVisibility = 'public' | 'private';

// Project represents a Kanban project.
export type Project = {
  id: string;
  name: string;
  description?: string;
  visibility?: ProjectVisibility;
  columns?: Column[]; // Board columns. Absent means DEFAULT_COLUMNS.
};

// ============ API Key Types ============

// Key scope: server = full access, project = specific projects only
export type KeyScope =
  | { type: 'server' }
  | { type: 'project'; project_ids: string[] };

// Stored API key (hash only, never the raw key)
export type ApiKey = {
  id: string;
  prefix: string;          // First 12 chars for display (flx_xxxxxxxx)
  hash: string;            // SHA-256 hash of full key
  name: string;
  scope: KeyScope;
  created_at: string;
  last_used_at?: string;
};

// Pending CLI auth request (temp token -> eventual key)
export type CliAuthRequest = {
  token: string;           // Temp token for polling
  name?: string;           // Key name (set by web)
  scope?: KeyScope;        // Key scope (set by web)
  api_key?: string;        // Created key (set after completion)
  expires_at: string;
  completed_at?: string;
};

// Blob represents an attached file (content stored on filesystem).
export type Blob = {
  id: string;            // Short unique ID
  hash: string;          // SHA-256 hex digest of content
  filename: string;      // Original filename (e.g., "mockup.png")
  mime_type: string;     // e.g., "image/png"
  size: number;          // Bytes
  task_id?: string;      // Optional association
  created_at: string;
};

// Store is the JSON document root.
export type Store = {
  projects: Project[];
  epics: Epic[];
  tasks: Task[];
  blobs?: Blob[];
};

// ============ Board Columns ============

// A column's ROLE is what Flux understands the column to mean. Labels are free
// text and may be renamed at will; behaviour is driven by the role, never by the
// label or the id.
//
//   backlog - not yet committed to. A task here cannot be moved straight into an
//             'active' column; it must pass through a 'ready' column first.
//   ready   - committed to and startable. Where new tasks and dependency-unblocked
//             work waits to be picked up.
//   active  - being worked on right now. Moving a task here records the agent in
//             task.workers.
//   done    - terminal. Satisfies dependencies for other tasks, drops out of the
//             ready list, counts towards project progress, and clears task.workers.
export type ColumnRole = 'backlog' | 'ready' | 'active' | 'done';

export const COLUMN_ROLES: ColumnRole[] = ['backlog', 'ready', 'active', 'done'];

export const COLUMN_ROLE_CONFIG: Record<ColumnRole, { label: string; description: string }> = {
  backlog: {
    label: 'Not started',
    description: 'Ideas and unplanned work. Tasks here must move to a startable column before an agent can begin them.',
  },
  ready: {
    label: 'Ready to start',
    description: 'Committed work waiting to be picked up. Agents look here for their next task.',
  },
  active: {
    label: 'Being worked on',
    description: 'Work in flight. Moving a task here records which agent is on it.',
  },
  done: {
    label: 'Finished',
    description: 'Complete. Unblocks anything waiting on this task and counts towards progress.',
  },
};

// A single column on the board.
export type Column = {
  id: string;      // Stable slug, e.g. 'in_progress'. NEVER changes once created -
                   // it is what Task.status holds and what agents pass over MCP.
  label: string;   // Display name, sentence case. Freely renameable.
  color: string;   // Hex swatch, e.g. '#3b82f6'
  role: ColumnRole;
  order: number;   // Left-to-right position, ascending
};

// The four columns every project starts with. These reproduce Flux's original
// hardcoded behaviour exactly, so existing projects and existing tasks are
// unaffected by the move to configurable columns.
export const DEFAULT_COLUMNS: Column[] = [
  { id: 'planning', label: 'Planning', color: '#a855f7', role: 'backlog', order: 0 },
  { id: 'todo', label: 'To do', color: '#6b7280', role: 'ready', order: 1 },
  { id: 'in_progress', label: 'In progress', color: '#3b82f6', role: 'active', order: 2 },
  { id: 'done', label: 'Done', color: '#22c55e', role: 'done', order: 3 },
];

// Palette offered when creating a column.
export const COLUMN_COLORS = [
  '#a855f7', // purple
  '#6b7280', // gray
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
  '#ec4899', // pink
];

// Turn a user-typed column name into a stable id, unique within `existing`.
export function slugifyColumnId(label: string, existing: string[] = []): string {
  const base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'column';
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

// Validate a column list before it is saved. Returns an error message, or null
// when the list is usable. A board with no startable column or no finished
// column would strand every task and break dependency tracking.
export function validateColumns(columns: Column[]): string | null {
  if (!Array.isArray(columns) || columns.length === 0) {
    return 'A board needs at least one column.';
  }
  const ids = columns.map(c => c.id);
  if (new Set(ids).size !== ids.length) {
    return 'Two columns cannot share the same id.';
  }
  for (const c of columns) {
    if (!c.id || !/^[a-z0-9_]+$/.test(c.id)) {
      return `Column id "${c.id}" must be lowercase letters, numbers and underscores.`;
    }
    if (!c.label || !c.label.trim()) {
      return 'Every column needs a name.';
    }
    if (!COLUMN_ROLES.includes(c.role)) {
      return `Column "${c.label}" has an unknown role "${c.role}".`;
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(c.color)) {
      return `Column "${c.label}" needs a colour like #3b82f6.`;
    }
  }
  if (!columns.some(c => c.role === 'ready')) {
    return 'Keep at least one column for work that is ready to start.';
  }
  if (!columns.some(c => c.role === 'done')) {
    return 'Keep at least one column for finished work, or nothing can ever complete.';
  }
  return null;
}

// Sort a column list into board order without mutating the input.
export function sortColumns(columns: Column[]): Column[] {
  return [...columns].sort((a, b) => a.order - b.order);
}

// Compare two server snapshots independent of harmless order gaps. This is used
// by conditional column writes so a stale editor cannot overwrite a newer one.
export function columnsEqual(a: Column[], b: Column[]): boolean {
  const normalise = (columns: Column[]) =>
    sortColumns(columns).map((column, order) => ({
      id: column.id,
      label: column.label,
      color: column.color,
      role: column.role,
      order,
    }));
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

// Agent-path guardrail: MCP and CLI deliberately enforce this, while REST and
// direct store writes do not because a human board move is the start decision.
export function getTaskColumnTransitionError(
  columns: Column[],
  currentColumnId: string,
  targetColumnId: string
): string | null {
  const current = columns.find(column => column.id === currentColumnId);
  const target = columns.find(column => column.id === targetColumnId);
  if (current?.role !== 'backlog' || target?.role !== 'active') return null;

  const readyColumns = columns
    .filter(column => column.role === 'ready')
    .map(column => `${column.id} (${column.label})`)
    .join(', ');
  return `Cannot start a task from a not-started column. Move it to a startable column first: ${readyColumns}.`;
}

// ---- Legacy status constants ----
// Retained so nothing breaks while callers migrate to project columns. Prefer
// getColumns(projectId) from the store: these describe the DEFAULTS only and are
// wrong for any project whose columns have been customised.
export type Status = 'planning' | 'todo' | 'in_progress' | 'done';

export const STATUSES: Status[] = ['planning', 'todo', 'in_progress', 'done'];

// Status display names and colors
export const STATUS_CONFIG: Record<Status, { label: string; color: string }> = {
  planning: { label: 'Planning', color: '#a855f7' },
  todo: { label: 'To do', color: '#6b7280' },
  in_progress: { label: 'In progress', color: '#3b82f6' },
  done: { label: 'Done', color: '#22c55e' },
};

// Epic colors palette
export const EPIC_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // orange/amber
  '#8b5cf6', // purple
  '#ef4444', // red
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
];

// ============ Webhook Types ============

// Webhook event types
export type WebhookEventType =
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'epic.created'
  | 'epic.updated'
  | 'epic.deleted'
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.status_changed'
  | 'task.archived';

export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  'project.created',
  'project.updated',
  'project.deleted',
  'epic.created',
  'epic.updated',
  'epic.deleted',
  'task.created',
  'task.updated',
  'task.deleted',
  'task.status_changed',
  'task.archived',
];

// Webhook event type labels for UI
export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  'project.created': 'Project created',
  'project.updated': 'Project updated',
  'project.deleted': 'Project deleted',
  'epic.created': 'Epic created',
  'epic.updated': 'Epic updated',
  'epic.deleted': 'Epic deleted',
  'task.created': 'Task created',
  'task.updated': 'Task updated',
  'task.deleted': 'Task deleted',
  'task.status_changed': 'Task moved',
  'task.archived': 'Task archived',
};

// Webhook configuration
export type Webhook = {
  id: string;
  name: string;
  url: string;
  secret?: string; // Optional secret for HMAC signature verification
  events: WebhookEventType[];
  enabled: boolean;
  project_id?: string; // Optional: only trigger for specific project
  created_at: string;
  updated_at: string;
};

// Webhook delivery record
export type WebhookDelivery = {
  id: string;
  webhook_id: string;
  event: WebhookEventType;
  payload: WebhookPayload;
  status: 'pending' | 'success' | 'failed';
  response_code?: number;
  response_body?: string;
  error?: string;
  attempts: number;
  created_at: string;
  delivered_at?: string;
};

// Webhook payload structure
export type WebhookPayload = {
  event: WebhookEventType;
  timestamp: string;
  webhook_id: string;
  data: {
    project?: Project;
    epic?: Epic;
    task?: Task;
    previous?: Partial<Project | Epic | Task>; // For update events
  };
};

// Store is the JSON document root - updated to include webhooks and auth
export type StoreWithWebhooks = Store & {
  webhooks?: Webhook[];
  webhook_deliveries?: WebhookDelivery[];
  api_keys?: ApiKey[];
  cli_auth_requests?: CliAuthRequest[];
};
