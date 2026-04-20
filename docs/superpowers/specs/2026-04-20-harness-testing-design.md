# Harness CLI & Integration Tests

**Date:** 2026-04-20  
**Status:** Approved

## Problem

`runner/harness.js` has two issues:
1. Shell-style projection `find({}, {status: 1})` silently fails — the Node.js driver expects `{ projection: {status: 1} }` as `FindOptions`, not a raw projection object.
2. No way to test harness behaviour without running the full Tauri app. No automated tests exist for the harness.

## Goals

1. Fix the projection normalization bug in `harness.js`.
2. Provide a file-based CLI to run harness queries manually from the terminal.
3. Add integration tests (real local MongoDB) runnable via a separate `npm run test:harness` command.

## Out of Scope

- Frontend changes
- Rust/Tauri changes
- Mocking MongoDB in tests

---

## Design

### 1. Projection Fix — `runner/harness.js`

In the `find` proxy (line 134–139), normalize shell-style projection before passing to the driver.

**Root cause:** `collection.find(filter, options)` in the Node.js driver v4+ expects `options` to be a `FindOptions` object (e.g. `{ projection: {status: 1} }`). Shell-style `{status: 1}` is not a recognized `FindOptions` key and is silently ignored.

**Fix:** Detect shell-style projection by checking whether any key in `options` matches known `FindOptions` keys. If none match, wrap the object as `{ projection: options }`.

```js
const FIND_OPTS = new Set([
  'projection', 'sort', 'limit', 'skip', 'hint',
  'maxTimeMS', 'batchSize', 'readPreference', 'collation', 'comment', 'session'
]);

if (prop === 'find') {
  return (filter = {}, options) => {
    let driverOptions = options;
    if (options && typeof options === 'object') {
      const hasDriverKey = Object.keys(options).some(k => FIND_OPTS.has(k));
      if (!hasDriverKey) driverOptions = { projection: options };
    }
    const rawCursor = val.call(target, filter, driverOptions);
    const countPromise = target.countDocuments(filter).catch(() => -1);
    return makeCursorProxy(rawCursor, countPromise);
  };
}
```

Both syntaxes work transparently after this fix:
- Shell-style: `find({}, {status: 1})` → normalized to `{ projection: {status: 1} }`
- Driver-style: `find({}, {projection: {status: 1}})` → passed through unchanged

---

### 2. CLI — `runner/cli.js`

A Node.js script for running harness queries from the terminal without the Tauri app.

**Usage:**
```bash
node runner/cli.js --db <database> --file <query-file> [--uri <mongo-uri>] [--page <n>] [--page-size <n>]
```

**Defaults:**
- `--uri`: `mongodb://localhost:27017`
- `--page`: `0`
- `--page-size`: `10`

**Behaviour:**
- Reads the query file from `--file`
- Spawns `harness.js` with env vars: `MONGO_URI`, `MONGO_PAGE`, `MONGO_PAGE_SIZE`
- Parses stdout line-by-line:
  - `__group` lines → pretty-printed JSON docs with group header
  - `__pagination` line → summary footer
  - `__error` → prints to stderr, exits with code 1
- Streams stderr `__debug` lines when `--debug` flag is set

**Example output:**
```
[group 0] 2 docs
{
  "_id": "693980b9199cbf78a2af86d6",
  "status": "pending"
}
{
  "_id": "696d192d6c57f7103618c20a",
  "status": "closed"
}

Page 0 · showing 2 of 38 · page size 10
```

---

### 3. Integration Tests — `runner/__tests__/harness.test.js`

Integration tests that spawn the harness as a child process against local MongoDB.

**Test environment:**
- Connection: `mongodb://localhost:27017`
- Database: `marketplace`
- Collection: `alert_tracker` (38 docs, statuses: pending/closed/done/error)

**Test cases:**

| # | Name | Query | Assertion |
|---|------|-------|-----------|
| 1 | Basic find | `db.alert_tracker.find({})` | Returns docs with all fields present |
| 2 | Sort descending | `db.alert_tracker.find({}).sort({status: -1})` | First doc has status `pending` (p > e > d > c) |
| 3 | Shell-style projection | `db.alert_tracker.find({}, {status: 1})` | Docs have only `_id` + `status` keys |
| 4 | Driver-style projection | `db.alert_tracker.find({}, {projection: {status: 1}})` | Same result as test 3 |
| 5 | Pagination total | `db.alert_tracker.find({})` with page-size 5 | `__pagination.total` = 38 |
| 6 | Pagination page offset | Page 0 vs page 1 with page-size 5 | Different doc sets, no overlap |
| 7 | Aggregate | `db.alert_tracker.aggregate([{$group:{_id:"$status",count:{$sum:1}}}])` | Result includes `{_id:"pending",count:20}` |
| 8 | Error handling | `db.alert_tracker.find(INVALID` (syntax error) | `__error` on stderr, exit code 1 |

**Supporting files:**

- `vitest.config.harness.ts` — separate vitest config with `environment: 'node'`, includes `runner/__tests__/**/*.test.js`
- `package.json` — adds `"test:harness": "vitest run --config vitest.config.harness.ts"`

**Test helper:** A shared `spawnHarness(query, opts)` utility writes a temp file, spawns the harness, collects stdout/stderr, and returns parsed `{ groups, pagination, error }`. Each test uses this helper.

---

## File Changes

| File | Change |
|------|--------|
| `runner/harness.js` | Fix projection normalization in `find` proxy |
| `runner/cli.js` | New — file-based CLI |
| `runner/__tests__/harness.test.js` | New — 8 integration tests |
| `vitest.config.harness.ts` | New — Node environment vitest config |
| `package.json` | Add `test:harness` script |
