import { useEffect, useState } from 'react';
import { listDatabases, listCollections } from '../../ipc';
import type { CollectionNode } from '../../types';

interface Props {
  connectionId: string;
  onOpenCollection: (database: string, collection: string) => void;
}

export function ConnectionTree({ connectionId, onOpenCollection }: Props) {
  const [dbs, setDbs] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collections, setCollections] = useState<Record<string, CollectionNode[]>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listDatabases(connectionId)
      .then(setDbs)
      .catch((e) => setErr((e as Error).message ?? String(e)));
  }, [connectionId]);

  async function toggle(db: string) {
    const isOpen = expanded[db];
    setExpanded((s) => ({ ...s, [db]: !isOpen }));
    if (!isOpen && !collections[db]) {
      try {
        const list = await listCollections(connectionId, db);
        setCollections((s) => ({ ...s, [db]: list }));
      } catch (e) {
        setErr((e as Error).message ?? String(e));
      }
    }
  }

  return (
    <div style={{ padding: 4 }}>
      {err && <div style={{ color: 'var(--accent-red)', padding: 6 }}>{err}</div>}
      {dbs.map((db) => (
        <div key={db}>
          <div
            onClick={() => toggle(db)}
            style={{
              padding: '4px 6px',
              cursor: 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>{expanded[db] ? '▼' : '▶'}</span>
            <span>{db}</span>
          </div>
          {expanded[db] && collections[db] && (
            <div style={{ paddingLeft: 18 }}>
              {collections[db].map((c) => (
                <div
                  key={c.name}
                  onClick={() => onOpenCollection(db, c.name)}
                  style={{
                    padding: '3px 6px',
                    cursor: 'pointer',
                    color: 'var(--fg-dim)',
                  }}
                >
                  {c.name}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
