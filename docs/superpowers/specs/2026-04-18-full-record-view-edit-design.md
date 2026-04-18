# Full Record View / Edit Modal

**Date:** 2026-04-18
**Status:** Approved

## Overview

Add a centered modal to the table view that lets users view or edit a full MongoDB document as JSON. Triggered via right-click context menu (view), F3 (view), or F4 (edit). Edits are saved back to the database using the document's `_id`.

---

## Component

**New file:** `src/components/results/RecordModal.tsx`

### Props

```ts
interface RecordModalProps {
  doc: Record<string, unknown>;
  initialMode: 'view' | 'edit';
  connectionId: string;
  database: string;
  collection: string;
  onClose: () => void;
  onSaved: () => void;  // triggers data refresh in parent
}
```

### Internal State

```ts
mode: 'view' | 'edit'      // starts from initialMode
editedJson: string          // textarea content (excludes _id)
error: string | null        // JSON parse or save error
saving: boolean
```

### View Mode Layout

- Header: "Full Record" title + close (✕ / Esc)
- `_id` read-only badge: shows `_id` value with "read-only" label, not part of the editable JSON
- JSON display: `JSON.stringify(docWithout_id, null, 2)` — pretty-printed with commas, syntax highlighted, not editable
- Footer: "Close" button + "Edit (F4)" button

### Edit Mode Layout

- Header: "Edit Record" title (amber color to distinguish from view) + close (✕ / Esc)
- `_id` read-only badge: same as view mode — immutable, shown for reference only
- JSON editor: `<textarea>` pre-populated with `JSON.stringify(docWithout_id, null, 2)` — editable
- Error banner (shown when JSON is invalid): red background with parse error message
- Footer: "No changes → submit is a no-op" hint + "Cancel" + "Submit" buttons

### `_id` Handling

`_id` is stripped from the editable textarea. It is shown in a separate read-only badge above the editor. On submit, the original `_id` from `props.doc` is used for the MongoDB filter. The backend also strips `_id` from `$set`, providing a second layer of safety.

---

## Update Logic

On submit in edit mode:

1. Parse `editedJson` via `JSON.parse`. If it throws, show inline error — block submit.
2. Dirty check: compare `JSON.stringify(parsed)` vs `JSON.stringify(originalDocWithout_id)`. If equal, close without calling the API.
3. If dirty: call `updateDocument(connectionId, database, collection, String(doc._id), JSON.stringify(parsed))`.
4. On success: call `onSaved()` then `onClose()`.
5. On failure: show error banner with the error message.

### Cancel Behaviour

- If `initialMode === 'edit'` (opened via F4): Cancel closes the modal entirely.
- If `initialMode === 'view'` (Edit button clicked from view mode): Cancel reverts to view mode.

---

## Integration Points

### 1. `src/hooks/useCellShortcuts.ts`

Extend the hook to accept two optional callbacks:

```ts
interface CellShortcutsOptions {
  onViewRecord?: (doc: Record<string, unknown>) => void;
  onEditRecord?: (doc: Record<string, unknown>) => void;
}
```

Add two new shortcut definitions using those callbacks:

```ts
{
  id: 'view-record',
  keys: { key: 'F3' },
  label: 'View Full Record',
  showInContextMenu: true,
  action: () => selectedCell && options.onViewRecord?.(selectedCell.doc),
}
{
  id: 'edit-record',
  keys: { key: 'F4' },
  label: 'Edit Full Record',
  showInContextMenu: false,   // keyboard-only; Edit button handles in-modal switch
  action: () => selectedCell && options.onEditRecord?.(selectedCell.doc),
}
```

### 2. `src/components/results/ResultsPanel.tsx`

Own modal state and pass callbacks into `useCellShortcuts`:

```ts
const [recordModal, setRecordModal] = useState<{
  doc: Record<string, unknown>;
  mode: 'view' | 'edit';
} | null>(null);

useCellShortcuts({
  onViewRecord: (doc) => setRecordModal({ doc, mode: 'view' }),
  onEditRecord: (doc) => setRecordModal({ doc, mode: 'edit' }),
});
```

- Render `<RecordModal>` when `recordModal !== null`
- `onClose` → `setRecordModal(null)`
- `onSaved` → triggers existing data refresh (same as inline cell edit)

### 3. `src/components/results/TableView.tsx`

No changes required. The right-click context menu already reads from `KeyboardService.getAll()` filtered by `showInContextMenu: true`, so "View Full Record" (F3) appears automatically once the shortcut is registered.

---

## Keyboard Shortcuts Summary

| Key | Action |
|-----|--------|
| F3 | Open modal in view mode |
| F4 | Open modal in edit mode |
| Esc | Close modal |

---

## Files Changed

| File | Change |
|------|--------|
| `src/components/results/RecordModal.tsx` | **New** — modal component |
| `src/hooks/useCellShortcuts.ts` | Add F3 and F4 shortcuts |
| `src/components/results/ResultsPanel.tsx` | Add modal state + render RecordModal |

`TableView.tsx` and all backend/Rust files are unchanged.

---

## Out of Scope

- Syntax highlighting library (use a simple `<pre><code>` styled with CSS; no external dependency)
- Adding/removing fields from the document (raw JSON editing handles this naturally)
- Nested field expansion UI
- Undo/redo within the editor
