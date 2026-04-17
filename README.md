# MongoMacApp

A native Mac desktop MongoDB client — manage connections, run scripts, browse collections, and edit documents. Open source, built with Tauri + React.

![Platform](https://img.shields.io/badge/platform-macOS-lightgrey) ![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Connection manager** — host/port/auth or connection string, SSH tunnel support, passwords in macOS Keychain
- **Script editor** — Monaco editor (VS Code engine), multi-tab, syntax highlighting, `Cmd+Enter` to run
- **Collection browser** — lazy-loaded database → collection → index tree
- **Results viewer** — JSON and Table views, inline document editing, CSV/JSON export
- **Saved scripts** — name, tag, and reuse scripts across sessions
- **Autocomplete** — collection names suggested as you type

## Prerequisites

- macOS 12+
- [Node.js](https://nodejs.org) v18+
- [Rust](https://rustup.rs) (stable)

```bash
# Install Rust if you don't have it
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## Getting Started

```bash
# Clone
git clone https://github.com/jagadeesh52423/MongoMacApp.git
cd MongoMacApp

# Install dependencies
npm install

# Run in development mode (opens the app window)
npm run tauri dev
```

> First run takes ~2 minutes while Rust compiles. Subsequent starts are fast.

## Build a distributable .app

```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/macos/MongoMacApp.app
```

Double-click `MongoMacApp.app` or move it to `/Applications`.

## Usage

1. Click **⚡** in the icon rail → **+** to add a connection
2. Fill in host/port or paste a `mongodb://` connection string
3. Click **Connect** — databases and collections appear in the tree
4. Open a script tab, write your query, hit **Cmd+Enter**
5. Results appear below in JSON or Table view — click any cell to edit inline

## Development

```bash
npm test          # Run frontend tests (Vitest)
npm run build     # Type-check + build frontend
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| App shell | Tauri v2 (Rust + WebView) |
| Frontend | React 18 + TypeScript + Vite |
| Editor | Monaco Editor |
| State | Zustand |
| Script execution | Node.js subprocess |
| MongoDB driver | Rust `mongodb` crate + `mongodb` npm package |
| Local storage | SQLite (`rusqlite`) |
| Credentials | macOS Keychain |

## Contributing

PRs welcome. See `docs/superpowers/specs/` for the design spec and `docs/superpowers/plans/` for the implementation plan.
