use super::{redact, Layer, Level, LogCtx, LogRecord, Logger};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tracing_appender::rolling::{RollingFileAppender, Rotation};

/// Shared file appenders (backend + frontend). Wrapped in Mutex<Box<dyn Write>> because
/// tracing_appender's RollingFileAppender implements Write but not Sync-clone.
pub struct Writers {
    backend: Mutex<RollingFileAppender>,
    frontend: Mutex<RollingFileAppender>,
}

impl Writers {
    pub fn new(logs_dir: &Path) -> std::io::Result<Arc<Self>> {
        std::fs::create_dir_all(logs_dir)?;
        let backend = RollingFileAppender::new(Rotation::DAILY, logs_dir, "backend.log");
        let frontend = RollingFileAppender::new(Rotation::DAILY, logs_dir, "app.log");
        Ok(Arc::new(Self {
            backend: Mutex::new(backend),
            frontend: Mutex::new(frontend),
        }))
    }

    pub fn write_backend(&self, line: &str) {
        let mut w = self.backend.lock().unwrap();
        let _ = writeln!(w, "{line}");
    }

    pub fn write_frontend(&self, line: &str) {
        let mut w = self.frontend.lock().unwrap();
        let _ = writeln!(w, "{line}");
    }
}

#[derive(Clone)]
pub struct TracingLogger {
    name: String,
    threshold: Level,
    layer: Layer,
    bindings: LogCtx,
    writers: Arc<Writers>,
}

impl TracingLogger {
    pub fn init(logs_dir: &Path, threshold: Level) -> std::io::Result<Arc<Self>> {
        let writers = Writers::new(logs_dir)?;
        Ok(Arc::new(Self {
            name: "app".to_owned(),
            threshold,
            layer: Layer::Backend,
            bindings: LogCtx::new(),
            writers,
        }))
    }

    /// Used by the log_write IPC command to append a frontend record to app.log.
    pub fn write_frontend_record(&self, record: LogRecord) {
        let ctx = redact::redact_ctx(record.ctx);
        let sanitised = LogRecord { ctx, ..record };
        if let Ok(line) = serde_json::to_string(&sanitised) {
            self.writers.write_frontend(&line);
        }
    }

    pub fn logs_dir(&self) -> PathBuf {
        // We don't retain the path on the struct; callers that need it should pass
        // it from main.rs. Added only for future use.
        PathBuf::new()
    }
}

impl Logger for TracingLogger {
    fn log(&self, record: LogRecord) {
        if let Ok(line) = serde_json::to_string(&record) {
            match record.layer {
                Layer::Backend => self.writers.write_backend(&line),
                Layer::Frontend => self.writers.write_frontend(&line),
                Layer::Runner => self.writers.write_backend(&line), // runner routes via Rust only if requested
            }
        }
    }

    fn child(&self, bindings: LogCtx) -> Arc<dyn Logger> {
        let mut merged = self.bindings.clone();
        for (k, v) in bindings { merged.insert(k, v); }
        Arc::new(TracingLogger {
            name: self.name.clone(),
            threshold: self.threshold,
            layer: self.layer,
            bindings: merged,
            writers: self.writers.clone(),
        })
    }

    fn name(&self) -> &str { &self.name }
    fn threshold(&self) -> Level { self.threshold }
    fn bindings(&self) -> &LogCtx { &self.bindings }
    fn layer(&self) -> Layer { self.layer }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logctx;
    use tempfile::tempdir;

    fn read_log(dir: &Path, prefix: &str) -> String {
        let mut out = String::new();
        for entry in std::fs::read_dir(dir).unwrap() {
            let e = entry.unwrap();
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with(prefix) {
                out.push_str(&std::fs::read_to_string(e.path()).unwrap());
            }
        }
        out
    }

    #[test]
    fn writes_jsonl_to_backend_log() {
        let d = tempdir().unwrap();
        let log = TracingLogger::init(d.path(), Level::Debug).unwrap();
        log.info("hello", logctx! { "runId" => "r1", "page" => 3 });
        drop(log);
        let contents = read_log(d.path(), "backend.log");
        assert!(contents.contains("\"msg\":\"hello\""));
        assert!(contents.contains("\"runId\":\"r1\""));
        assert!(contents.contains("\"level\":\"info\""));
    }

    #[test]
    fn write_frontend_record_appends_to_app_log() {
        let d = tempdir().unwrap();
        let log = TracingLogger::init(d.path(), Level::Debug).unwrap();
        let record = LogRecord {
            ts: "2026-04-24T00:00:00.000Z".to_owned(),
            level: Level::Info,
            layer: Layer::Frontend,
            logger: "components.X".to_owned(),
            run_id: Some("r1".to_owned()),
            msg: "click".to_owned(),
            ctx: logctx! { "tabId" => "t1" },
        };
        log.write_frontend_record(record);
        drop(log);
        let contents = read_log(d.path(), "app.log");
        assert!(contents.contains("\"msg\":\"click\""));
        assert!(contents.contains("\"runId\":\"r1\""));
    }

    #[test]
    fn child_preserves_bindings() {
        let d = tempdir().unwrap();
        let log = TracingLogger::init(d.path(), Level::Debug).unwrap();
        let child = log.child(logctx! { "runId" => "r2" });
        child.info("go", LogCtx::new());
        drop(child);
        drop(log);
        let contents = read_log(d.path(), "backend.log");
        assert!(contents.contains("\"runId\":\"r2\""));
    }
}
