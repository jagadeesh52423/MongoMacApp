# Cancel / De-duplicate Script Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a new run is triggered on a tab that is already running, cancel the previous process automatically; expose a Cancel button so users can abort a run at any time; disable the Run button while a run is in progress.

**Architecture:** Each run is tagged with a `runId` (UUID) generated on the frontend. The Rust backend stores a per-tab `AtomicBool` cancel flag; new runs set the old flag (killing the previous child within one 50 ms poll tick) and register a fresh flag. All Tauri events carry `runId`; the frontend event hook drops events whose `runId` does not match the store, eliminating any stale events that slip through. The Cancel button calls a `cancel_script` IPC that flips the flag.

**Tech Stack:** Rust / Tauri v2 (backend), React / Zustand / Vitest / React Testing Library (frontend)

---

## File Map

| File | Change |
|------|--------|
| `src/types.ts` | Add `runId?: string` to `ScriptEvent` |
| `src/store/results.ts` | Add `runId?: string` to `TabResults`; update `startRun(tabId, runId)` |
| `src/hooks/useScriptEvents.ts` | Drop events where `p.runId !== currentRunId` |
| `src/ipc.ts` | Add `runId?` param to `runScript`; add `cancelScript` |
| `src/components/editor/EditorArea.tsx` | Generate `runId`, disable Run, add Cancel button |
| `src-tauri/src/state.rs` | Add `active_scripts: Mutex<HashMap<String, Arc<AtomicBool>>>` |
| `src-tauri/src/commands/script.rs` | Cancel previous run, track flag, emit `run_id`, add `cancel_script` |
| `src-tauri/src/main.rs` | Register `cancel_script` in invoke handler |
| `src/__tests__/store.test.ts` | New tests: `startRun` stores `runId` |
| `src/__tests__/editor-area.test.tsx` | New tests: Run disabled, Cancel shown/works |

---

## Task 1: Add `runId` to types and results store

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store/results.ts`
- Modify: `src/__tests__/store.test.ts`

- [ ] **Step 1: Write failing tests for `runId` in store**

In `src/__tests__/store.test.ts`, add inside `describe('results store', ...)`:

```ts
it('startRun stores runId for the tab', () => {
  useResultsStore.getState().startRun('t1', 'run-abc');
  const r = useResultsStore.getState().byTab['t1'];
  expect(r.runId).toBe('run-abc');
});

