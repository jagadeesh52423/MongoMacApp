import { useEffect, useMemo, useState } from 'react';
import { listScripts, deleteScript, createScript } from '../../ipc';
import { useEditorStore } from '../../store/editor';
import type { SavedScript, EditorTab } from '../../types';
import { SaveScriptDialog } from './SaveScriptDialog';

export function SavedScriptsPanel() {
  const [scripts, setScripts] = useState<SavedScript[]>([]);
  const [query, setQuery] = useState('');
  const { openTab, tabs, activeTabId } = useEditorStore();
  const [saving, setSaving] = useState(false);

  async function reload() {
    setScripts(await listScripts());
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scripts;
    return scripts.filter(
      (s) => s.name.toLowerCase().includes(q) || s.tags.toLowerCase().includes(q),
    );
  }, [scripts, query]);

  function open(s: SavedScript) {
    const tab: EditorTab = {
      id: `script:${s.id}`,
      title: s.name,
      content: s.content,
      isDirty: false,
      type: 'script',
    };
    openTab(tab);
  }

  async function handleDelete(s: SavedScript) {
    if (!confirm(`Delete script "${s.name}"?`)) return;
    await deleteScript(s.id);
    reload();
  }

  async function handleSaveCurrent(name: string, tags: string) {
    const active = tabs.find((t) => t.id === activeTabId);
    if (!active || active.type !== 'script') {
      throw new Error('Open a script tab first');
    }
    await createScript(name, active.content, tags);
    setSaving(false);
    reload();
  }

  return (
    <div>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)', display: 'flex', gap: 6 }}>
        <input
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <button onClick={() => setSaving(true)}>+ Save</button>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {filtered.map((s) => (
          <li
            key={s.id}
            style={{
              padding: '6px 10px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => open(s)}>
              {s.name}
              {s.tags && (
                <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--fg-dim)' }}>
                  {s.tags}
                </span>
              )}
            </span>
            <button onClick={() => handleDelete(s)}>Delete</button>
          </li>
        ))}
      </ul>
      {saving && (
        <SaveScriptDialog
          onSave={handleSaveCurrent}
          onCancel={() => setSaving(false)}
        />
      )}
    </div>
  );
}
