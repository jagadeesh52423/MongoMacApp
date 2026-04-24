use crate::logctx;
use crate::logger::Logger;
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

const SERVICE: &str = "com.mongomacapp.app";

pub fn account_for(connection_id: &str) -> String {
    format!("mongomacapp.{}", connection_id)
}

pub fn set_password(connection_id: &str, password: &str, log: &dyn Logger) -> Result<(), String> {
    let account = account_for(connection_id);
    // NEVER log `password` — only log that a set happened.
    match set_generic_password(SERVICE, &account, password.as_bytes()) {
        Ok(()) => {
            log.info("keychain set", logctx! { "connId" => connection_id });
            Ok(())
        }
        Err(e) => {
            log.error("keychain set failed", logctx! {
                "connId" => connection_id,
                "err" => e.to_string(),
            });
            Err(e.to_string())
        }
    }
}

pub fn get_password(connection_id: &str, log: &dyn Logger) -> Result<Option<String>, String> {
    let account = account_for(connection_id);
    match get_generic_password(SERVICE, &account) {
        Ok(bytes) => {
            // NEVER log the returned secret — only its presence.
            let s = String::from_utf8(bytes).map_err(|e| {
                log.error("keychain utf8 decode failed", logctx! {
                    "connId" => connection_id,
                    "err" => e.to_string(),
                });
                e.to_string()
            })?;
            log.info("keychain get", logctx! {
                "connId" => connection_id,
                "found" => true,
            });
            Ok(Some(s))
        }
        Err(e) => {
            // errSecItemNotFound = -25300
            let msg = format!("{}", e);
            if msg.contains("-25300") || msg.contains("not found") || msg.contains("could not be found") {
                log.info("keychain get", logctx! {
                    "connId" => connection_id,
                    "found" => false,
                });
                Ok(None)
            } else {
                log.error("keychain get failed", logctx! {
                    "connId" => connection_id,
                    "err" => e.to_string(),
                });
                Err(e.to_string())
            }
        }
    }
}

pub fn delete_password(connection_id: &str, log: &dyn Logger) -> Result<(), String> {
    let account = account_for(connection_id);
    match delete_generic_password(SERVICE, &account) {
        Ok(()) => {
            log.info("keychain delete", logctx! { "connId" => connection_id });
            Ok(())
        }
        Err(e) => {
            let msg = format!("{}", e);
            if msg.contains("-25300") || msg.contains("not found") || msg.contains("could not be found") {
                log.debug("keychain delete noop (not found)", logctx! {
                    "connId" => connection_id,
                });
                Ok(())
            } else {
                log.error("keychain delete failed", logctx! {
                    "connId" => connection_id,
                    "err" => e.to_string(),
                });
                Err(e.to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logger::MemoryLogger;

    #[test]
    fn account_format() {
        assert_eq!(account_for("abc"), "mongomacapp.abc");
    }

    #[test]
    fn set_get_delete_roundtrip() {
        let log = MemoryLogger::new("test");
        let id = format!("test-{}", uuid::Uuid::new_v4());
        set_password(&id, "hunter2", log.as_ref()).unwrap();
        let got = get_password(&id, log.as_ref()).unwrap();
        assert_eq!(got.as_deref(), Some("hunter2"));
        delete_password(&id, log.as_ref()).unwrap();
        let after = get_password(&id, log.as_ref()).unwrap();
        assert!(after.is_none());
    }
}
