# Collection Context From Results — Design Spec

**Date:** 2026-04-24  
**Status:** Approved  
**Author:** Claude Sonnet 4.6

## Problem Statement

The current implementation determines whether F4 (Edit Record) is available based on **how the script tab was opened**, not **what the script actually queried**:

- **Collection script** (double-click from ConnectionTree): `tab.collection` is set → F4 works
- **Saved script** (loaded from SavedScriptsPanel): `tab.collection` is `undefined` → F4 doesn't work

This creates inconsistent behavior:
1. The same script produces different F4 availability depending on how it was opened
2. User changes the database dropdown in EditorArea, but `tab.database` is frozen at creation time
3. Multi-collection scripts have no per-group collection tracking — F4 targets the wrong collection or is disabled entirely

**Root cause:** `tab.collection` is **provenance metadata** (how the tab was created), not **execution context** (what the script queried).

## Solution Overview

Move collection context from **tab metadata** (creation-time) to **result metadata** (execution-time):

1. **QueryTypeRegistry**: Classify MongoDB operations by category and extract target collection from script text
2. **Per-group metadata**: Each `ResultGroup` carries its own `collection` and `category`
3. **Runtime collection resolution**: `RecordContext` derives from result groups, not tab props
4. **Selection tracking**: `SelectedCell` includes `groupIndex` so actions target the correct group's collection

## Architecture

### Component: QueryTypeRegistry

**File:** `src/services/query/QueryTypeRegistry.ts`

**Purpose:** Classify MongoDB operations and extract collection names from script statements.

**Interface:**
```typescript
interface OperationDef {
  pattern: RegExp;
  category: 'query' | 'mutation' | 'transform' | 'maintenance' | 'stream';
}

interface QueryClassification {
  category: 'query' | 'mutation' | 'transform' | 'maintenance' | 'stream' | null;
  collection: string | null;
}

class QueryTypeRegistry {
  classify(script: string): QueryClassification;
}
```

**Built-in operations:**

- **query** (editable):
  - `find()`, `findOne()`

- **mutation** (not editable):
  - `insertOne/Many()`, `updateOne/Many()`, `deleteOne/Many()`, `replaceOne()`
  - `findOneAndUpdate/Replace/Delete()`, `bulkWrite()`

- **transform** (not editable):
  - `aggregate()`, `distinct()`, `countDocuments()`, `estimatedDocumentCount()`

- **maintenance** (not editable):
  - `createIndex*()`, `dropIndex*()`, `listIndexes()`, `drop()`, `rename()`, `stats()`

- **stream** (not editable):
  - `watch()`

**Collection extraction:** Parse `db.getCollection("name")` or `db.name` patterns before the operation. Extract the first collection reference found.

**classify() behavior:**
1. Search for operation patterns in registry order
2. For first match, extract collection name from preceding context
3. Return `{ category, collection }` or `{ category: null, collection: null }` if no match

**Extensibility:** To support new operations (custom helpers, future MongoDB methods), register new `OperationDef` entries — no parser changes needed.

### Data Structure Changes

**ResultGroup** (type: `src/types.ts`):
```typescript
interface ResultGroup {
  groupIndex: number;
  docs: unknown[];
  error?: string;
  collection?: string;  // NEW - per-group target collection
  category?: 'query' | 'mutation' | 'transform' | 'maintenance' | 'stream';  // NEW
}
```

**SelectedCell** (context: `src/contexts/CellSelectionContext.tsx`):
```typescript
interface SelectedCell {
  rowIndex: number;
  colKey: string;
  doc: Record<string, unknown>;
  value: unknown;
  groupIndex: number;  // NEW - which ResultGroup this cell belongs to
}
```

**No change to ExecutionResult** — `ResultGroup[]` already carries the metadata.

### Data Flow

**1. Execution (EditorArea → Runner)**

User triggers execution (Cmd+Enter or Run button):
- `EditorArea.executeContent()` reads `active.database` from runtime-selected dropdown (not `tab.database`)
- Calls runner: `executeScript({ script, connectionId, database, page, pageSize })`
- Note: `tab.collection` is **not** passed

**2. Runner Processing**

For each statement in the script:
1. Split script by semicolon (respecting quoted strings)
2. `queryTypeRegistry.classify(statement)` → `{ category, collection }`
3. Execute statement against MongoDB
4. Emit `ResultGroup` with:
   - `docs`: query results
   - `collection`: from classification
   - `category`: from classification
   - `groupIndex`: statement position

**3. Results Storage**

`ResultsStore` receives `ResultGroup[]` and stores them as-is. No additional processing.

**4. ResultsPanel Consumption**

`RecordContext` now derives collection from the active result group:

```typescript
const activeGroup = res?.groups[activeGroupIndex];

const recordContext = useMemo<RecordContext>(
  () => ({
    doc: {},
    connectionId,
    database: active.database,  // runtime-selected from EditorArea dropdown
    collection: activeGroup?.collection ?? undefined,  // from result metadata
  }),
  [connectionId, active.database, activeGroup?.collection],
);
```

**5. Selection Flow**

When user clicks a cell in `TableView`:
- `TableView` receives `activeGroupIndex` as prop from `ResultsPanel`
- `onCellClick` calls `select({ ..., groupIndex: activeGroupIndex })`
- `SelectedCell` now includes which group the cell belongs to

**6. Action Execution**

`useRecordActions` (modified):
- Accepts new param: `groupsRef: MutableRefObject<ResultGroup[]>`
- When record action fires:
  1. Read `selected.groupIndex`
  2. Look up `groups[selected.groupIndex].collection`
  3. Construct `RecordContext` with that collection
  4. Check `action.canExecute(ctx)` — F4 only passes if `category === 'query'`

