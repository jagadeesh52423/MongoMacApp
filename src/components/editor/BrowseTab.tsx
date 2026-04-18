import { useCallback, useEffect, useState } from 'react';
import { browseCollection, updateDocument, deleteDocument } from '../../ipc';
import type { BrowsePage } from '../../types';
import { TableView } from '../results/TableView';
import { RecordModal } from '../results/RecordModal';
import { CellSelectionProvider } from '../../contexts/CellSelectionContext';
import { useCellShortcuts } from '../../hooks/useCellShortcuts';
import { keyboardService } from '../../services/KeyboardService';

interface Props {
  connectionId: string;
  database: string;
  collection: string;
}

const PAGE_SIZE = 20;

function CellShortcutsRegistrar({
  onViewRecord,
  onEditRecord,
}: {
  onViewRecord: (doc: Record<string, unknown>) => void;
  onEditRecord: (doc: Record<string, unknown>) => void;
}) {
  useCellShortcuts(keyboardService, { onViewRecord, onEditRecord });
  return null;
}

export function BrowseTab({ connectionId, database, collection }: Props) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<BrowsePage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [recordModal, setRecordModal] = useState<{
    doc: Record<string, unknown>;
    mode: 'view' | 'edit';
  } | null>(null);

  const load = useCallback(() => {
    setErr(null);
    browseCollection(connectionId, database, collection, page, PAGE_SIZE)
      .then(setData)
      .catch((e) => setErr((e as Error).message ?? String(e)));
  }, [connectionId, database, collection, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleEditCell(rowIdx: number, key: string, newValue: string) {
    if (!data) return;
    const doc = data.docs[rowIdx] as Record<string, unknown>;
    const id = String(doc._id);
    const updated = { ...doc, [key]: tryParse(newValue) };
    try {
      await updateDocument(connectionId, database, collection, id, JSON.stringify(updated));
      load();
    } catch (e) {
      setErr((e as Error).message ?? String(e));
    }
  }

  async function handleDelete(rowIdx: number) {
    if (!data) return;
    const doc = data.docs[rowIdx] as Record<string, unknown>;
    const id = String(doc._id);
    if (!confirm(`Delete document ${id}?`)) return;
    try {
      await deleteDocument(connectionId, database, collection, id);
      load();
    } catch (e) {
      setErr((e as Error).message ?? String(e));
    }
  }

  return (
    <CellSelectionProvider>
      <CellShortcutsRegistrar
        onViewRecord={(doc) => setRecordModal({ doc, mode: 'view' })}
        onEditRecord={(doc) => setRecordModal({ doc, mode: 'edit' })}
      />
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            padding: '6px 10px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <strong>{database}.{collection}</strong>
          <span style={{ color: 'var(--fg-dim)' }}>
            {data ? `${data.total} documents` : 'loading…'}
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              ← Prev
            </button>
            <span style={{ margin: '0 8px' }}>Page {page + 1}</span>
            <button
              disabled={!data || (page + 1) * PAGE_SIZE >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </span>
        </div>
        {err && <div style={{ color: 'var(--accent-red)', padding: 8 }}>{err}</div>}
        {data && (
          <TableView docs={data.docs} onEditCell={handleEditCell} onDelete={handleDelete} />
        )}
      </div>
      {recordModal && (
        <RecordModal
          doc={recordModal.doc}
          initialMode={recordModal.mode}
          connectionId={connectionId}
          database={database}
          collection={collection}
          onClose={() => setRecordModal(null)}
          onSaved={() => { setRecordModal(null); load(); }}
        />
      )}
    </CellSelectionProvider>
  );
}

function tryParse(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}
