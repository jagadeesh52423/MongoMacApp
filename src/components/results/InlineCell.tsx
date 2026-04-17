import { useState } from 'react';

interface Props {
  value: string;
  onSave: (newValue: string) => void;
}

export function InlineCell({ value, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <span onDoubleClick={() => { setDraft(value); setEditing(true); }} style={{ cursor: 'text' }}>
        {value}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        style={{ width: 140 }}
      />
      <button onClick={() => { onSave(draft); setEditing(false); }}>Save</button>
      <button onClick={() => setEditing(false)}>Cancel</button>
    </span>
  );
}
