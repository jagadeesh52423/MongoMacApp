use crate::logctx;
use crate::logger::Logger as _;
use crate::mongo;
use crate::state::AppState;
use mongodb::bson::{doc, oid::ObjectId, Document};
use tauri::State;

fn id_filter(id: &str) -> Document {
    match ObjectId::parse_str(id) {
        // Hex string could be stored as ObjectId or as a plain string — match either.
        Ok(oid) => doc! { "$or": [{ "_id": oid }, { "_id": id }] },
        Err(_) => doc! { "_id": id },
    }
}

#[tauri::command]
pub async fn update_document(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    id: String,
    update_json: String,
) -> Result<(), String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.document",
        "connId" => connection_id.clone(),
        "db" => database.clone(),
        "coll" => collection.clone(),
        "docId" => id.clone(),
    });
    log.info("update_document", logctx! {});
    let client = mongo::active_client(&state, &connection_id)?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let value: serde_json::Value = serde_json::from_str(&update_json).map_err(|e| {
        log.error("invalid update JSON", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    let bson_value = mongodb::bson::to_bson(&value).map_err(|e| {
        log.error("bson conversion failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    let mut updated: Document = match bson_value {
        mongodb::bson::Bson::Document(d) => d,
        _ => {
            log.error("updateJson not an object", logctx! {});
            return Err("updateJson must be a JSON object".into());
        }
    };
    updated.remove("_id");
    let result = coll.update_one(id_filter(&id), doc! { "$set": updated })
        .await
        .map_err(|e| {
            log.error("update_one failed", logctx! { "err" => e.to_string() });
            e.to_string()
        })?;
    if result.matched_count == 0 {
        log.warn("document not found", logctx! {});
        return Err(format!("Document not found (id={})", id));
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_document(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    id: String,
) -> Result<(), String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.document",
        "connId" => connection_id.clone(),
        "db" => database.clone(),
        "coll" => collection.clone(),
        "docId" => id.clone(),
    });
    log.info("delete_document", logctx! {});
    let client = mongo::active_client(&state, &connection_id)?;
    let coll = client.database(&database).collection::<Document>(&collection);
    coll.delete_one(id_filter(&id))
        .await
        .map_err(|e| {
            log.error("delete_one failed", logctx! { "err" => e.to_string() });
            e.to_string()
        })?;
    Ok(())
}
