use crate::logger::{Layer, Level, LogCtx, LogRecord};
use crate::state::AppState;
use serde::Deserialize;
use tauri::State;

#[derive(Deserialize)]
pub struct FrontendLogRecord {
    pub ts: i64,           // epoch ms from frontend
    pub level: Level,
    pub logger: String,
    #[serde(default, rename = "runId")]
    pub run_id: Option<String>,
    pub msg: String,
    #[serde(default)]
    pub ctx: LogCtx,
}

#[derive(Deserialize)]
pub struct LogWritePayload {
    pub records: Vec<FrontendLogRecord>,
}

#[tauri::command]
pub fn log_write(state: State<'_, AppState>, payload: LogWritePayload) {
    let Some(logger) = state.tracing_logger.as_ref() else { return };
    for r in payload.records {
        let ts = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(r.ts)
            .unwrap_or_else(chrono::Utc::now)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let rec = LogRecord {
            ts,
            level: r.level,
            layer: Layer::Frontend,
            logger: r.logger,
            run_id: r.run_id,
            msg: r.msg,
            ctx: r.ctx,
        };
        logger.write_frontend_record(rec);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logger::tracing_impl::TracingLogger;
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
        assert!(entries.iter().any(|e| e.as_ref().unwrap().file_name().to_string_lossy().starts_with("app.log")));
    }
}
