import { useMemo, useState } from 'react';
import { InlineCell } from './InlineCell';
import { renderCell, cellEditString } from './cellRenderers';

interface Props {
  docs: unknown[];
  onEditCell?: (rowIdx: number, key: string, newValue: string) => void;
  onDelete?: (rowIdx: number) => void;
}

function columnsOf(docs: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of docs) {
    if (d && typeof d === 'object') {
      for (const k of Object.keys(d as Record<string, unknown>)) {
        if (!seen.has(k)) {
          seen.add(k);
          out.push(k);
        }
      }
    }
  }
  return out;
}

export function TableView({ docs, onEditCell, onDelete }: Props) {
  const columns = useMemo(() => columnsOf(docs), [docs]);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const sorted = useMemo(() => {
    if (!sortKey) return docs;
    const arr = [...docs];
    arr.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey] as unknown;
      const bv = (b as Record<string, unknown>)[sortKey] as unknown;
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      return String(av) < String(bv) ? -sortDir : sortDir;
    });
    return arr;
  }, [docs, sortKey, sortDir]);

  return (
    <div style={{ overflow: 'auto', flex: 1 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                onClick={() => {
                  if (sortKey === c) setSortDir((d) => (d === 1 ? -1 : 1));
                  else {
                    setSortKey(c);
                    setSortDir(1);
                  }
                }}
                style={{
                  borderBottom: '1px solid var(--border)',
                  padding: '4px 8px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  background: 'var(--bg-panel)',
                  position: 'sticky',
                  top: 0,
                }}
              >
                {c} {sortKey === c ? (sortDir === 1 ? '↑' : '↓') : ''}
              </th>
            ))}
            {onDelete && <th />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const raw = (d as Record<string, unknown>)[c];
                return (
                  <td
                    key={c}
                    style={{ borderBottom: '1px solid var(--border)', padding: '4px 8px' }}
                  >
                    {onEditCell ? (
                      <InlineCell
                        value={cellEditString(raw)}
                        onSave={(next) => {
                          const cur = cellEditString(raw);
                          if (next !== cur) onEditCell(i, c, next);
                        }}
                      />
                    ) : (
                      renderCell(raw)
                    )}
                  </td>
                );
              })}
              {onDelete && (
                <td style={{ borderBottom: '1px solid var(--border)', padding: '4px 8px' }}>
                  <button onClick={() => onDelete(i)} title="Delete row">🗑</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
