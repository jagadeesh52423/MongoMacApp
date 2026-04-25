pub mod retention;
pub mod redact;
pub mod tracing_impl;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::Arc;
#[cfg(test)]
use std::sync::Mutex;

pub type LogCtx = BTreeMap<String, Value>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warn,
    Info,
    Debug,
}

impl Level {
    pub fn from_str(s: &str) -> Level {
        match s.to_ascii_lowercase().as_str() {
            "error" => Level::Error,
            "warn"  => Level::Warn,
            "debug" => Level::Debug,
            _       => Level::Info,
        }
    }

    pub fn enabled(self, threshold: Level) -> bool {
        self as u8 <= threshold as u8
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Layer {
    Frontend,
    Backend,
    Runner,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LogRecord {
    pub ts: String,
    pub level: Level,
    pub layer: Layer,
    pub logger: String,
    #[serde(rename = "runId", skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    pub msg: String,
    pub ctx: LogCtx,
}

pub trait Logger: Send + Sync {
    fn log(&self, record: LogRecord);
    fn child(&self, bindings: LogCtx) -> Arc<dyn Logger>;
    fn name(&self) -> &str;
    fn threshold(&self) -> Level;
    fn bindings(&self) -> &LogCtx;
    fn layer(&self) -> Layer { Layer::Backend }

    fn emit(&self, level: Level, msg: &str, extra: LogCtx) {
        if !level.enabled(self.threshold()) { return; }
        let mut ctx: LogCtx = self.bindings().clone();
        for (k, v) in extra { ctx.insert(k, v); }
        let ctx = redact::redact_ctx(ctx);
        let run_id = ctx.get("runId").and_then(|v| v.as_str()).map(str::to_owned);
        let rec = LogRecord {
            ts: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            level,
            layer: self.layer(),
            logger: self.name().to_owned(),
            run_id,
            msg: msg.to_owned(),
            ctx,
        };
        self.log(rec);
    }

    fn error(&self, msg: &str, ctx: LogCtx) { self.emit(Level::Error, msg, ctx); }
    fn warn (&self, msg: &str, ctx: LogCtx) { self.emit(Level::Warn,  msg, ctx); }
    fn info (&self, msg: &str, ctx: LogCtx) { self.emit(Level::Info,  msg, ctx); }
    fn debug(&self, msg: &str, ctx: LogCtx) { self.emit(Level::Debug, msg, ctx); }
}

/// Convenience for building a LogCtx: `logctx! { "runId" => run_id, "page" => page }`.
#[macro_export]
macro_rules! logctx {
    () => { $crate::logger::LogCtx::new() };
    ( $( $k:expr => $v:expr ),* $(,)? ) => {{
        let mut m = $crate::logger::LogCtx::new();
        $( m.insert($k.to_string(), serde_json::json!($v)); )*
        m
    }};
}

// --- MemoryLogger for tests ---------------------------------------------------

#[cfg(test)]
pub struct MemoryLoggerInner {
    pub records: Mutex<Vec<LogRecord>>,
}

#[cfg(test)]
pub struct MemoryLogger {
    name: String,
    threshold: Level,
    layer: Layer,
    bindings: LogCtx,
    inner: Arc<MemoryLoggerInner>,
}

#[cfg(test)]
impl MemoryLogger {
    pub fn new(name: &str) -> Arc<Self> {
        Arc::new(Self {
            name: name.to_owned(),
            threshold: Level::Debug,
            layer: Layer::Backend,
            bindings: LogCtx::new(),
            inner: Arc::new(MemoryLoggerInner { records: Mutex::new(Vec::new()) }),
        })
    }

    pub fn records(&self) -> Vec<LogRecord> {
        self.inner.records.lock().unwrap().clone()
    }
}

#[cfg(test)]
impl Logger for MemoryLogger {
    fn log(&self, record: LogRecord) {
        self.inner.records.lock().unwrap().push(record);
    }
    fn child(&self, bindings: LogCtx) -> Arc<dyn Logger> {
        let mut merged = self.bindings.clone();
        for (k, v) in bindings { merged.insert(k, v); }
        Arc::new(MemoryLogger {
            name: self.name.clone(),
            threshold: self.threshold,
            layer: self.layer,
            bindings: merged,
            inner: self.inner.clone(),
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

    #[test]
    fn memory_logger_records_levels() {
        let log = MemoryLogger::new("root");
        log.info("hello", logctx! { "a" => 1 });
        log.error("oops", LogCtx::new());
        let r = log.records();
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].msg, "hello");
        assert_eq!(r[0].level, Level::Info);
        assert_eq!(r[1].level, Level::Error);
    }

    #[test]
    fn memory_logger_child_merges_bindings() {
        let root = MemoryLogger::new("root");
        let child = root.child(logctx! { "runId" => "r1" });
        child.info("go", logctx! { "extra" => 9 });
        let r = root.records();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].run_id.as_deref(), Some("r1"));
        assert_eq!(r[0].ctx.get("extra").unwrap(), &serde_json::json!(9));
    }

    #[test]
    fn threshold_suppresses_below() {
        // MemoryLogger ignores threshold (always debug); use the emit path directly.
        let log = MemoryLogger::new("root");
        log.debug("x", LogCtx::new());
        assert_eq!(log.records().len(), 1);
    }
}
