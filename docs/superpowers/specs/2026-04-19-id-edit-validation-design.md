# Design: _id Edit Validation in RecordModal

**Date:** 2026-04-19  
**Status:** Approved  
**Scope:** `src/components/results/RecordModal.tsx` (single file)

---

## Problem

Currently `_id` is extracted from the document and displayed as a separate read-only badge. The edit textarea only shows the remaining fields. Users cannot see or interact with `_id` as part of the document JSON.

## Goal

Keep `_id` visible in the document JSON textarea. Validate on save that it was not changed, and show a clear error (with the original value) if it was.

---

## Design

### 1. Include `_id` in the textarea

- Remove the destructuring `const { _id, ...rest } = doc`
- Set `originalJson = JSON.stringify(doc, null, 2)` (full document including `_id`)
- Keep `idStr = String(doc._id ?? '')` for comparison and error messaging

### 2. Remove the read-only `_id` badge

- Remove the separate `_id` display block (the header section showing `_id` label + value + "read-only" tag)
- `_id` is now simply the first field in the textarea JSON

### 3. Validate `_id` on save

In `handleSubmit`, after parsing `editedJson`:

```
const parsed = JSON.parse(editedJson);
if (String(parsed._id) !== idStr) {
  setError(`_id cannot be changed. Original: ${idStr}`);
  return; // modal stays open
}
```

- Modal does **not** close on this error (early return before `onClose()`)
- Error message embeds the original `_id` so the user can restore it

### 4. Strip `_id` before calling the backend

The backend `updateDocument()` takes `id` separately and expects the payload without `_id`:

```
const { _id: _ignored, ...updatePayload } = parsed;
await updateDocument(connectionId, database, collection, idStr, JSON.stringify(updatePayload));
```

### 5. "No changes" check

The existing string comparison (`editedJson.trim() === originalJson.trim()`) remains unchanged and correctly covers the case where `_id` is touched then reverted.

---

## Error UX

| Condition | Behaviour |
|-----------|-----------|
| `_id` changed | Inline error banner in modal: `_id cannot be changed. Original: <idStr>` — modal stays open |
| Invalid JSON | Existing inline error: parse error message |
| No changes | Existing inline error: "No changes to save." |
| Success | Modal closes, results refresh |

---

## Files Changed

| File | Change |
|------|--------|
| `src/components/results/RecordModal.tsx` | All changes — remove badge, include `_id` in JSON, add validation |

---

## Out of Scope

- Backend changes (none required)
- Making `_id` visually distinct in the textarea (not requested)
- Preventing `_id` field from being typed into (validation-on-save is the agreed approach)
