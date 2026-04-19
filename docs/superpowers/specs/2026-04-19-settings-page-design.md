# Settings Page Design

**Date:** 2026-04-19  
**Status:** Approved

---

## Overview

A full-screen settings view accessible via a gear icon in the IconRail. Replaces the editor area when open; the IconRail remains visible. Built on a config-driven registry pattern so new sections can be added by registering a single descriptor object — no structural changes required.

Initial sections: **Keyboard Shortcuts** (rebindable) and **Theme** (presets, with future external theme install support).

Settings persist across restarts via `tauri-plugin-store`.

---

## Entry Point & Navigation

- A gear icon (`⚙️`) is added at the bottom of `IconRail`. Clicking it sets `settingsOpen = true` in `App.tsx`.
- When `settingsOpen` is true, `App.tsx` renders `<SettingsView>` instead of the editor + side panel.
- `SettingsView` has a "← Back" button in its header that sets `settingsOpen = false`.
- The keyboard shortcut `Cmd+,` opens/closes settings (registered in `KeyboardService`).

---

## Layout

Two-column full-screen layout:

```
┌─────────────┬──────────────────────────────────────┐
│  IconRail   │  ← Back    SETTINGS                  │  ← header
│  (44px)     ├────────────┬─────────────────────────┤
│             │  Nav       │  Active section content  │
│             │  (200px)   │  (fills remaining width) │
│             │            │                          │
│             │  ⌨️ Shortcuts (active)                │
│             │  🎨 Theme                             │
└─────────────┴────────────┴─────────────────────────┘
```

The nav column iterates the `SettingsRegistry` array. The active section is highlighted with a left border accent. The content column renders the active section's component.

---

## Architecture: Config-Driven Registry

### SettingSection

```typescript
interface SettingSection {
  id: string;                        // unique key, e.g. "shortcuts"
  label: string;                     // nav display text
  icon: string;                      // emoji or icon identifier
  component: React.ComponentType;    // rendered in content column
}
```

### SettingsRegistry (`src/settings/registry.ts`)

```typescript
const sections: SettingSection[] = [];

function register(section: SettingSection): void {
  sections.push(section);
}

function getSections(): SettingSection[] {
  return sections;
}
```

Built-in sections call `register()` at module init. External sections (future) call the same function. `SettingsView` calls `getSections()` to build both the nav and the content router — it has no knowledge of individual sections.

---

## Settings Store (`src/store/settings.ts`)

Zustand store persisted via `tauri-plugin-store` to `settings.json`.

```typescript
// Persisted to tauri-plugin-store (themeId + shortcutOverrides only)
interface PersistedSettings {
  themeId: string;
  shortcutOverrides: Record<string, string>;  // shortcutId → serialized KeyCombo string
}

// Full Zustand store (activeSection is ephemeral UI state, not persisted)
interface SettingsState extends PersistedSettings {
  activeSection: string;

  setActiveSection(id: string): void;
  setTheme(id: string): void;
  setShortcutOverride(shortcutId: string, combo: string): void;
  resetShortcut(shortcutId: string): void;
}
```

**Boot sequence** (called once in `main.tsx`, before `ReactDOM.createRoot`, to avoid flash of default styles):
1. Load `PersistedSettings` from `tauri-plugin-store`
2. Call `applyTheme(themeId)` → sets CSS variables on `:root`
3. Call `KeyboardService.applyOverrides(shortcutOverrides)` → replaces default bindings

---

## Theme System

### ThemeDefinition (`src/themes/registry.ts`)

```typescript
interface ThemeDefinition {
  id: string;
  name: string;
  variables: Record<string, string>;  // CSS var name → value, e.g. "--bg": "#001e2b"
}
```

### ThemeRegistry

```typescript
const themes: ThemeDefinition[] = [];

function registerTheme(theme: ThemeDefinition): void;
function getThemes(): ThemeDefinition[];
function getTheme(id: string): ThemeDefinition | undefined;
```

