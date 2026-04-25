use crate::keychain;
use crate::logctx;
use crate::logger::Logger as _;
use crate::state::AppState;
use tauri::State;

/// Keychain account key for the AI API token.
/// `keychain::account_for` wraps this as `mongomacapp.ai_api_token` internally,
/// consistent with how connection passwords are keyed.
const AI_TOKEN_KEY: &str = "ai_api_token";

#[tauri::command]
pub fn set_ai_token(state: State<'_, AppState>, token: String) -> Result<(), String> {
    let log = state.logger.child(logctx! { "logger" => "commands.ai" });
    log.info("set_ai_token", logctx! {});
    keychain::set_password(AI_TOKEN_KEY, &token, log.as_ref())
}

#[tauri::command]
pub fn get_ai_token(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let log = state.logger.child(logctx! { "logger" => "commands.ai" });
    log.info("get_ai_token", logctx! {});
    keychain::get_password(AI_TOKEN_KEY, log.as_ref())
}

#[tauri::command]
pub fn delete_ai_token(state: State<'_, AppState>) -> Result<(), String> {
    let log = state.logger.child(logctx! { "logger" => "commands.ai" });
    log.info("delete_ai_token", logctx! {});
    keychain::delete_password(AI_TOKEN_KEY, log.as_ref())
}
