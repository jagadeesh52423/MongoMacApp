# Records Per Page — Design Spec

**Date:** 2026-04-18  
**Status:** Approved

## Summary

Add a page-size selector to the results panel so users can choose how many records to display per page. The selection is per-tab and session-only (resets to default on tab close or app restart).

## Options

`5 | 10 | 20 | 50 | 100 | 200` — default: **50**

## UI

A `<select>` dropdown added to the existing pagination bar in `ResultsPanel.tsx`, to the right of the page navigation controls. Labeled "per page". Disabled while `isRunning` is true, matching the behavior of the Prev/Next buttons.

## Data Flow

1. `ResultsPanel` adds `const [pageSize, setPageSize] = useState(50)`.
2. `onPageChange` prop type changes: `(page: number) => void` → `(page: number, pageSize: number) => void`.
3. On dropdown change: update `pageSize` state, reset to page 0, call `onPageChange(0, newPageSize)`.
4. On Prev/Next click: call `onPageChange(newPage, pageSize)` — passes current `pageSize`.
5. `EditorArea.handleRun(page, pageSize)` forwards both to `runScript(tabId, connId, db, script, page, pageSize)`.
6. Downstream layers (IPC → Rust → harness env var `MONGO_PAGE_SIZE`) already accept `pageSize` — no changes needed there.

## Files Changed

| File | Change |
|------|--------|
| `src/components/results/ResultsPanel.tsx` | Add `pageSize` state, dropdown UI, update `onPageChange` calls |
| `src/components/editor/EditorArea.tsx` | Update `onPageChange` handler signature to accept `pageSize`, pass to `handleRun` |

## Edge Cases

- Changing page size resets to page 0 to avoid out-of-range page states.
- Dropdown is disabled during `isRunning`.
- `BrowseTab` uses its own hardcoded `pageSize=20` — unaffected.
- Empty collection and `-1` total edge cases already handled — no changes needed.

## Out of Scope

- Persisting page size preference across sessions or app restarts.
- Global (cross-tab) page size preference.
- Changing page size for `BrowseTab`.