### Built-in presets (`src/themes/definitions.ts`)

Three presets ship with v1:
- **mongodb-dark** — current app colors (`#001e2b` bg, `#00ed64` accent)
- **light** — light background, dark text, blue accent
- **midnight** — deep black background, white accent

### applyTheme (`src/themes/applyTheme.ts`)

```typescript
function applyTheme(themeId: string): void {
  const theme = getTheme(themeId);
  if (!theme) return;
  const root = document.documentElement;
  Object.entries(theme.variables).forEach(([key, val]) => {
    root.style.setProperty(key, val);
  });
}
```

Monaco editor theme must also be re-applied when the theme changes — `ThemeSection` triggers a re-define of the Monaco theme using the active theme's variables.

### External Theme Install (v1 stub, full in future)

`ThemeSection` renders a "Choose File…" button. In v1 it opens a Tauri file dialog, reads a `.json` file, validates it matches `ThemeDefinition` shape, calls `registerTheme()`, and sets it as active. The `ThemeRegistry` persists installed external themes to `tauri-plugin-store` alongside built-ins.

---

## Keyboard Shortcuts Section

### ShortcutsSection (`src/settings/sections/ShortcutsSection.tsx`)

Renders a table of all shortcuts registered in `KeyboardService`. Each row shows:
- Action label
- Current binding (default or overridden) as a key chip

**Rebinding flow:**
1. User clicks a binding chip → row enters listening state (pulsing "Press new key…" chip)
2. Next `keydown` event is captured (with `useEffect` + `window.addEventListener`)
3. Validation:
   - If combo is already bound to another action → show inline error "Already used by [action]"
   - If combo is a reserved system key → show inline error "Reserved by system"
   - Escape → cancel, exit listening state
4. Valid combo → call `setShortcutOverride(id, combo)` → `KeyboardService.applyOverrides()` → update persisted store
5. Right-click on a row → context menu with "Reset to default" option → calls `resetShortcut(id)`

`KeyboardService` needs one new method:

```typescript
applyOverrides(overrides: Record<string, string>): void;
// Iterates registered shortcuts, replaces KeyCombo for any id found in overrides
```

---

## File Structure

### New files

```
src/settings/
  registry.ts
  SettingsView.tsx
  sections/
    ShortcutsSection.tsx
    ThemeSection.tsx

src/themes/
  registry.ts
  definitions.ts
  applyTheme.ts

src/store/settings.ts
```

### Modified files

| File | Change |
|------|--------|
| `src/components/layout/IconRail.tsx` | Add gear icon at bottom; call `onSettingsOpen` prop |
| `src/App.tsx` | Add `settingsOpen` state; render `<SettingsView>` vs editor; pass open/close handlers |
| `src/services/KeyboardService.ts` | Add `applyOverrides()` method; expose shortcut labels for the table |
| `src/main.tsx` | Boot: load settings store, apply theme, apply shortcut overrides |

---

## Error Handling

- If `tauri-plugin-store` fails to load (first launch, corruption): fall back to defaults silently, no crash
- If an external theme JSON is malformed: show an inline error in `ThemeSection`, do not install
- If a shortcut override references an unknown shortcut id (e.g. shortcut was removed): silently ignore that override entry

---

## Testing

- `SettingsRegistry`: unit test that `register()` appends and `getSections()` returns correct order
- `applyTheme`: unit test that correct CSS vars are set on a mocked `document.documentElement`
- `KeyboardService.applyOverrides`: unit test that registered shortcuts are updated correctly
- `SettingsStore`: unit test store actions (setTheme, setShortcutOverride, resetShortcut)
- `ShortcutsSection`: integration test for rebind flow (click → listen → valid key → saved; duplicate key → error; Escape → cancel)
- `ThemeSection`: test that clicking a preset calls `applyTheme` with the correct id
