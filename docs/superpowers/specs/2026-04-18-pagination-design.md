# Script Results Pagination Design

**Date:** 2026-04-18  
**Status:** Approved  

## Problem

Running queries like `db.getCollection("notification_config").find({})` loads all documents into memory. Large collections cause performance issues. Default page size should be 50.

## Approach

Harness-level cursor proxy interception. The Node.js harness already wraps collections in a Proxy; extend it to intercept `find()` and `aggregate()` calls, inject skip/limit, and emit a pagination metadata event. The full script re-runs on each page change.

## Data Flow

1. `EditorArea` calls `runScript(tabId, connId, db, script, page, pageSize)` — `page` defaults to 0, `pageSize` to 50
2. Tauri backend passes `MONGO_PAGE` and `MONGO_PAGE_SIZE` env vars to the Node.js child process
3. `harness.js` Proxy intercepts `find(filter)` and `aggregate(pipeline)`:
   - Runs `countDocuments(filter)` (or count pipeline) in parallel to get total
   - Injects `.skip(page * pageSize).limit(pageSize)` on find cursors
   - Injects `{ $skip }` and `{ $limit }` stages at end of aggregate pipelines
   - Emits `{ __pagination: { total, page, pageSize } }` as a special stdout event
4. Tauri parses this event, emits it as a `script-event` with type `pagination`
5. `useScriptEvents` stores pagination state in the results store
6. `ResultsPanel` renders pagination controls from that state

## Components Changed

### `runner/harness.js`
- Read `MONGO_PAGE` and `MONGO_PAGE_SIZE` from env vars
- Extend collection Proxy to intercept `find()`: run `countDocuments()` in parallel, apply skip/limit to cursor
- Extend collection Proxy to intercept `aggregate()`: inject `$skip`/`$limit` stages, run count pipeline in parallel
- Emit `{ __pagination: { total, page, pageSize } }` to stdout

### `src-tauri/src/commands/script.rs`
- Accept `page: u32` and `page_size: u32` params (defaults: 0, 50)
- Pass `MONGO_PAGE` and `MONGO_PAGE_SIZE` env vars to child process

### `src/ipc.ts`
- Add `page?: number` and `pageSize?: number` to `runScript` signature

### `src/store/results.ts`
- Add `pagination?: { total: number; page: number; pageSize: number }` to per-tab state
- Add `setPagination(tabId, pagination)` action

### `src/hooks/useScriptEvents.ts`
- Handle `pagination` event type → dispatch `setPagination`

### `src/types.ts`
- Add `PaginationState` type

### `src/components/results/ResultsPanel.tsx`
- Render pagination controls when `pagination` is set:
  - `← Prev` / `Next →` buttons (disabled at boundaries)
  - Page input: `Page [2] of 47` — user types number, presses Enter to jump

### `src/components/editor/EditorArea.tsx`
- Track `currentPage` in local state, reset to 0 on new script run
- On page change: re-call `runScript` with updated page number

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Write ops (insertMany, updateMany, etc.) | Not intercepted; no pagination event; controls hidden |
| Non-find scripts (no cursor) | No `__pagination` emitted; controls hidden |
| Multiple `find()` in one script | Each gets skip/limit injected; last `__pagination` event wins |
| Aggregate with existing `$limit` | `$skip`/`$limit` appended after; documented as known limitation |
| Page input out of range | Clamped to `[0, totalPages-1]`; UI is 1-indexed, internal is 0-indexed |
| Script changes while paginating | `currentPage` resets to 0 on next run |
| Empty page (jump to page 999) | Shows "No results"; Next disabled; Prev navigates back |
| `countDocuments` fails (views, capped) | Emit `total: -1`; hide page count; use `returnedDocs < pageSize` for boundary detection |

## Known Limitations

- Aggregate pipelines with a user-supplied `$limit` stage may behave unexpectedly since pagination stages are appended after.
- Entire script re-runs on each page change (acceptable for read-only operations).
