import { useEffect, useState } from 'react';
import {
  listConnections,
  createConnection,
  updateConnection as ipcUpdate,
  deleteConnection as ipcDelete,
  testConnection,
  connectConnection,
  disconnectConnection,
} from '../../ipc';
import { useConnectionsStore } from '../../store/connections';
import { useEditorStore } from '../../store/editor';
import { ConnectionDialog } from './ConnectionDialog';
import { ConnectionTree } from './ConnectionTree';
import type { Connection, ConnectionInput } from '../../types';

export function ConnectionPanel() {
  const {
    connections,
    connectedIds,
    activeConnectionId,
    setConnections,
    addConnection,
    updateConnection,
    removeConnection,
    setActive,
    markConnected,
    markDisconnected,
  } = useConnectionsStore();
  const [editing, setEditing] = useState<Connection | null>(null);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<Record<string, string>>({});
  const openTab = useEditorStore((s) => s.openTab);

  function openCollectionScriptTab(db: string, col: string, cId: string) {
    openTab({
      id: `script:${cId}:${db}:${col}:${Date.now()}`,
      title: col,
      content: `db.getCollection("${col}").find({})`,
      isDirty: false,
      type: 'script',
      connectionId: cId,
      database: db,
    });
  }

  useEffect(() => {
    listConnections().then(setConnections).catch((e) => console.error(e));
  }, [setConnections]);

  async function handleSave(input: ConnectionInput) {
    if (editing) {
      const updated = await ipcUpdate(editing.id, input);
      updateConnection(updated);
    } else {
      const c = await createConnection(input);
      addConnection(c);
    }
    setEditing(null);
    setCreating(false);
  }

  async function handleDelete(c: Connection) {
    if (!confirm(`Delete connection "${c.name}"?`)) return;
    await ipcDelete(c.id);
    removeConnection(c.id);
  }

  async function handleTest(c: Connection) {
    setStatus((s) => ({ ...s, [c.id]: 'Testing…' }));
    const r = await testConnection(c.id);
    setStatus((s) => ({ ...s, [c.id]: r.ok ? 'OK' : `Error: ${r.error ?? 'unknown'}` }));
  }

  async function handleConnect(c: Connection) {
    try {
      await connectConnection(c.id);
      markConnected(c.id);
      setActive(c.id, null);
    } catch (e) {
      setStatus((s) => ({ ...s, [c.id]: `Error: ${(e as Error).message}` }));
    }
  }

  async function handleDisconnect(c: Connection) {
    await disconnectConnection(c.id);
    markDisconnected(c.id);
    if (activeConnectionId === c.id) setActive(null, null);
  }

  return (
    <div>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => setCreating(true)}>+ Add</button>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {connections.map((c) => {
          const connected = connectedIds.has(c.id);
          return (
            <li
              key={c.id}
              style={{
                padding: '6px 10px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: connected ? 'var(--accent-green)' : 'var(--fg-dim)' }}>●</span>
                <span style={{ flex: 1 }}>{c.name}</span>
                {connected ? (
                  <button onClick={() => handleDisconnect(c)}>Disconnect</button>
                ) : (
                  <button onClick={() => handleConnect(c)}>Connect</button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
                <button onClick={() => handleTest(c)}>Test</button>
                <button onClick={() => setEditing(c)}>Edit</button>
                <button onClick={() => handleDelete(c)}>Delete</button>
              </div>
              {status[c.id] && (
                <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>{status[c.id]}</div>
              )}
              {connected && (
                <ConnectionTree
                  connectionId={c.id}
                  onOpenCollection={(db, col) => openCollectionScriptTab(db, col, c.id)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {(creating || editing) && (
        <ConnectionDialog
          initial={editing ?? undefined}
          onSave={handleSave}
          onCancel={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
