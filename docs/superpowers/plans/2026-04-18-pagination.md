# Script Results Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MongoDB query-level pagination (50 docs/page default) to script results, with Prev/Next buttons and a "Page X of Y" input that re-runs the script with skip/limit injected by the harness.

**Architecture:** The Node.js harness reads `MONGO_PAGE`/`MONGO_PAGE_SIZE` env vars, intercepts `find()` and `aggregate()` cursors in the collection proxy, applies skip/limit at materialization time, runs a parallel count query, and emits `{ __pagination: { total, page, pageSize } }` to stdout. Tauri parses this line in the stdout thread and emits it as a `script-event` with `kind: "pagination"`. The Zustand results store tracks per-tab `pagination` state. `ResultsPanel` renders the controls and calls `onPageChange(page)` back to `EditorArea`, which re-calls `runScript` with the new page.

**Tech Stack:** Tauri (Rust), React + TypeScript, Zustand, Vitest + Testing Library, MongoDB Node.js driver (v6), Node.js harness (`~/.mongomacapp/runner/harness.js`, bundled at compile time via `include_str!` in `executor.rs`)

---

## File Map

| File | Change |
|------|--------|
| `src/types.ts` | Add `PaginationState`; extend `ScriptEvent` with `pagination?` and `'pagination'` kind |
| `src/store/results.ts` | Add `pagination?: PaginationState` to `TabResults`; add `setPagination` action; clear in `startRun` |
| `src/ipc.ts` | Add `page?: number` and `pageSize?: number` to `runScript` |
| `src-tauri/src/commands/script.rs` | Add `PaginationInfo` struct; add `pagination` to `ScriptEvent`; accept `page`/`page_size` params; parse `__pagination` stdout event |
| `src-tauri/src/runner/executor.rs` | Add `page`/`page_size` params to `spawn_script`; pass as env vars |
| `runner/harness.js` | Read PAGE/PAGE_SIZE env vars; add `emitPagination`; extend `makeCursorProxy` with `countPromise`; intercept `find`/`aggregate` in proxy |
| `src/hooks/useScriptEvents.ts` | Handle `kind === 'pagination'`; call `setPagination` |
| `src/components/results/ResultsPanel.tsx` | Add `onPageChange` prop; render pagination controls using `pagination` from store |
| `src/components/editor/EditorArea.tsx` | Accept optional `page` in `handleRun`; pass `onPageChange` to `ResultsPanel` |
| `src/__tests__/store.test.ts` | Tests for `setPagination` and `startRun` clearing pagination |
| `src/__tests__/results-panel.test.tsx` | Tests for pagination controls rendering |

---

## Task 1: TypeScript types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `PaginationState` and update `ScriptEvent`**

In `src/types.ts`, add `PaginationState` and update `ScriptEvent` kind union and add `pagination` field:

```typescript
export interface PaginationState {
  total: number;   // -1 means count unavailable
  page: number;    // 0-indexed
  pageSize: number;
}
```

Replace the existing `ScriptEvent` interface with:

```typescript
export interface ScriptEvent {
  tabId: string;
  kind: 'group' | 'error' | 'done' | 'pagination';
  groupIndex?: number;
  docs?: unknown[];
  error?: string;
  executionMs?: number;
  pagination?: PaginationState;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/jagadeeshpulamarasetti/OwnCode/MongoMacApp
npx tsc --noEmit
```

Expected: no errors (or same errors as before — no new type errors).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add PaginationState and extend ScriptEvent"
```

---

## Task 2: Results store — pagination state

**Files:**
- Modify: `src/store/results.ts`
- Test: `src/__tests__/store.test.ts`

- [ ] **Step 1: Write failing test**

Append to the `'results store'` describe block in `src/__tests__/store.test.ts`:

```typescript
it('setPagination stores pagination for a tab', () => {
  useResultsStore.getState().startRun('t1');
  useResultsStore.getState().setPagination('t1', { total: 200, page: 1, pageSize: 50 });
  const r = useResultsStore.getState().byTab['t1'];
  expect(r.pagination).toEqual({ total: 200, page: 1, pageSize: 50 });
});

