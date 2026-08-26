# What this fork changes

This repo is a fork of [sirsjg/flux](https://github.com/sirsjg/flux) by Steve Grehan, MIT licensed.
**Upstream is the source of truth.** Everything here is a change layered on top, and this file is the
running record of what those changes are, so the delta never becomes a mystery.

If you are reading this to decide whether to pull upstream changes: yes, you generally can. The changes
below are additive and concentrated in a small number of files.

---

## Custom board columns

Upstream Flux has exactly four columns, hardcoded in `packages/shared/src/types.ts`:
Planning, To do, In progress, Done. This fork makes columns per-project data you can add, rename,
recolour, reorder and delete from the board itself.

### Why it needed more than a rename box

Three of upstream's four column names carry behaviour, not just a label:

- **`done`** is what tells Flux a task is finished. It satisfies other tasks' dependencies, drops the task
  out of `list_ready_tasks`, counts towards project progress, and clears `task.workers`.
- **`in_progress`** is what records which agent is working on a task, in `task.workers`.
- **`planning`** is a gate: an agent cannot move a task straight from planning into in_progress.

So a custom column has to declare what it *means*, or renaming a column would quietly break dependency
tracking. Every column therefore carries a **role**:

| Role | Shown in the UI as | What Flux does with it |
|---|---|---|
| `backlog` | Not started | Agents cannot start a task directly from here |
| `ready` | Ready to start | Where agents look for their next task |
| `active` | Being worked on | Moving a task here records the agent in `task.workers` |
| `done` | Finished | Unblocks dependents, leaves the ready list, counts as progress |

All behaviour keys off the **role**, never off a column's name or id. That is the whole idea: you can call
a column anything you like, and Flux still knows what it means.

### Rules that hold

- A column's **id is stable**. Renaming changes the label only — the id is what `Task.status` stores and
  what agents pass over MCP, so a rename can never orphan a task.
- **Deleting a column always asks where its tasks go.** Nothing is ever deleted with the column, including
  archived tasks. The board refuses to strand a task.
- A board must keep **at least one `ready` column and at least one `done` column**, or nothing could ever
  be started or completed.
- Only a task in an **`active`** column carries `workers`. Move it anywhere else — or change that column's
  role — and the agent badges are cleared.
- Projects with no `columns` field fall back to the original four, with the original roles. **Existing
  boards are unaffected.**

### The one deliberate asymmetry

A **person** can drag a card straight from a not-started column into a being-worked-on column. An **agent**
cannot; it must go through a ready column first.

That is intentional and it is upstream's behaviour, kept. The gate exists to stop an agent picking up work
nobody has committed to yet. When you drag a card yourself, you *are* the human decision the gate is there
to wait for. The gate therefore lives only on the MCP and CLI paths — see the comment on
`getTaskColumnTransitionError` in `packages/shared/src/types.ts` before "fixing" the inconsistency.

### New surfaces

REST:

```
GET    /api/projects/:projectId/columns
PUT    /api/projects/:projectId/columns      # whole-list replace: add, rename, recolour, reorder
DELETE /api/projects/:projectId/columns/:id  # body { moveTasksTo } — tasks are moved, never dropped
```

Whole-list replace is deliberate: it makes reordering atomic and stops two editors racing. A stale write
is rejected with `409` rather than silently overwriting someone else's change.

MCP: a new **`list_columns`** tool, so an agent can discover a board it has never seen. The `status`
parameter on `update_task`, `move_task_status`, `list_tasks` and `update_epic` is no longer a fixed enum —
it is validated per project at call time, because columns differ from board to board.

### Files touched

`packages/shared/src/types.ts` and `store.ts` (the model and all role logic), `packages/server/src/index.ts`
(routes and validation), `packages/mcp/src/index.ts` (tool contract), `packages/cli/src/commands/task.ts`,
and in the web app `pages/Board.tsx` plus new `components/BoardColumns.tsx`, `components/ManageColumnsModal.tsx`
and three hooks.

---

## Fixes to upstream's setup path

Upstream's `scripts/quickstart.sh` pulls the published `sirsjg/flux-mcp` image, force-removes any existing
`flux-web` container, and never sets `FLUX_DIR`. In this fork setup **builds from source** (otherwise you
would get upstream Flux without any of the above), never removes a container it did not create, and sets
both `FLUX_DIR` and `FLUX_DATA`. Without `FLUX_DIR` the server dies on boot with
`EACCES: permission denied, mkdir '/home/flux'`.

## Smaller changes

- Sentence-case UI labels throughout ("In progress", not "In Progress"), including webhook event names.
- A task whose `epic_id` was `null` or `""` disappeared from the board entirely; it now shows under
  Unassigned.
- The board's columns now refresh live over SSE, so a column added elsewhere does not make tasks vanish
  from an open board.

## Known, inherited from upstream

- Five tests in `packages/server/tests/auth.test.ts` fail on a clean upstream checkout too (dev-mode auth
  environment leakage). Not caused by anything here.
- The SQLite storage adapter does not persist `api_keys`, so API keys do not survive a restart when using
  SQLite. Only matters if you turn authentication on.
