# Record Modal Action Registry Design

**Date:** 2026-04-19  
**Status:** Approved

## Summary

Replace the ad-hoc F3/F4 keyboard wiring with a declarative `TableActionDef` action registry. Remove `BrowseTab` and all inline cell editing. `RecordModal` in edit mode (F4) becomes the only way to edit a document.

---

## Architecture

All table keyboard actions are described as `TableActionDef` objects:

```ts
interface TableActionContext {
  selected: SelectedCell | null;
}

interface TableActionDef {
  id: string;
  keys: KeyCombo;
  label: string;
  showInContextMenu: boolean;
  enabled: (ctx: TableActionContext) => boolean;
  execute: (ctx: TableActionContext) => void;
}
```

A single `useTableActions(handlers)` hook owns a static `TABLE_ACTIONS: TableActionDef[]` array and registers all actions with `KeyboardService`. Adding a new action requires one new entry in that array — no props to thread, no callbacks to scatter.

`ResultsPanel` is the sole consumer of `useTableActions`. It passes `onViewRecord` and `onEditRecord` handlers. `BrowseTab` is removed entirely.

---

## Data Flow

```
User clicks cell
  → TableView: select({ rowIndex, colKey, doc, value })
  → CellSelectionContext stores selected cell

User presses F3 or F4
  → TableView div.onKeyDown → KeyboardService.dispatch(event)
  → Matches registered action (viewRecord / editRecord)
  → action.enabled({ selected }) → true
  → action.execute({ selected }) → calls onViewRecord(doc) or onEditRecord(doc)
  → ResultsPanel: setRecordModal({ doc, mode: 'view' | 'edit' })
  → RecordModal renders over the table

User presses F3/F4 while modal is open
  → RecordModal root div: onKeyDown → e.stopPropagation()
  → Event never reaches TableView → no re-trigger

User right-clicks cell
  → Context menu built from KeyboardService.getAll()
  → Both "View Record (F3)" and "Edit Record (F4)" appear
```

State owner: `ResultsPanel` only. No state in the hook or action definitions.

---

## Component Changes

### New: `src/hooks/useTableActions.ts`
- Replaces `src/hooks/useCellShortcuts.ts` (delete old file)
- Owns `TABLE_ACTIONS: TableActionDef[]` — static config array
- Takes `handlers: { onViewRecord?, onEditRecord? }`
- Maps handlers into `execute` functions at registration time
- Initial actions:
  - `cell.viewRecord` — F3, showInContextMenu: true
  - `cell.editRecord` — F4, showInContextMenu: true
  - `cell.copyValue` — Cmd+C, showInContextMenu: true
  - `cell.copyField` — Ctrl+Cmd+C, showInContextMenu: true
  - `cell.copyFieldPath` — Shift+Alt+Cmd+C, showInContextMenu: true
  - `cell.copyDocument` — Shift+Cmd+C, showInContextMenu: true
- All actions: `enabled: ctx => !!ctx.selected`

### Modified: `src/components/results/TableView.tsx`
- Remove `onEditCell` prop and inline cell editing UI
- Remove `onDelete` prop and delete button column
- No changes to keyboard dispatch or context menu logic

### Modified: `src/components/results/ResultsPanel.tsx`
- Replace `CellShortcutsRegistrar` component with `useTableActions` hook call
- Pass `onViewRecord` and `onEditRecord` callbacks to `useTableActions`

### Modified: `src/components/results/RecordModal.tsx`
- Add `onKeyDown={e => e.stopPropagation()}` on modal root div
- Prevents F3/F4 from propagating to underlying TableView while modal is open

### Deleted: `src/components/editor/BrowseTab.tsx`
- Remove entirely

### Modified: `src/components/editor/EditorArea.tsx`
- Remove `active.type === 'browse'` rendering branch
- Remove `BrowseTab` import

### Modified: `src/components/connections/ConnectionPanel.tsx` / `ConnectionTree.tsx`
- Remove any action that opens a `type: 'browse'` tab

---

## Bug Fixes Included

| Bug | Fix |
|-----|-----|
| F4 not shown in context menu | `showInContextMenu: true` for editRecord in TABLE_ACTIONS |
| F3/F4 re-triggers while modal open | `stopPropagation` on RecordModal root keydown |
| Inline edit bypasses script workflow | Remove `onEditCell` from TableView entirely |

---

## Extensibility

Adding a future action (e.g., Delete row, Ctrl+D duplicate, F2 focus editor):
1. Add one `TableActionDef` entry to `TABLE_ACTIONS` in `useTableActions.ts`
2. Add corresponding handler to the `handlers` parameter if it needs external state
3. No changes to `TableView`, `KeyboardService`, or `ResultsPanel` structure needed