it('startRun clears previous pagination', () => {
  useResultsStore.getState().startRun('t1');
  useResultsStore.getState().setPagination('t1', { total: 200, page: 2, pageSize: 50 });
  useResultsStore.getState().startRun('t1');
  const r = useResultsStore.getState().byTab['t1'];
  expect(r.pagination).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
cd /Users/jagadeeshpulamarasetti/OwnCode/MongoMacApp
npx vitest run src/__tests__/store.test.ts
```

Expected: FAIL — `setPagination is not a function` (or similar).

- [ ] **Step 3: Update `TabResults` interface and add `setPagination` action**

Replace the full contents of `src/store/results.ts` with:

```typescript
import { create } from 'zustand';
import type { PaginationState, ResultGroup } from '../types';

interface TabResults {
  groups: ResultGroup[];
  isRunning: boolean;
  executionMs?: number;
  lastError?: string;
  pagination?: PaginationState;
}

interface ResultsState {
  byTab: Record<string, TabResults>;
  startRun: (tabId: string) => void;
  appendGroup: (tabId: string, group: ResultGroup) => void;
  setError: (tabId: string, error: string) => void;
  finishRun: (tabId: string, executionMs: number) => void;
  setPagination: (tabId: string, pagination: PaginationState) => void;
  clearTab: (tabId: string) => void;
}

export const useResultsStore = create<ResultsState>((set) => ({
  byTab: {},
  startRun: (tabId) =>
    set((s) => ({
      byTab: {
        ...s.byTab,
        [tabId]: { groups: [], isRunning: true, executionMs: undefined, lastError: undefined, pagination: undefined },
      },
    })),
  appendGroup: (tabId, group) =>
    set((s) => {
      const cur = s.byTab[tabId] ?? { groups: [], isRunning: true };
      return { byTab: { ...s.byTab, [tabId]: { ...cur, groups: [...cur.groups, group] } } };
    }),
  setError: (tabId, error) =>
    set((s) => {
      const cur = s.byTab[tabId] ?? { groups: [], isRunning: true };
      return { byTab: { ...s.byTab, [tabId]: { ...cur, isRunning: false, lastError: error } } };
    }),
  finishRun: (tabId, executionMs) =>
    set((s) => {
      const cur = s.byTab[tabId] ?? { groups: [], isRunning: true };
      return { byTab: { ...s.byTab, [tabId]: { ...cur, isRunning: false, executionMs } } };
    }),
  setPagination: (tabId, pagination) =>
    set((s) => {
      const cur = s.byTab[tabId] ?? { groups: [], isRunning: false };
      return { byTab: { ...s.byTab, [tabId]: { ...cur, pagination } } };
    }),
  clearTab: (tabId) =>
    set((s) => {
      const { [tabId]: _, ...rest } = s.byTab;
      return { byTab: rest };
    }),
}));
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npx vitest run src/__tests__/store.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/results.ts src/__tests__/store.test.ts
git commit -m "feat(store): add pagination state and setPagination action"
```

---

## Task 3: IPC signature

**Files:**
- Modify: `src/ipc.ts`

- [ ] **Step 1: Add `page` and `pageSize` params to `runScript`**

Replace the existing `runScript` function in `src/ipc.ts`:

```typescript
export async function runScript(
  tabId: string,
  connectionId: string,
  database: string,
  script: string,
  page = 0,
  pageSize = 50,
): Promise<void> {
  return invoke('run_script', { tabId, connectionId, database, script, page, pageSize });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/ipc.ts
git commit -m "feat(ipc): add page/pageSize params to runScript"
```

---

## Task 4: Rust ScriptEvent + pagination parsing

**Files:**
- Modify: `src-tauri/src/commands/script.rs`

- [ ] **Step 1: Add `PaginationInfo` struct and `pagination` field to `ScriptEvent`**

At the top of `src-tauri/src/commands/script.rs`, add `PaginationInfo` and update `ScriptEvent`:

```rust
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PaginationInfo {
    pub total: i64,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScriptEvent {
    pub tab_id: String,
    pub kind: String,
    pub group_index: Option<i64>,
    pub docs: Option<serde_json::Value>,
    pub error: Option<String>,
    pub execution_ms: Option<u128>,
    pub pagination: Option<PaginationInfo>,
}
```

- [ ] **Step 2: Add `page` and `page_size` params to `run_script` command**

Replace the `run_script` function signature:

```rust
#[tauri::command]
pub async fn run_script(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
    connection_id: String,
    database: String,
    script: String,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<(), String> {
```

Add these lines just before the `spawn_script` call (after `let script_path = ...`):

```rust
    let page = page.unwrap_or(0);
    let page_size = page_size.unwrap_or(50);
```

Update the `spawn_script` call to pass `page` and `page_size`:

```rust
        let mut child = spawn_script(&uri, &database, &script_path, page, page_size)?;
```

- [ ] **Step 3: Add `pagination` to all existing `ScriptEvent` constructions**

Every place that constructs a `ScriptEvent` must now include `pagination: None`. There are 4 such places (the group event, the done event, the error event in stderr, and the timeout error event). Add `pagination: None` to each:

In the stdout group event:
```rust
                        let evt = ScriptEvent {
                            tab_id: (*tab).clone(),
                            kind: "group".into(),
                            group_index: Some(idx),
                            docs: Some(docs.clone()),
                            error: None,
                            execution_ms: None,
                            pagination: None,
                        };
```

In the stderr error event:
```rust
                    let evt = ScriptEvent {
                        tab_id: (*tab).clone(),
                        kind: "error".into(),
                        group_index: None,
                        docs: None,
                        error: Some(err),
                        execution_ms: None,
                        pagination: None,
                    };
```

In the done event:
```rust
                let done = ScriptEvent {
                    tab_id: (*tab_id_arc).clone(),
                    kind: "done".into(),
                    group_index: None,
                    docs: None,
                    error: if status.success() { None } else { Some("exited with error".into()) },
                    execution_ms: Some(elapsed),
                    pagination: None,
                };
```

In the timeout error event:
```rust
                let evt = ScriptEvent {
                    tab_id: (*tab_id_arc).clone(),
                    kind: "error".into(),
                    group_index: None,
                    docs: None,
                    error: Some(format!("Script execution timed out ({SCRIPT_TIMEOUT_SECS}s)")),
                    execution_ms: None,
                    pagination: None,
                };
```

- [ ] **Step 4: Parse `__pagination` in the stdout thread**

In the stdout `for line in reader.lines().flatten()` loop, extend the `if let Ok(v) = ...` block to also handle `__pagination`. The full block (replacing lines 68–84 in `script.rs`) should be:

```rust
                for line in reader.lines().flatten() {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(pg) = v.get("__pagination") {
                            if let (Some(total), Some(page_val), Some(page_size_val)) = (
                                pg.get("total").and_then(|x| x.as_i64()),
                                pg.get("page").and_then(|x| x.as_u64()),
                                pg.get("pageSize").and_then(|x| x.as_u64()),
                            ) {
                                let evt = ScriptEvent {
                                    tab_id: (*tab).clone(),
                                    kind: "pagination".into(),
                                    group_index: None,
                                    docs: None,
                                    error: None,
                                    execution_ms: None,
                                    pagination: Some(PaginationInfo {
                                        total,
                                        page: page_val as u32,
                                        page_size: page_size_val as u32,
                                    }),
                                };
                                let _ = ah.emit("script-event", evt);
                            }
                        } else if let (Some(idx), Some(docs)) = (
                            v.get("__group").and_then(|x| x.as_i64()),
                            v.get("docs"),
                        ) {
                            let evt = ScriptEvent {
                                tab_id: (*tab).clone(),
                                kind: "group".into(),
                                group_index: Some(idx),
                                docs: Some(docs.clone()),
                                error: None,
                                execution_ms: None,
                                pagination: None,
                            };
                            let _ = ah.emit("script-event", evt);
                        }
                    }
                }
```

- [ ] **Step 5: Build to verify**

```bash
cd /Users/jagadeeshpulamarasetti/OwnCode/MongoMacApp/src-tauri
cargo build 2>&1 | tail -20
```

Expected: `Finished` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/script.rs
git commit -m "feat(rust): add pagination param to run_script and parse __pagination events"
```

---

## Task 5: Rust executor — pass page env vars

**Files:**
- Modify: `src-tauri/src/runner/executor.rs`

- [ ] **Step 1: Add `page` and `page_size` to `spawn_script`**

Replace the existing `spawn_script` signature and body in `src-tauri/src/runner/executor.rs`:

```rust
pub fn spawn_script(
    uri: &str,
    database: &str,
    script_path: &PathBuf,
    page: u32,
    page_size: u32,
) -> Result<std::process::Child, String> {
    let node = resolve_node().ok_or("Node.js not found — check node installation")?;
    println!("[spawn_script] node={node} harness={:?} db={database} page={page} page_size={page_size}", harness_path());
    Command::new(node)
        .arg(harness_path())
        .arg(database)
        .arg(script_path)
        .env("MONGO_URI", uri)
        .env("MONGO_PAGE", page.to_string())
        .env("MONGO_PAGE_SIZE", page_size.to_string())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| { println!("[spawn_script] failed: {e}"); e.to_string() })
}
```

- [ ] **Step 2: Build to verify**

```bash
cd /Users/jagadeeshpulamarasetti/OwnCode/MongoMacApp/src-tauri
cargo build 2>&1 | tail -20
```

Expected: `Finished` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/runner/executor.rs
git commit -m "feat(rust): pass MONGO_PAGE/MONGO_PAGE_SIZE env vars to harness"
```

---

## Task 6: Harness pagination

**Files:**
- Modify: `runner/harness.js`

- [ ] **Step 1: Read env vars and add `emitPagination`**

After line 12 (`let groupIndex = 0;`) in `runner/harness.js`, add:

```javascript
const PAGE = parseInt(process.env.MONGO_PAGE ?? '0', 10);
const PAGE_SIZE = parseInt(process.env.MONGO_PAGE_SIZE ?? '50', 10);

function emitPagination(total, page, pageSize) {
  process.stdout.write(
    JSON.stringify({ __pagination: { total, page, pageSize } }) + '\n',
  );
}
```

- [ ] **Step 2: Extend `makeCursorProxy` to accept and use `countPromise`**

Replace the entire `makeCursorProxy` function with:

```javascript
function makeCursorProxy(cursor, countPromise) {
  const modifiers = ['sort', 'limit', 'skip', 'project', 'hint', 'maxTimeMS', 'batchSize'];

  let promise;
  function materialize() {
    if (!promise) {
      if (countPromise !== undefined) {
        // Apply pagination after all user chaining is done
        cursor = cursor.skip(PAGE * PAGE_SIZE).limit(PAGE_SIZE);
        promise = Promise.all([cursor.toArray(), countPromise]).then(([docs, total]) => {
          emitGroup(docs);
          emitPagination(total, PAGE, PAGE_SIZE);
          return docs;
        });
      } else {
        promise = cursor.toArray().then((docs) => {
          emitGroup(docs);
          return docs;
        });
      }
    }
    return promise;
  }

  const proxy = {
    then: (res, rej) => materialize().then(res, rej),
    catch: (rej) => materialize().catch(rej),
    finally: (fn) => materialize().finally(fn),
    toArray: () => materialize(),
  };

  modifiers.forEach((m) => {
    if (typeof cursor[m] === 'function') {
      proxy[m] = (...args) => {
        cursor = cursor[m](...args);
        return proxy;
      };
    }
  });

  return proxy;
}
```

- [ ] **Step 3: Intercept `find` and `aggregate` in `makeCollectionProxy`**

Replace the `find`/`aggregate` branch in `makeCollectionProxy` (lines 114–115 in the original):

```javascript
      // find/aggregate: paginated cursors
      if (prop === 'find') {
        return (filter = {}, options) => {
          const rawCursor = val.call(target, filter, options);
          const countPromise = target.countDocuments(filter).catch(() => -1);
          return makeCursorProxy(rawCursor, countPromise);
        };
      }
      if (prop === 'aggregate') {
        return (pipeline = []) => {
          const paginatedPipeline = [...pipeline, { $skip: PAGE * PAGE_SIZE }, { $limit: PAGE_SIZE }];
          const rawCursor = val.call(target, paginatedPipeline);
          const countPipeline = [...pipeline, { $count: 'total' }];
          const countPromise = target.aggregate(countPipeline).toArray()
            .then((r) => (r[0]?.total ?? 0))
            .catch(() => -1);
          return makeCursorProxy(rawCursor, countPromise);
        };
      }
```

- [ ] **Step 4: Deploy updated harness**

The harness at `~/.mongomacapp/runner/harness.js` is what actually runs. Copy the updated file there:

```bash
cp /Users/jagadeeshpulamarasetti/OwnCode/MongoMacApp/runner/harness.js \
   ~/.mongomacapp/runner/harness.js
```

- [ ] **Step 5: Smoke-test the harness directly**

```bash
cd ~/.mongomacapp/runner
MONGO_URI="<your-local-mongo-uri>" MONGO_PAGE=0 MONGO_PAGE_SIZE=3 \
  node harness.js test "$(mktemp)"
```

The temp file is empty, so just check it doesn't crash. For a real test, write a temp script:

```bash
echo 'db.getCollection("test").find({})' > /tmp/test-pagination.js
MONGO_URI="mongodb://localhost:27017" MONGO_PAGE=0 MONGO_PAGE_SIZE=5 \
  node ~/.mongomacapp/runner/harness.js test /tmp/test-pagination.js
```

Expected stdout: one `{"__group":0,"docs":[...]}` line (≤5 docs) then a `{"__pagination":{"total":N,"page":0,"pageSize":5}}` line.

- [ ] **Step 6: Commit**

```bash
git add runner/harness.js
git commit -m "feat(harness): intercept find/aggregate cursors for pagination with countDocuments"
```

---

## Task 7: useScriptEvents hook

**Files:**
- Modify: `src/hooks/useScriptEvents.ts`

- [ ] **Step 1: Handle `'pagination'` kind**

Replace the full `useScriptEvents.ts` with:

```typescript
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useResultsStore } from '../store/results';
import type { ScriptEvent } from '../types';

export function useScriptEvents() {
  const { appendGroup, setError, finishRun, setPagination } = useResultsStore();

  useEffect(() => {
    let unsub: (() => void) | null = null;
    listen<ScriptEvent>('script-event', (e) => {
      const p = e.payload;
      console.log('[script-event]', p.kind, p.tabId, p.error ?? '');
      if (p.kind === 'group' && p.groupIndex !== undefined && p.docs !== undefined) {
        appendGroup(p.tabId, {
          groupIndex: p.groupIndex,
          docs: Array.isArray(p.docs) ? p.docs : [p.docs],
        });
      } else if (p.kind === 'pagination' && p.pagination) {
        setPagination(p.tabId, p.pagination);
      } else if (p.kind === 'error' && p.error) {
        setError(p.tabId, p.error);
      } else if (p.kind === 'done') {
        finishRun(p.tabId, p.executionMs ?? 0);
      }
    }).then((fn) => {
      unsub = fn;
    });
    return () => {
      if (unsub) unsub();
    };
  }, [appendGroup, setError, finishRun, setPagination]);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useScriptEvents.ts
git commit -m "feat(hook): handle pagination script-event kind"
```

---

## Task 8: ResultsPanel pagination controls

**Files:**
- Modify: `src/components/results/ResultsPanel.tsx`
- Test: `src/__tests__/results-panel.test.tsx`

- [ ] **Step 1: Write failing tests for pagination controls**

Append to `src/__tests__/results-panel.test.tsx`:

```typescript
describe('ResultsPanel pagination', () => {
  it('shows no pagination controls when pagination is absent', () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{ groupIndex: 0, docs: [{ id: 1 }] }],
          isRunning: false,
          executionMs: 5,
        },
      },
    });
    render(<ResultsPanel tabId="t1" onPageChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /prev/i })).not.toBeInTheDocument();
  });

  it('shows pagination controls when pagination is set', () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{ groupIndex: 0, docs: [{ id: 1 }] }],
          isRunning: false,
          executionMs: 5,
          pagination: { total: 200, page: 1, pageSize: 50 },
        },
      },
    });
    render(<ResultsPanel tabId="t1" onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /prev/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    expect(screen.getByText(/of 4/i)).toBeInTheDocument();
  });

  it('calls onPageChange with prev page when Prev clicked', async () => {
    const onPageChange = vi.fn();
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [],
          isRunning: false,
          pagination: { total: 200, page: 2, pageSize: 50 },
        },
      },
    });
    const user = userEvent.setup();
    render(<ResultsPanel tabId="t1" onPageChange={onPageChange} />);
    await user.click(screen.getByRole('button', { name: /prev/i }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('disables Prev on page 0', () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [],
          isRunning: false,
          pagination: { total: 100, page: 0, pageSize: 50 },
        },
      },
    });
    render(<ResultsPanel tabId="t1" onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
  });

  it('disables Next on last page', () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [],
          isRunning: false,
          pagination: { total: 100, page: 1, pageSize: 50 },
        },
      },
    });
    render(<ResultsPanel tabId="t1" onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });
});
```

Also add `import { vi } from 'vitest';` at the top of the test file (if not already present).

- [ ] **Step 2: Run tests to confirm failure**

```bash
npx vitest run src/__tests__/results-panel.test.tsx
```

Expected: FAIL — `onPageChange` prop not accepted, pagination controls not rendered.

- [ ] **Step 3: Implement pagination controls in `ResultsPanel`**

Replace `src/components/results/ResultsPanel.tsx` with:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useResultsStore } from '../../store/results';
import { JsonView } from './JsonView';
import { TableView } from './TableView';
import { toCsv, toJsonText } from '../../utils/export';

interface Props {
  tabId: string;
  onPageChange?: (page: number) => void;
}

export function ResultsPanel({ tabId, onPageChange }: Props) {
  const res = useResultsStore((s) => s.byTab[tabId]);
  const [view, setView] = useState<'json' | 'table'>('json');
  const pagination = res?.pagination;
  const totalPages = pagination && pagination.total >= 0
    ? Math.ceil(pagination.total / pagination.pageSize)
    : -1;

  // 1-indexed input synced to pagination.page
  const [inputPage, setInputPage] = useState(1);
  useEffect(() => {
    if (pagination) setInputPage(pagination.page + 1);
  }, [pagination?.page]);

  const allDocs = useMemo(() => {
    if (!res) return [];
    return res.groups.flatMap((g) => g.docs);
  }, [res]);

  async function exportAs(kind: 'csv' | 'json') {
    const suggested = kind === 'csv' ? 'results.csv' : 'results.json';
    const path = await saveDialog({ defaultPath: suggested });
    if (!path) return;
    const content = kind === 'csv' ? toCsv(allDocs) : toJsonText(allDocs);
    await writeTextFile(path as string, content);
  }

  function handlePageInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const parsed = parseInt(String(inputPage), 10);
    if (isNaN(parsed)) return;
    const clamped = Math.max(1, totalPages > 0 ? Math.min(parsed, totalPages) : parsed);
    setInputPage(clamped);
    onPageChange?.(clamped - 1); // convert to 0-indexed
  }

  if (!res || (res.groups.length === 0 && !res.isRunning && !res.lastError)) {
    return (
      <div style={{ padding: 12, color: 'var(--fg-dim)' }}>
        Run a script to see results.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-panel)',
        }}
      >
        <button onClick={() => setView('json')} disabled={view === 'json'}>JSON</button>
        <button onClick={() => setView('table')} disabled={view === 'table'}>Table</button>
        <button onClick={() => exportAs('csv')} disabled={allDocs.length === 0}>Export CSV</button>
        <button onClick={() => exportAs('json')} disabled={allDocs.length === 0}>Export JSON</button>
        <span style={{ marginLeft: 'auto', color: 'var(--fg-dim)', fontSize: 11 }}>
          {res.isRunning ? 'Running…' : `${allDocs.length} docs · ${res.executionMs ?? 0} ms`}
        </span>
      </div>
      {res.lastError && (
        <div style={{ padding: 8, color: 'var(--accent-red)', fontFamily: 'var(--font-mono)' }}>
          {res.lastError}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {view === 'json' ? <JsonView docs={allDocs} /> : <TableView docs={allDocs} />}
      </div>
      {pagination && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 8px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-panel)',
            fontSize: 12,
          }}
        >
          <button
            aria-label="Prev page"
            onClick={() => onPageChange?.(pagination.page - 1)}
            disabled={pagination.page === 0 || res.isRunning}
          >
            ← Prev
          </button>
          <span>Page</span>
          <input
            type="number"
            value={inputPage}
            min={1}
            max={totalPages > 0 ? totalPages : undefined}
            onChange={(e) => setInputPage(Number(e.target.value))}
            onKeyDown={handlePageInputKey}
            style={{ width: 48, textAlign: 'center' }}
          />
          <span>
            of {totalPages > 0 ? totalPages : '?'}
          </span>
          <button
            aria-label="Next page"
            onClick={() => onPageChange?.(pagination.page + 1)}
            disabled={(totalPages > 0 && pagination.page >= totalPages - 1) || res.isRunning}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npx vitest run src/__tests__/results-panel.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/ResultsPanel.tsx src/__tests__/results-panel.test.tsx
git commit -m "feat(ui): add pagination controls to ResultsPanel"
```

