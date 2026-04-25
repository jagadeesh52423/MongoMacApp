import { invoke } from '@tauri-apps/api/core';
import type {
  Connection,
  ConnectionInput,
  SavedScript,
  CollectionNode,
  IndexInfo,
} from './types';

export async function listConnections(): Promise<Connection[]> {
  return invoke('list_connections');
}

export async function createConnection(input: ConnectionInput): Promise<Connection> {
  return invoke('create_connection', { input });
}

export async function updateConnection(id: string, input: ConnectionInput): Promise<Connection> {
  return invoke('update_connection', { id, input });
}

export async function deleteConnection(id: string): Promise<void> {
  return invoke('delete_connection', { id });
}

export async function testConnection(id: string): Promise<{ ok: boolean; error?: string }> {
  return invoke('test_connection', { id });
}

export async function connectConnection(id: string): Promise<void> {
  return invoke('connect_connection', { id });
}

export async function disconnectConnection(id: string): Promise<void> {
  return invoke('disconnect_connection', { id });
}

export async function listDatabases(connectionId: string): Promise<string[]> {
  return invoke('list_databases', { connectionId });
}

export async function listCollections(connectionId: string, database: string): Promise<CollectionNode[]> {
  return invoke('list_collections', { connectionId, database });
}

export async function listIndexes(
  connectionId: string,
  database: string,
  collection: string,
): Promise<IndexInfo[]> {
  return invoke('list_indexes', { connectionId, database, collection });
}

export async function updateDocument(
  connectionId: string,
  database: string,
  collection: string,
  id: string,
  updateJson: string,
): Promise<void> {
  return invoke('update_document', { connectionId, database, collection, id, updateJson });
}

export async function deleteDocument(
  connectionId: string,
  database: string,
  collection: string,
  id: string,
): Promise<void> {
  return invoke('delete_document', { connectionId, database, collection, id });
}

export async function runScript(
  tabId: string,
  connectionId: string,
  database: string,
  script: string,
  page = 0,
  pageSize = 50,
  runId?: string,
): Promise<void> {
  return invoke('run_script', { tabId, connectionId, database, script, page, pageSize, runId });
}

export async function cancelScript(tabId: string): Promise<void> {
  return invoke('cancel_script', { tabId });
}

export async function listScripts(): Promise<SavedScript[]> {
  return invoke('list_scripts');
}

export async function createScript(
  name: string,
  content: string,
  tags: string,
  connectionId?: string,
): Promise<SavedScript> {
  return invoke('create_script', { name, content, tags, connectionId });
}

export async function updateScript(
  id: string,
  name: string,
  content: string,
  tags: string,
  connectionId?: string,
): Promise<SavedScript> {
  return invoke('update_script', { id, name, content, tags, connectionId });
}

export async function deleteScript(id: string): Promise<void> {
  return invoke('delete_script', { id });
}

export async function touchScript(id: string): Promise<void> {
  return invoke('touch_script', { id });
}

export async function checkNodeRunner(): Promise<{ ready: boolean; nodeVersion?: string; message?: string }> {
  return invoke('check_node_runner');
}

export async function installNodeRunner(): Promise<void> {
  return invoke('install_node_runner');
}

// --- AI token (stored in OS keychain via Rust command) ---

export async function setAiToken(token: string): Promise<void> {
  return invoke('set_ai_token', { token });
}

export async function getAiToken(): Promise<string | null> {
  // Rust returns Option<String> → serialized as string | null
  return invoke('get_ai_token');
}

export async function deleteAiToken(): Promise<void> {
  return invoke('delete_ai_token');
}
