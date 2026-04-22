use crate::keychain;

/// Keychain account key for the AI API token.
/// `keychain::account_for` wraps this as `mongomacapp.ai_api_token` internally,
/// consistent with how connection passwords are keyed.
const AI_TOKEN_KEY: &str = "ai_api_token";

#[tauri::command]
pub fn set_ai_token(token: String) -> Result<(), String> {
    keychain::set_password(AI_TOKEN_KEY, &token)
}

#[tauri::command]
pub fn get_ai_token() -> Result<Option<String>, String> {
    keychain::get_password(AI_TOKEN_KEY)
}

#[tauri::command]
pub fn delete_ai_token() -> Result<(), String> {
    keychain::delete_password(AI_TOKEN_KEY)
}
