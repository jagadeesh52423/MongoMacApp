use crate::logctx;
use crate::logger::tracing_impl::TracingLogger;
use crate::logger::{Layer, Level, LogCtx, LogRecord, Logger as _};
use crate::state::AppState;
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

#[derive(Deserialize)]
pub struct FrontendLogRecord {
    pub ts: i64, // epoch ms from frontend
    pub level: Level,
    pub logger: String,
    #[serde(default, rename = "runId")]
    pub run_id: Option<String>,
    pub msg: String,
    #[serde(default)]
    pub ctx: LogCtx,
}

/// Convert a single deserialized FE record to a LogRecord with backend-stamped
/// ISO8601 timestamp + `layer=frontend`. Pure mapping — extracted so it can be
/// exercised by unit tests without a real Tauri State.
fn frontend_to_log_record(r: FrontendLogRecord) -> LogRecord {
    let ts = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(r.ts)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    LogRecord {
        ts,
        level: r.level,
        layer: Layer::Frontend,
        logger: r.logger,
        run_id: r.run_id,
        msg: r.msg,
        ctx: r.ctx,
    }
}

/// Defensive deserialize + dispatch: walks the `records` array of an arbitrary
/// JSON payload, parses each entry as a [`FrontendLogRecord`], writes well-
/// formed entries to `app.log`, and emits one `warn` per malformed entry to
/// `backend.log`. Never raises — a misbehaving frontend cannot break the
/// command. Returns `(written, dropped)` for tests.
fn dispatch_log_write(
    payload: serde_json::Value,
    tracing_logger: &TracingLogger,
    backend_logger: &dyn crate::logger::Logger,
) -> (usize, usize) {
    let records = match payload.get("records").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => {
            backend_logger.warn(
                "log_write payload missing records array",
                logctx! { "payload" => payload.to_string() },
            );
            return (0, 0);
        }
    };

    let mut written = 0usize;
    let mut dropped = 0usize;
    for raw in records {
        match serde_json::from_value::<FrontendLogRecord>(raw.clone()) {
            Ok(r) => {
                tracing_logger.write_frontend_record(frontend_to_log_record(r));
                written += 1;
            }
            Err(e) => {
                dropped += 1;
                backend_logger.warn(
                    "log_write malformed record dropped",
                    logctx! { "err" => e.to_string() },
                );
            }
        }
    }
    (written, dropped)
}

#[tauri::command]
pub fn log_write(state: State<'_, AppState>, payload: serde_json::Value) {
    let Some(tracing_logger) = state.tracing_logger.as_ref() else { return };
    // `state.logger` is the same TracingLogger, but typed as `Arc<dyn Logger>`
    // for the `warn` paths so its layer stays as Backend (warns belong in
    // backend.log, not app.log).
    let backend_logger: Arc<dyn crate::logger::Logger> = state.logger.clone();
    let _ = dispatch_log_write(payload, tracing_logger.as_ref(), backend_logger.as_ref());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logger::tracing_impl::TracingLogger;
    use crate::logger::MemoryLogger;
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn deserialises_records_and_writes_to_app_log() {
        // Direct exercise of TracingLogger::write_frontend_record — the Tauri
        // command is a thin shim and State<AppState> can't be faked in unit tests.
        let d = tempdir().unwrap();
        let log = TracingLogger::init(d.path(), Level::Debug).unwrap();
        let r = LogRecord {
            ts: "2026-04-24T00:00:00.000Z".into(),
            level: Level::Info,
            layer: Layer::Frontend,
            logger: "x".into(),
            run_id: Some("r1".into()),
            msg: "hello".into(),
            ctx: crate::logger::LogCtx::new(),
        };
        log.write_frontend_record(r);
        drop(log);
        let entries: Vec<_> = std::fs::read_dir(d.path()).unwrap().collect();
        assert!(entries
            .iter()
            .any(|e| e.as_ref().unwrap().file_name().to_string_lossy().starts_with("app.log")));
    }

    #[test]
    fn dispatch_writes_well_formed_records() {
        let d = tempdir().unwrap();
        let tracing = TracingLogger::init(d.path(), Level::Debug).unwrap();
        let mem = MemoryLogger::new("backend");
        let payload = json!({
            "records": [
                { "ts": 1_700_000_000_000_i64, "level": "info", "logger": "x", "msg": "hello", "ctx": {} },
                { "ts": 1_700_000_001_000_i64, "level": "warn", "logger": "x", "msg": "world", "ctx": {} },
            ]
        });
        let (written, dropped) = dispatch_log_write(payload, tracing.as_ref(), mem.as_ref());
        assert_eq!(written, 2);
        assert_eq!(dropped, 0);
        assert!(mem.records().is_empty(), "backend log should be untouched on a clean payload");
    }

    #[test]
    fn dispatch_drops_malformed_records_and_warns() {
        // M-2 spec: backend handler returns; drops record; logs a single warn
        // to backend.log per malformed record. Well-formed siblings still write.
        let d = tempdir().unwrap();
        let tracing = TracingLogger::init(d.path(), Level::Debug).unwrap();
        let mem = MemoryLogger::new("backend");
        let payload = json!({
            "records": [
                { "ts": 1_700_000_000_000_i64, "level": "info", "logger": "x", "msg": "good", "ctx": {} },
                { "ts": "not-a-number", "level": "info", "logger": "x", "msg": "bad-ts" },
                { "level": "info" }, // missing required ts/logger/msg
            ]
        });
        let (written, dropped) = dispatch_log_write(payload, tracing.as_ref(), mem.as_ref());
        assert_eq!(written, 1, "well-formed record should still be written");
        assert_eq!(dropped, 2);
        let warns = mem.records();
        assert_eq!(warns.len(), 2, "one warn per malformed record");
        for w in &warns {
            assert_eq!(w.msg, "log_write malformed record dropped");
            assert_eq!(w.level, Level::Warn);
        }
    }

    #[test]
    fn dispatch_handles_missing_records_array() {
        // Top-level malformed payload (no `records` field): one warn, no panic.
        let d = tempdir().unwrap();
        let tracing = TracingLogger::init(d.path(), Level::Debug).unwrap();
        let mem = MemoryLogger::new("backend");
        let payload = json!({ "wrong-shape": true });
        let (written, dropped) = dispatch_log_write(payload, tracing.as_ref(), mem.as_ref());
        assert_eq!(written, 0);
        assert_eq!(dropped, 0);
        let warns = mem.records();
        assert_eq!(warns.len(), 1);
        assert_eq!(warns[0].msg, "log_write payload missing records array");
    }
}
