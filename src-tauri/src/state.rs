use mongodb::Client;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::logger::tracing_impl::TracingLogger;

pub struct AppState {
    pub db_path: PathBuf,
    pub mongo_clients: Mutex<HashMap<String, Client>>,
    /// Per-tab cancel flag. Set to true to signal the running script to abort.
    pub active_scripts: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Concrete TracingLogger kept so the log_write handler can write frontend records.
    /// Full composition-root wiring (the generic `logger: Arc<dyn Logger>` handle and
    /// `logs_dir`) is added in Task 15 — this minimal field exists now so the
    /// `log_write` Tauri command compiles.
    pub tracing_logger: Option<Arc<TracingLogger>>,
}

impl AppState {
    pub fn new(db_path: PathBuf) -> Self {
        Self {
            db_path,
            mongo_clients: Mutex::new(HashMap::new()),
            active_scripts: Mutex::new(HashMap::new()),
            tracing_logger: None,
        }
    }

    pub fn open_db(&self) -> rusqlite::Result<rusqlite::Connection> {
        crate::db::open(&self.db_path)
    }
}