it('startRun replaces old runId on second call', () => {
  useResultsStore.getState().startRun('t1', 'run-1');
  useResultsStore.getState().startRun('t1', 'run-2');
  const r = useResultsStore.getState().byTab['t1'];
  expect(r.runId).toBe('run-2');
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd .worktrees/feat-cancel-run && npm test -- --run src/__tests__/store.test.ts
```

Expected: FAIL — `startRun` does not accept a second argument yet.

- [ ] **Step 3: Add `runId` to `ScriptEvent` in `src/types.ts`**

Replace the `ScriptEvent` interface (lines 83–91) with:

```ts
export interface ScriptEvent {
  tabId: string;
  kind: 'group' | 'error' | 'done' | 'pagination';
  groupIndex?: number;
  docs?: unknown[];
  error?: string;
  executionMs?: number;
  pagination?: PaginationState;
  runId?: string;
}
```

- [ ] **Step 4: Update `TabResults` and `startRun` in `src/store/results.ts`**

Replace the file content with:

```ts
import { create } from 'zustand';
import type { PaginationState, ResultGroup } from '../types';

interface TabResults {
  groups: ResultGroup[];
  isRunning: boolean;
  executionMs?: number;
  lastError?: string;
  pagination?: PaginationState;
  runId?: string;
}

interface ResultsState {
  byTab: Record<string, TabResults>;
  startRun: (tabId: string, runId: string) => void;
  appendGroup: (tabId: string, group: ResultGroup) => void;
  setError: (tabId: string, error: string) => void;
  finishRun: (tabId: string, executionMs: number) => void;
  setPagination: (tabId: string, pagination: PaginationState) => void;
  clearTab: (tabId: string) => void;
}

export const useResultsStore = create<ResultsState>((set) => ({
  byTab: {},
  startRun: (tabId, runId) =>
    set((s) => ({
      byTab: {
        ...s.byTab,
        [tabId]: { groups: [], isRunning: true, executionMs: undefined, lastError: undefined, pagination: undefined, runId },
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

- [ ] **Step 5: Run tests — all pass**

```bash
npm test -- --run src/__tests__/store.test.ts
```

Expected: all tests pass including the two new ones.

- [ ] **Step 6: Run full suite to check no regressions**

```bash
npm test -- --run 2>&1 | tail -8
```

Expected: `Test Files  14 passed` (or more), `0 failures`.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/store/results.ts src/__tests__/store.test.ts
git commit -m "feat(store): add runId tracking to startRun and TabResults"
```

---

## Task 2: Filter stale events in `useScriptEvents`

**Files:**
- Modify: `src/hooks/useScriptEvents.ts`

No unit test file exists for this hook (it depends on Tauri's `listen`). The filtering logic will be verified via integration and the existing test suite not breaking.

- [ ] **Step 1: Update `src/hooks/useScriptEvents.ts`**

Replace the entire file:

```ts
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
      const currentRunId = useResultsStore.getState().byTab[p.tabId]?.runId;
      if (p.runId && p.runId !== currentRunId) return;

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

- [ ] **Step 2: Run full test suite**

```bash
npm test -- --run 2>&1 | tail -8
```

Expected: all tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useScriptEvents.ts
git commit -m "feat(events): drop stale script events that don't match current runId"
```

---

## Task 3: Update IPC layer

**Files:**
- Modify: `src/ipc.ts`

- [ ] **Step 1: Update `src/ipc.ts`**

Replace the `runScript` export and add `cancelScript` (the rest of the file is unchanged):

```ts
export async function runScript(
  tabId: string,
  connectionId: string,
  database: string,
  script: string,
  page = 0,
  pageSize = 50,
  runId?: string,
): Promise<void> {
  return invoke('run_script', { tabId, connectionId, database, script, page, pageSize, runId });
}

export async function cancelScript(tabId: string): Promise<void> {
  return invoke('cancel_script', { tabId });
}
```

- [ ] **Step 2: Run full test suite**

```bash
npm test -- --run 2>&1 | tail -8
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/ipc.ts
git commit -m "feat(ipc): add runId to runScript, add cancelScript"
```

---

## Task 4: Update EditorArea — disable Run, add Cancel button

**Files:**
- Modify: `src/components/editor/EditorArea.tsx`
- Modify: `src/__tests__/editor-area.test.tsx`

- [ ] **Step 1: Write failing tests**

Replace `src/__tests__/editor-area.test.tsx` with:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorArea } from '../components/editor/EditorArea';
import { useEditorStore } from '../store/editor';
import { useConnectionsStore } from '../store/connections';
import { useResultsStore } from '../store/results';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v?: string) => void }) => (
    <textarea
      data-testid="mock-monaco"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock('../ipc', () => ({
  runScript: vi.fn().mockResolvedValue(undefined),
  cancelScript: vi.fn().mockResolvedValue(undefined),
}));

function openScriptTab() {
  useEditorStore.getState().openTab({
    id: 't1', title: 'a.js', content: 'db.users.find({})', isDirty: false, type: 'script',
  });
  useConnectionsStore.setState({
    connections: [],
    activeConnectionId: 'conn1',
    activeDatabase: 'mydb',
    connectedIds: new Set(['conn1']),
  });
}

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useResultsStore.setState({ byTab: {} });
  useConnectionsStore.setState({
    connections: [], activeConnectionId: null, activeDatabase: null, connectedIds: new Set(),
  });
});

describe('EditorArea', () => {
  it('renders placeholder with no tabs', () => {
    render(<EditorArea />);
    expect(screen.getByText(/No editor tab/i)).toBeInTheDocument();
  });

  it('renders a script tab and updates content', async () => {
    useEditorStore.getState().openTab({
      id: 't1', title: 'a.js', content: 'db.users.find({})', isDirty: false, type: 'script',
    });
    const user = userEvent.setup();
    render(<EditorArea />);
    const ta = screen.getByTestId('mock-monaco') as HTMLTextAreaElement;
    await user.clear(ta);
    await user.type(ta, 'x');
    expect(useEditorStore.getState().tabs[0].content).toBe('x');
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });

  it('Run button is enabled when not running', () => {
    openScriptTab();
    render(<EditorArea />);
    const runBtn = screen.getByRole('button', { name: /run/i });
    expect(runBtn).not.toBeDisabled();
  });

  it('Run button is disabled when isRunning', () => {
    openScriptTab();
    useResultsStore.getState().startRun('t1', 'run-1');
    render(<EditorArea />);
    const runBtn = screen.getByRole('button', { name: /run/i });
    expect(runBtn).toBeDisabled();
  });

  it('Cancel button appears only when isRunning', () => {
    openScriptTab();
    render(<EditorArea />);
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();

    useResultsStore.getState().startRun('t1', 'run-1');
    render(<EditorArea />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('Cancel button calls cancelScript and finishRun', async () => {
    const { cancelScript } = await import('../ipc');
    openScriptTab();
    useResultsStore.getState().startRun('t1', 'run-1');
    const user = userEvent.setup();
    render(<EditorArea />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(cancelScript).toHaveBeenCalledWith('t1');
    expect(useResultsStore.getState().byTab['t1'].isRunning).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --run src/__tests__/editor-area.test.tsx
```

Expected: FAIL on the 3 new tests (Run disabled, Cancel appears, Cancel calls handler).

- [ ] **Step 3: Update `src/components/editor/EditorArea.tsx`**

Replace the entire file:

```tsx
import { useState } from 'react';
import { useEditorStore } from '../../store/editor';
import { useConnectionsStore } from '../../store/connections';
import { ScriptEditor } from './ScriptEditor';
import { runScript, cancelScript } from '../../ipc';
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
  const [pageSizes, setPageSizes] = useState<Record<string, number>>({});
  const activePageSize = active ? (pageSizes[active.id] ?? 50) : 50;
  const isRunning = useResultsStore((s) => (active ? !!s.byTab[active.id]?.isRunning : false));

  async function handleRun(page = 0, pageSize = activePageSize) {
    if (!active || active.type !== 'script') return;
    const connId = active.connectionId ?? activeConnectionId;
    const db = active.database ?? activeDatabase;
    if (!connId || !db) {
      alert('Select a connection and database first');
      return;
    }
    const runId = crypto.randomUUID();
    console.log('[handleRun] tabId:', active.id, 'connId:', connId, 'db:', db, 'page:', page, 'pageSize:', pageSize, 'runId:', runId);
    startRun(active.id, runId);
    try {
      await runScript(active.id, connId, db, active.content, page, pageSize, runId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[handleRun] runScript failed:', msg);
      setError(active.id, msg);
      finishRun(active.id, 0);
    }
  }

  async function handleCancel() {
    if (!active) return;
    await cancelScript(active.id);
    finishRun(active.id, 0);
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
        <div style={{ paddingRight: 10, display: 'flex', gap: 6 }}>
          <button
            onClick={() => handleRun(0)}
            disabled={!active || active.type !== 'script' || isRunning}
          >
            ▶ Run
          </button>
          {isRunning && (
            <button onClick={handleCancel}>
              ✕ Cancel
            </button>
          )}
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
              <ResultsPanel
                tabId={active.id}
                pageSize={activePageSize}
                onPageChange={(page, pageSize) => handleRun(page, pageSize)}
                onPageSizeChange={(size) => setPageSizes((prev) => ({ ...prev, [active.id]: size }))}
                connectionId={active.connectionId}
                database={active.database}
                collection={active.collection}
                onDocUpdated={() => handleRun(0, activePageSize)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests — all pass**

```bash
npm test -- --run src/__tests__/editor-area.test.tsx
```

Expected: all 6 tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test -- --run 2>&1 | tail -8
```

Expected: all tests pass, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/EditorArea.tsx src/__tests__/editor-area.test.tsx
git commit -m "feat(ui): disable Run while running, add Cancel button, pass runId"
```

---

## Task 5: Rust backend — cancel infrastructure

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/commands/script.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Update `src-tauri/src/state.rs`**

Replace the entire file:

```rust
use mongodb::Client;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub db_path: PathBuf,
    pub mongo_clients: Mutex<HashMap<String, Client>>,
    /// Per-tab cancel flag. Set to true to signal the running script to abort.
    pub active_scripts: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AppState {
    pub fn new(db_path: PathBuf) -> Self {
        Self {
            db_path,
            mongo_clients: Mutex::new(HashMap::new()),
            active_scripts: Mutex::new(HashMap::new()),
        }
    }

    pub fn open_db(&self) -> rusqlite::Result<rusqlite::Connection> {
        crate::db::open(&self.db_path)
    }
}
```

- [ ] **Step 2: Build to verify state.rs compiles**

```bash
cd src-tauri && cargo build 2>&1 | grep -E "^error" | head -20
```

Expected: no `error` lines (warnings about unused imports are fine).

- [ ] **Step 3: Replace `src-tauri/src/commands/script.rs`**

Replace the entire file:

```rust
use crate::db;
use crate::keychain;
use crate::mongo;
use crate::runner::executor::spawn_script;
use crate::state::AppState;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};
use tokio::time::{timeout, Duration};

const SCRIPT_TIMEOUT_SECS: u64 = 30;

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
    pub run_id: Option<String>,
}

#[tauri::command]
pub fn cancel_script(state: State<'_, AppState>, tab_id: String) -> Result<(), String> {
    let mut scripts = state.active_scripts.lock().unwrap();
    if let Some(flag) = scripts.remove(&tab_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

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
    run_id: Option<String>,
) -> Result<(), String> {
    println!("[run_script] tab={tab_id} connection_id={connection_id} db={database}");
    let conn = state.open_db().map_err(|e| e.to_string())?;
    let rec = db::connections::get(&conn, &connection_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "connection not found".to_string())?;
    drop(conn);
    let pw = keychain::get_password(&connection_id)?;
    let uri = mongo::build_uri(&rec, pw.as_deref());
    println!("[run_script] uri host={:?} db={database}", rec.host);

    let tmp_dir = std::env::temp_dir();
    let script_path = tmp_dir.join(format!("mongomacapp-{}.js", uuid::Uuid::new_v4()));
    std::fs::write(&script_path, &script).map_err(|e| e.to_string())?;
    println!("[run_script] script written to {:?}", script_path);

    let tab_id_arc: Arc<String> = Arc::new(tab_id.clone());
    let run_id_arc: Arc<Option<String>> = Arc::new(run_id);
    let app_handle = app.clone();
    let start = Instant::now();

    let page = page.unwrap_or(0);
    let page_size = page_size.unwrap_or(50);

    // Cancel any previously running script on this tab, then register the new flag.
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut scripts = state.active_scripts.lock().unwrap();
        if let Some(old_flag) = scripts.remove(&*tab_id_arc) {
            old_flag.store(true, Ordering::Relaxed);
        }
        scripts.insert((*tab_id_arc).clone(), cancel_flag.clone());
    }

    let result: Result<(), String> = async {
        let mut child = spawn_script(&uri, &database, &script_path, page, page_size)?;
        println!("[run_script] child spawned pid={:?}", child.id());
        let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
        let stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;

        let stdout_handle = {
            let ah = app_handle.clone();
            let tab = tab_id_arc.clone();
            let rid = run_id_arc.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
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
                                    run_id: (*rid).clone(),
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
                                run_id: (*rid).clone(),
                            };
                            let _ = ah.emit("script-event", evt);
                        }
                    }
                }
            })
        };

        let stderr_handle = {
            let ah = app_handle.clone();
            let tab = tab_id_arc.clone();
            let rid = run_id_arc.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().flatten() {
                    let parsed = serde_json::from_str::<serde_json::Value>(&line).ok();
                    if let Some(msg) = parsed.as_ref().and_then(|v| v.get("__debug")).and_then(|v| v.as_str()) {
                        println!("{msg}");
                        continue;
                    }
                    let err = parsed
                        .and_then(|v| v.get("__error").and_then(|e| e.as_str()).map(|s| s.to_string()))
                        .unwrap_or(line);
                    let evt = ScriptEvent {
                        tab_id: (*tab).clone(),
                        kind: "error".into(),
                        group_index: None,
                        docs: None,
                        error: Some(err),
                        execution_ms: None,
                        pagination: None,
                        run_id: (*rid).clone(),
                    };
                    let _ = ah.emit("script-event", evt);
                }
            })
        };

        let wait_result = timeout(Duration::from_secs(SCRIPT_TIMEOUT_SECS), async {
            loop {
                if cancel_flag.load(Ordering::Relaxed) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::Interrupted,
                        "cancelled",
                    ));
                }
                match child.try_wait() {
                    Ok(Some(status)) => return Ok(status),
                    Ok(None) => tokio::time::sleep(Duration::from_millis(50)).await,
                    Err(e) => return Err(e),
                }
            }
        })
        .await;

        match wait_result {
            Ok(Ok(status)) => {
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                println!("[run_script] done, exit_success={}", status.success());
                let elapsed = start.elapsed().as_millis();
                let done = ScriptEvent {
                    tab_id: (*tab_id_arc).clone(),
                    kind: "done".into(),
                    group_index: None,
                    docs: None,
                    error: if status.success() { None } else { Some("exited with error".into()) },
                    execution_ms: Some(elapsed),
                    pagination: None,
                    run_id: (*run_id_arc).clone(),
                };
                let _ = app_handle.emit("script-event", done);
                Ok(())
            }
            Ok(Err(e)) => {
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                if e.kind() == std::io::ErrorKind::Interrupted {
                    println!("[run_script] cancelled by user");
                    // No done event — frontend already called finishRun via handleCancel.
                } else {
                    println!("[run_script] wait failed: {e}");
                }
                Err(e.to_string())
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                println!("[run_script] timed out after {SCRIPT_TIMEOUT_SECS}s, killed child");
                let evt = ScriptEvent {
                    tab_id: (*tab_id_arc).clone(),
                    kind: "error".into(),
                    group_index: None,
                    docs: None,
                    error: Some(format!("Script execution timed out ({SCRIPT_TIMEOUT_SECS}s)")),
                    execution_ms: None,
                    pagination: None,
                    run_id: (*run_id_arc).clone(),
                };
                let _ = app_handle.emit("script-event", evt);
                Ok(())
            }
        }
    }
    .await;

    // Always clean up the flag entry regardless of how the run ended.
    {
        let mut scripts = state.active_scripts.lock().unwrap();
        scripts.remove(&*tab_id_arc);
    }

    let _ = std::fs::remove_file(&script_path);
    result
}
```

- [ ] **Step 4: Register `cancel_script` in `src-tauri/src/main.rs`**

In `main.rs` line 50 (the `invoke_handler` list), add after `commands::script::run_script,`:

```rust
            commands::script::cancel_script,
