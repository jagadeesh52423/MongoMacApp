# Code Review — feat/cancel-run

Reviewer: `reviewer` (team feat-cancel-run)
Scope: Cancel / de-duplicate script runs (plan: `docs/superpowers/plans/2026-04-19-cancel-run.md`)

---

## Stage 1 — Spec compliance

| Plan requirement | Status |
|---|---|
| `runId?: string` on `ScriptEvent` | Met — `src/types.ts` |
| `TabResults.runId`, `startRun(tabId, runId)` | Met — `src/store/results.ts` |
| Stale-event drop in `useScriptEvents` | Met — `src/hooks/useScriptEvents.ts` |
| `runScript(..., runId?)` + `cancelScript` IPC | Met — `src/ipc.ts` |
| Run disabled while running; Cancel button | Met — `src/components/editor/EditorArea.tsx` |
| `active_scripts` map in AppState | Met — `src-tauri/src/state.rs` |
| Cancel previous run + register new flag + `cancel_script` command + `run_id` in events | Met — `src-tauri/src/commands/script.rs` |
| `cancel_script` registered in invoke handler | Met — `src-tauri/src/main.rs` |
| Store tests for `runId` | Met — `src/__tests__/store.test.ts` |
| Editor tests for Run/Cancel | Met — `src/__tests__/editor-area.test.tsx` |

No over-engineering detected. All plan pieces are present.

---

## Stage 2 — Code quality findings

### BLOCKING

#### B1. Spurious error UI on user-initiated cancel (double finishRun + setError)

`src/components/editor/EditorArea.tsx:33-47`

`handleCancel` calls `cancelScript` then `finishRun(tabId, 0)`. But the original `handleRun`'s `await runScript(...)` is still pending. When the Rust side detects cancel it returns `Err(std::io::ErrorKind::Interrupted -> "cancelled")` (script.rs:219-228), so the `invoke` promise rejects. `handleRun`'s catch block then runs:

```ts
setError(active.id, msg);   // sets lastError = "cancelled"
finishRun(active.id, 0);
```

This surfaces an error in the UI for a user-intentional cancel, and clobbers any state handleCancel left. Expected UX is a clean stop with no error.

Fix options:
- In `handleRun`, ignore/short-circuit errors matching the cancel message.
- Or track "cancelled" state in the store and suppress the catch branch when it is set.
- Or have the Rust cancel path return `Ok(())` instead of `Err(...)` (no done event is emitted anyway).

#### B2. Race condition: cleanup removes a newer run's cancel flag

`src-tauri/src/commands/script.rs:255-259`

The unconditional cleanup at the end of `run_script`:

```rust
{
    let mut scripts = state.active_scripts.lock().unwrap();
    scripts.remove(&*tab_id_arc);
}
```

Sequence that breaks:

1. Run A starts → inserts `flag_A`.
2. Run B is triggered (via `ScriptEditor.onRun` / `ResultsPanel.onPageChange` / `onDocUpdated`, none of which check `isRunning`).
3. Run B's prologue removes `flag_A` (sets to true) and inserts `flag_B`.
4. Run A detects cancel, exits; its cleanup block removes `map[tab_id]` — which is now `flag_B`.
5. User clicks Cancel for Run B. `cancel_script` looks up `map[tab_id]`, finds nothing, returns without flipping any flag. Run B is uncancellable.

Fix: only remove if the current entry is still our flag.

```rust
{
    let mut scripts = state.active_scripts.lock().unwrap();
    if let Some(cur) = scripts.get(&*tab_id_arc) {
        if Arc::ptr_eq(cur, &cancel_flag) {
            scripts.remove(&*tab_id_arc);
        }
    }
}
```

### NON-BLOCKING

#### N1. Stale events may slip through between Cancel click and next Run

`src/hooks/useScriptEvents.ts:13-14`

`handleCancel` flips `isRunning=false` but leaves the `runId` in the store untouched. The Rust child is killed asynchronously, so stdout/stderr reader threads may continue emitting events for a short window. Those events carry the old `runId`, which still matches `currentRunId`, so they pass the filter and can polute groups/errors. Clearing or rotating `runId` in `handleCancel` (e.g., `startRun(id, '')` or new `clearRun` action) would make the filter effective in this window.

#### N2. Test coverage does not exercise the cancel error path

`src/__tests__/editor-area.test.tsx:94-103`

The Cancel test mocks `cancelScript` as a resolved stub but does not simulate the runScript rejection that occurs on real cancel. It therefore will not catch B1. Consider a test where `runScript` returns a rejecting promise that resolves after Cancel is clicked, and assert that `byTab['t1'].lastError` is not set.

#### N3. `Mutex::lock().unwrap()` on poisoned state

