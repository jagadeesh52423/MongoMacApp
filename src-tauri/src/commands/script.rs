use crate::db;
use crate::keychain;
use crate::mongo;
use crate::runner::executor::spawn_script;
use crate::state::AppState;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScriptEvent {
    pub tab_id: String,
    pub kind: String,
    pub group_index: Option<i64>,
    pub docs: Option<serde_json::Value>,
    pub error: Option<String>,
    pub execution_ms: Option<u128>,
}

#[tauri::command]
pub async fn run_script(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
    connection_id: String,
    database: String,
    script: String,
) -> Result<(), String> {
    let conn = state.open_db().map_err(|e| e.to_string())?;
    let rec = db::connections::get(&conn, &connection_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "connection not found".to_string())?;
    drop(conn);
    let pw = keychain::get_password(&connection_id)?;
    let uri = mongo::build_uri(&rec, pw.as_deref());

    let tmp_dir = std::env::temp_dir();
    let script_path = tmp_dir.join(format!("mongomacapp-{}.js", uuid::Uuid::new_v4()));
    std::fs::write(&script_path, script).map_err(|e| e.to_string())?;

    let tab_id_arc: Arc<String> = Arc::new(tab_id);
    let app_handle = app.clone();

    let start = Instant::now();
    let mut child = spawn_script(&uri, &database, &script_path)?;
    let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;

    let stdout_handle = {
        let ah = app_handle.clone();
        let tab = tab_id_arc.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let (Some(idx), Some(docs)) =
                        (v.get("__group").and_then(|x| x.as_i64()), v.get("docs"))
                    {
                        let evt = ScriptEvent {
                            tab_id: (*tab).clone(),
                            kind: "group".into(),
                            group_index: Some(idx),
                            docs: Some(docs.clone()),
                            error: None,
                            execution_ms: None,
                        };
                        let _ = ah.emit("script-event", evt);
                    }
                }
            }
        })
    };

    let stderr_handle = {
        let ah = app_handle.clone();
        let tab = tab_id_arc.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                let err = serde_json::from_str::<serde_json::Value>(&line)
                    .ok()
                    .and_then(|v| v.get("__error").and_then(|e| e.as_str()).map(|s| s.to_string()))
                    .unwrap_or(line);
                let evt = ScriptEvent {
                    tab_id: (*tab).clone(),
                    kind: "error".into(),
                    group_index: None,
                    docs: None,
                    error: Some(err),
                    execution_ms: None,
                };
                let _ = ah.emit("script-event", evt);
            }
        })
    };

    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();
    let _ = std::fs::remove_file(&script_path);

    let elapsed = start.elapsed().as_millis();
    let done = ScriptEvent {
        tab_id: (*tab_id_arc).clone(),
        kind: "done".into(),
        group_index: None,
        docs: None,
        error: if status.success() { None } else { Some("exited with error".into()) },
        execution_ms: Some(elapsed),
    };
    let _ = app_handle.emit("script-event", done);
    Ok(())
}