```

So the block becomes:

```rust
        .invoke_handler(tauri::generate_handler![
            commands::connection::list_connections,
            commands::connection::create_connection,
            commands::connection::update_connection,
            commands::connection::delete_connection,
            commands::connection::test_connection,
            commands::connection::connect_connection,
            commands::connection::disconnect_connection,
            commands::collection::list_databases,
            commands::collection::list_collections,
            commands::collection::list_indexes,
            commands::collection::browse_collection,
            commands::document::update_document,
            commands::document::delete_document,
            commands::script::run_script,
            commands::script::cancel_script,
            commands::saved_script::list_scripts,
            commands::saved_script::create_script,
            commands::saved_script::update_script,
            commands::saved_script::delete_script,
            commands::saved_script::touch_script,
            runner::executor::check_node_runner,
            runner::executor::install_node_runner,
        ])
```

- [ ] **Step 5: Build Rust to verify no errors**

```bash
cd src-tauri && cargo build 2>&1 | grep -E "^error" | head -30
```

Expected: no `error` lines.

- [ ] **Step 6: Run frontend tests one final time**

```bash
cd .. && npm test -- --run 2>&1 | tail -8
```

Expected: all 86 tests pass (84 existing + 2 new store + 4 new editor-area — some may overlap with old editor-area count).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/commands/script.rs src-tauri/src/main.rs
git commit -m "feat(rust): cancel previous script on new run, add cancel_script command, emit runId in events"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| Drop first run, execute latest when same tab re-runs | Task 5 (`cancel_flag` set when new run starts) |
| Block Run button while running | Task 4 (`disabled={isRunning}`) |
| Cancel button to abort in-progress query | Task 4 (`handleCancel` + `cancel_script` IPC) |
| Stale events from old run don't pollute results | Task 2 (`runId` filter in `useScriptEvents`) |

### Placeholder scan

No TBD/TODO/placeholder items found.

### Type consistency

- `startRun(tabId: string, runId: string)` — defined Task 1, called Task 4 ✓
- `cancelScript(tabId: string)` — defined Task 3, called Task 4 ✓
- `runScript(..., runId?: string)` — defined Task 3, called Task 4 ✓
- `ScriptEvent.runId?: string` — defined Task 1 (types.ts), used Task 2, emitted Task 5 ✓
- `cancel_script` Rust command — added Task 5 step 3, registered step 4 ✓