### Edit Availability Logic

**F4 (Edit Record) is enabled when:**
1. `category === 'query'` (only find/findOne)
2. `collection !== null` (successfully extracted)
3. A cell is selected (existing guard)

**F4 is disabled when:**
- `category === 'mutation'` — you just modified it
- `category === 'transform'` — results are computed/aggregated
- `category === 'maintenance'` — metadata, not documents
- `category === 'stream'` — cursor, not editable
- `collection === null` — couldn't parse target collection

**F3 (View Full Record)** remains available for all document results regardless of category.

## Component Changes

### New Files

**`src/services/query/QueryTypeRegistry.ts`**
- `OperationDef` interface
- `QueryClassification` interface
- `QueryTypeRegistry` class with `classify()` method
- Export singleton: `export const queryTypeRegistry = new QueryTypeRegistry();`

### Modified Files

**`src/types.ts`**
- Add `collection?: string` to `ResultGroup`
- Add `category?: string` to `ResultGroup`

**`src/contexts/CellSelectionContext.tsx`**
- Add `groupIndex: number` to `SelectedCell`

**`src/components/results/TableView.tsx`**
- Accept `groupIndex: number` prop
- Pass it to `select()` when cell is clicked

**`src/components/results/ResultsPanel.tsx`**
- Pass `groupIndex={activeGroupIndex}` to `TableView`
- Derive `recordContext.collection` from `res.groups[activeGroupIndex].collection`
- Pass `groupsRef` to `useRecordActions`

**`src/hooks/useRecordActions.ts`**
- Accept new param: `groupsRef?: MutableRefObject<ResultGroup[]>`
- In record action handler:
  - Read `groups[selected.groupIndex]`
  - Use that group's `collection` for `RecordContext`

**`runner/harness.js`** (or equivalent execution harness)
- Import `queryTypeRegistry`
- For each statement:
  - `const { category, collection } = queryTypeRegistry.classify(statement);`
  - Execute statement
  - Emit `ResultGroup` with `collection` and `category`

## Multi-Collection Script Examples

**Example 1: Two queries**
```javascript
db.users.find({});
db.posts.find({});
```
- Group 0: `{ collection: 'users', category: 'query' }` → F4 targets users
- Group 1: `{ collection: 'posts', category: 'query' }` → F4 targets posts

**Example 2: Query + mutation**
```javascript
db.users.find({});
db.audit.insertOne({ event: 'viewed' });
```
- Group 0: `{ collection: 'users', category: 'query' }` → F4 enabled
- Group 1: `{ collection: 'audit', category: 'mutation' }` → F4 disabled

**Example 3: Aggregation**
```javascript
db.orders.aggregate([
  { $group: { _id: '$status', total: { $sum: '$amount' } } }
]);
```
- Group 0: `{ collection: 'orders', category: 'transform' }` → F4 disabled

## Migration & Backward Compatibility

**No breaking changes:**
- `EditorTab.collection` remains in type (unused but harmless)
- Existing saved scripts continue to work
- Collection scripts opened from ConnectionTree work the same (now correctly parse collection from script instead of relying on frozen tab metadata)

**Deployment strategy:**
1. Add `QueryTypeRegistry` and tests
2. Update runner to emit per-group metadata
3. Update `ResultsPanel` and related components
4. Remove `tab.collection` usage — leave field in type for now (can be cleaned up later)

## Edge Cases

**Empty script / no operations:**
- `classify()` returns `{ category: null, collection: null }`
- F4 disabled (no editable target)

**Comment-only script:**
- `classify()` returns `{ category: null, collection: null }`
- F4 disabled

**Dynamic collection names:**
```javascript
const col = 'users';
db[col].find({});
```
- Parser cannot extract collection (relies on static analysis)
- Returns `{ category: 'query', collection: null }`
- F4 disabled (ambiguous target)

**Chained operations:**
```javascript
db.users.find({}).forEach(doc => { db.audit.insertOne(doc); });
```
- Parser detects first operation: `find()` on `users`
- Returns `{ category: 'query', collection: 'users' }`
- F4 targets users (outer query is editable, inner forEach doesn't affect classification)

**Multiple operations on same collection:**
```javascript
db.users.find({ active: true });
db.users.updateMany({ active: false }, { $set: { archived: true } });
```
- Group 0: `{ collection: 'users', category: 'query' }` → F4 enabled
- Group 1: `{ collection: 'users', category: 'mutation' }` → F4 disabled

## Testing Strategy

**Unit tests (QueryTypeRegistry):**
- Classify each operation category correctly
- Extract collection from `db.getCollection("name")` and `db.name` forms
- Handle scripts with no operations → `{ category: null, collection: null }`
- Multi-statement scripts → correct per-statement classification

**Integration tests (ResultsPanel):**
- F4 enabled for query results
- F4 disabled for aggregation/mutation/transform results
- Multi-group scripts: F4 targets correct collection per group
- Switching between groups updates F4 availability dynamically

**End-to-end:**
- Run collection script from ConnectionTree → F4 works
- Load saved script with query → F4 works
- Change database dropdown, run script → uses new database
- Multi-collection script → F4 works per-group

## Success Criteria

1. **F4 availability matches script content**, not tab creation path
2. **Database picker drives execution**, not frozen `tab.database`
3. **Multi-collection scripts** have per-group F4 targeting
4. **Aggregations and mutations** correctly disable F4
5. **No regressions** in existing single-collection workflows

## Open Questions

None — design is complete and approved.
