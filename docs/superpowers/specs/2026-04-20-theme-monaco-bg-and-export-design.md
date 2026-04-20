# Theme: Monaco Background Fix + Export Feature

**Date:** 2026-04-20  
**Status:** Approved

---

## Overview

Two related improvements to the theme system:

1. **Monaco background sync** — fix Monaco editor background to use `--bg-panel` instead of `--bg`
2. **Theme export** — add a per-card export button (hover-revealed, extensible via action array)

---

## Feature 1: Monaco Background

### Problem

`applyTheme.ts` currently sets `editor.background`, `editor.lineHighlightBackground`, `editorGutter.background`, and `minimap.background` from `--bg`. This means the editor background matches the main app background rather than the panel background, causing a visual mismatch.

### Solution

In `applyMonacoTheme()` inside `src/themes/applyTheme.ts`, read `--bg-panel` instead of `--bg` for all four Monaco background color fields.

No new CSS variables, no schema changes to `ThemeDefinition`.

---

## Feature 2: Theme Export

### Extensible Action Model

Introduce a `ThemeCardAction` interface so future actions (delete, duplicate, edit) require zero changes to `ThemeCard`:

```typescript
interface ThemeCardAction {
  icon: string;    // emoji or icon character rendered in the button
  label: string;   // tooltip / aria-label
  onClick: (theme: ThemeDefinition) => void;
}
```

### ThemeCard Changes (`src/settings/sections/ThemeSection.tsx`)

- Add `actions: ThemeCardAction[]` prop to `ThemeCard`
- Add `hovered` boolean state **inside `ThemeCard`** (`onMouseEnter` sets true, `onMouseLeave` sets false) — each card manages its own hover state independently
- On hover, render action buttons in the **top-right corner** of the swatch area as absolutely-positioned icon buttons
- Each action button calls `e.stopPropagation()` then `action.onClick(theme)` — so clicking an action never triggers card activation
- The card root element handles `onClick` for theme activation (unchanged)
- `ThemeSection` constructs the actions array and passes it:

```typescript
const actions: ThemeCardAction[] = [
  {
    icon: '⬇',
    label: 'Export theme',
    onClick: handleExport,
  },
];
```

### Export Handler

```typescript
async function handleExport(theme: ThemeDefinition) {
  const json = JSON.stringify({ id: theme.id, name: theme.name, variables: theme.variables }, null, 2);
  const path = await save({
    defaultPath: `${theme.name}.json`,
    filters: [{ name: 'Theme JSON', extensions: ['json'] }],
  });
  if (!path) return;
  await writeTextFile(path, json);
}
```

Uses `save()` from `@tauri-apps/plugin-dialog` and `writeTextFile()` from `@tauri-apps/plugin-fs` — both already imported/available in the project.

Works identically for built-in and imported themes.

---

## Files Changed

| File | Change |
|------|--------|
| `src/themes/applyTheme.ts` | Read `--bg-panel` instead of `--bg` for Monaco background fields |
| `src/settings/sections/ThemeSection.tsx` | Add `ThemeCardAction` interface, `actions` prop on `ThemeCard`, hover state, export handler |

---

## Non-Goals

- No new CSS variables or changes to `ThemeDefinition` schema
- No delete/duplicate actions in this iteration (extensible for later)
- No theme editing UI