`src-tauri/src/commands/script.rs:39, 84, 257`

Lock regions are small and simple, so poisoning is unlikely, but `.unwrap()` on `PoisonError` will abort. Using `.lock().unwrap_or_else(|e| e.into_inner())` or handling the error is more resilient. Low priority.

#### N4. Duplicate-key cleanup on timeout path

`src-tauri/src/commands/script.rs:230-251` (timeout branch) returns `Ok(())`, which then falls through to the unconditional `scripts.remove(...)` cleanup. Behaves correctly today, but shares the B2 race with any racing Run B — same fix applies.

### Thread-safety note (no issue)

`active_scripts` is a `std::sync::Mutex` acquired only for short, non-blocking critical sections — no `.await` while holding the lock, and `Arc<AtomicBool>` means the flag itself does not need the mutex to be read in the polling loop. No deadlock path.

### Reactivity note (no issue)

`const isRunning = useResultsStore((s) => active ? !!s.byTab[active.id]?.isRunning : false)` is reactive. Zustand re-runs the selector on every state change, and the closure captures the latest `active` on each render. When isRunning toggles, the selector returns a new boolean and the component re-renders.

### `listCollections` mock note (correct)

`src/__tests__/editor-area.test.tsx:19-23` mocks `listCollections` alongside `runScript`/`cancelScript`. `useCollectionCompletions` (used by `EditorArea`) imports `listCollections` from `../ipc`, so the stub is required once any script tab is opened. The stub returning `[]` is correct for these tests.

---

## Summary

**Recommendation: NEEDS_REVISION**

Blocking:
- B1 — Spurious error shown on user-initiated cancel (EditorArea double-finishRun/setError).
- B2 — Cleanup race can orphan a newer run's cancel flag, making it uncancellable.

Non-blocking suggestions:
- N1 — Clear `runId` on cancel to avoid late events polluting UI.
- N2 — Add a test covering the cancel → rejected-runScript path.
- N3 — Softer mutex-poison handling.
- N4 — Apply the B2 `Arc::ptr_eq` fix to all cleanup paths.

---

## Stage 3 — Re-review (reviewer-final)

Scope: verify fixes committed in `71fcb51` address B1, B2, N1, N2.

### B1 — RESOLVED
`src-tauri/src/commands/script.rs:219-230` — `Ok(Err(e))` now returns `Ok(())` when `e.kind() == Interrupted`. The `runScript` invoke promise resolves successfully, so `handleRun`'s catch branch never runs for cancel, and `finishRun`/`setError` are not called a second time. `handleCancel` remains the sole caller of `finishRun` on cancel. No spurious error UI.

Additional defensive guard: `src/components/editor/EditorArea.tsx:37` short-circuits with `if (msg === 'cancelled') return;` — correct literal match for the Rust `io::Error` message at `script.rs:188` (belt-and-braces; in practice unreachable because B1 resolves Ok).

### B2 — RESOLVED
`src-tauri/src/commands/script.rs:256-263` — cleanup block now:
```rust
if let Some(current) = scripts.get(&*tab_id_arc) {
    if Arc::ptr_eq(current, &cancel_flag) {
        scripts.remove(&*tab_id_arc);
    }
}
```
Single unified cleanup after `.await`, so it covers the success, error, timeout, and interrupted paths uniformly — N4 is also addressed. Sequence A→B→A-exit no longer wipes `flag_B`. `cancel_script`'s `scripts.remove()` + cleanup's `ptr_eq` check compose correctly (cleanup no-ops when cancel already removed the entry).

### N1 — RESOLVED
`src/store/results.ts:45` — `finishRun` now sets `runId: undefined`. Traced through `src/hooks/useScriptEvents.ts:13-14`: after `handleCancel` → `finishRun`, `currentRunId` is `undefined`; late events carrying the killed run's `runId` hit `p.runId && p.runId !== currentRunId` → early return. Filter is effective for the kill-drain window.

### N2 — RESOLVED
`src/__tests__/editor-area.test.tsx:104-115` — adds a test that mocks `runScript` to reject with `Error('cancelled')` and asserts `lastError` remains unset. Covers the defensive guard in `handleRun`. Store tests at `src/__tests__/store.test.ts:79-91` also cover the `runId` lifecycle.

### No new issues introduced

- The `Arc<Option<String>>` wrapping for `run_id_arc` is slightly unusual but functionally correct and cheap.
- `useScriptEvents` filter `if (p.runId && p.runId !== currentRunId)` lets events without `runId` pass through — safe because all producers in `script.rs` now set `run_id`.
- No `.await` is held while the `active_scripts` mutex is locked. No deadlock path.

### Verdict: **APPROVED**

All prior blockers resolved. Non-blockers N3 (mutex poison ergonomics) may be deferred.