---

## Task 9: EditorArea wire-up

**Files:**
- Modify: `src/components/editor/EditorArea.tsx`

- [ ] **Step 1: Accept optional `page` in `handleRun` and pass `onPageChange` to ResultsPanel**

Replace `src/components/editor/EditorArea.tsx` with:

```tsx
import { useEditorStore } from '../../store/editor';
import { useConnectionsStore } from '../../store/connections';
import { ScriptEditor } from './ScriptEditor';
import { BrowseTab } from './BrowseTab';
import { runScript } from '../../ipc';
import { useResultsStore } from '../../store/results';
import { ResultsPanel } from '../results/ResultsPanel';
import { useCollectionCompletions } from '../../hooks/useCollectionCompletions';

export function EditorArea() {
  const { tabs, activeTabId, setActive, closeTab, updateContent, openTab } = useEditorStore();
  const { activeConnectionId, activeDatabase } = useConnectionsStore();
  const startRun = useResultsStore((s) => s.startRun);
  const finishRun = useResultsStore((s) => s.finishRun);
  const setError = useResultsStore((s) => s.setError);
  const active = tabs.find((t) => t.id === activeTabId);
  const completions = useCollectionCompletions(activeConnectionId, activeDatabase);

  async function handleRun(page = 0) {
    if (!active || active.type !== 'script') return;
    const connId = active.connectionId ?? activeConnectionId;
    const db = active.database ?? activeDatabase;
    if (!connId || !db) {
      alert('Select a connection and database first');
      return;
    }
    console.log('[handleRun] tabId:', active.id, 'connId:', connId, 'db:', db, 'page:', page);
    startRun(active.id);
    try {
      await runScript(active.id, connId, db, active.content, page, 50);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[handleRun] runScript failed:', msg);
      setError(active.id, msg);
      finishRun(active.id, 0);
    }
  }

  function newScriptTab() {
    const id = `script:${Date.now()}`;
    openTab({
      id,
      title: 'untitled.js',
      content: '// write your MongoDB script here\n',
      isDirty: false,
      type: 'script',
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
          height: 32,
          minHeight: 32,
        }}
      >
        <div style={{ display: 'flex', overflow: 'auto', flex: 1 }}>
          {tabs.map((t) => (
            <div
              key={t.id}
              onClick={() => setActive(t.id)}
              style={{
                padding: '0 10px',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                background: t.id === activeTabId ? 'var(--bg)' : 'transparent',
                borderRight: '1px solid var(--border)',
              }}
            >
              <span>
                {t.title}
                {t.isDirty && ' •'}
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                style={{ color: 'var(--fg-dim)' }}
              >
                ✕
              </span>
            </div>
          ))}
          <button onClick={newScriptTab} style={{ margin: '0 6px' }}>
            + New
          </button>
        </div>
        <div style={{ paddingRight: 10 }}>
          <button onClick={() => handleRun(0)} disabled={!active || active.type !== 'script'}>
            ▶ Run
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {!active && (
          <div style={{ padding: 20, color: 'var(--fg-dim)' }}>No editor tab open.</div>
        )}
        {active?.type === 'script' && (
          <>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ScriptEditor
                value={active.content}
                onChange={(v) => updateContent(active.id, v)}
                onRun={() => handleRun(0)}
                collections={completions.map((c) => c.name)}
              />
            </div>
            <div style={{ height: 260, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
              <ResultsPanel tabId={active.id} onPageChange={(page) => handleRun(page)} />
            </div>
          </>
        )}
        {active?.type === 'browse' && active.connectionId && active.database && active.collection && (
          <BrowseTab
            connectionId={active.connectionId}
            database={active.database}
            collection={active.collection}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 3: Build the app**

```bash
cd /Users/jagadeeshpulamarasetti/OwnCode/MongoMacApp
npm run tauri build -- --debug 2>&1 | tail -30
```

Or for dev mode:

```bash
npm run tauri dev
```

Expected: app starts without errors.

- [ ] **Step 4: Manual end-to-end test**

1. Open the app, connect to a MongoDB instance with a collection that has >50 docs
2. Run: `db.getCollection("your_collection").find({})`
3. Verify: results show ≤50 docs, pagination controls appear at bottom with "Page 1 of N"
4. Click "Next →" — verify new 50 docs load, page number updates to 2
5. Click "← Prev" — verify back to page 1
6. Type `3` in the page input, press Enter — verify jumps to page 3
7. Type `999` in the page input, press Enter — verify clamps to last page
8. Run: `db.getCollection("your_collection").aggregate([{ $match: {} }])` — verify pagination works
9. Run: `db.getCollection("your_collection").insertOne({ test: 1 })` — verify no pagination controls appear

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/EditorArea.tsx
git commit -m "feat(editor): wire up pagination page changes to re-run script"
```

---

## Done

All 9 tasks complete. The feature is fully implemented when:
- `npx vitest run` passes all tests
- Manual test steps in Task 9 Step 4 all pass
- `db.getCollection("collection").find({})` on a large collection shows paginated results with controls
