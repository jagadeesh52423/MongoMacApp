# Logging

MongoMacApp writes structured JSONL logs to `~/.mongomacapp/logs/`:

- `app.log` — UI-side events (frontend), batched through Tauri IPC.
- `backend.log` — Rust backend (commands, mongo, keychain, runner spawn).
- `runner-<runId>.log` — one file per script execution.

Rolled files: `app.log.YYYY-MM-DD`, `backend.log.YYYY-MM-DD`. Retention: 7 days.

## Reading a log line

Each line is a JSON object:

```json
{"ts":"2026-04-24T10:30:00.123Z","level":"info","layer":"backend","logger":"commands.script","runId":"8f2c4...","msg":"run_script start","ctx":{"connId":"c_1","db":"app"}}
```

## Correlating across layers

Every user-initiated flow carries a `runId`. To see the full causal chain:

```bash
RUN_ID=<the-run-id>
grep "\"runId\":\"$RUN_ID\"" ~/.mongomacapp/logs/*.log | sort
```

## Changing the level

Set the env var before launching:

```bash
MONGOMACAPP_LOG_LEVEL=debug open -a "Mongo Lens"
```

Valid: `error`, `warn`, `info` (default), `debug`.

## Safety

- Mongo URIs are redacted: `mongodb://user:***@host/db`.
- Script bodies are truncated to 200 chars + sha256 (see `hash:` suffix).
- `password`, `secret`, `token`, `authorization` fields are masked.
