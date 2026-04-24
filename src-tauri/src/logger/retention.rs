use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

/// Delete any file in `logs_dir` matching app.log.*, backend.log.*, or
/// runner-*.log whose mtime is older than `retention_days`. Errors are
/// swallowed (one eprintln! per failed entry) — a retention failure must not
/// crash the app.
pub fn sweep(logs_dir: &Path, retention_days: u64) {
    let Ok(entries) = fs::read_dir(logs_dir) else { return };
    let cutoff = SystemTime::now() - Duration::from_secs(retention_days * 86_400);
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(mtime) = meta.modified() else { continue };
        if mtime >= cutoff { continue }
        let name = entry.file_name().to_string_lossy().to_string();
        let rolled =
            name.starts_with("app.log.") ||
            name.starts_with("backend.log.") ||
            (name.starts_with("runner-") && name.ends_with(".log"));
        if !rolled { continue }
        if let Err(e) = fs::remove_file(entry.path()) {
            eprintln!("[logger::retention] failed to remove {:?}: {e}", entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use filetime::{set_file_mtime, FileTime};
    use std::time::{Duration, SystemTime};
    use tempfile::tempdir;

    fn touch(path: &Path, days_ago: u64) {
        std::fs::write(path, "x").unwrap();
        let t = SystemTime::now() - Duration::from_secs(days_ago * 86_400 + 60);
        let ft = FileTime::from_system_time(t);
        set_file_mtime(path, ft).unwrap();
    }

    #[test]
    fn removes_files_older_than_retention() {
        let d = tempdir().unwrap();
        touch(&d.path().join("backend.log.2026-04-17"), 8);
        touch(&d.path().join("app.log.2026-04-18"), 10);
        touch(&d.path().join("runner-abc.log"), 14);
        touch(&d.path().join("backend.log.2026-04-22"), 1);
        touch(&d.path().join("runner-def.log"), 6);
        touch(&d.path().join("unrelated.txt"), 30);

        sweep(d.path(), 7);

        let remaining: Vec<String> = std::fs::read_dir(d.path()).unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();

        assert!(!remaining.iter().any(|n| n == "backend.log.2026-04-17"));
        assert!(!remaining.iter().any(|n| n == "app.log.2026-04-18"));
        assert!(!remaining.iter().any(|n| n == "runner-abc.log"));
        assert!( remaining.iter().any(|n| n == "backend.log.2026-04-22"));
        assert!( remaining.iter().any(|n| n == "runner-def.log"));
        assert!( remaining.iter().any(|n| n == "unrelated.txt"));
    }
}
