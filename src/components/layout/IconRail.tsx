export type PanelKey = 'connections' | 'collections' | 'saved' | 'settings';

interface Props {
  active: PanelKey;
  onChange: (p: PanelKey) => void;
}

const items: { key: PanelKey; label: string; icon: string }[] = [
  { key: 'connections', label: 'Connections', icon: '⚡' },
  { key: 'collections', label: 'Collections', icon: '🗂' },
  { key: 'saved', label: 'Saved Scripts', icon: '⭐' },
  { key: 'settings', label: 'Settings', icon: '⚙' },
];

export function IconRail({ active, onChange }: Props) {
  return (
    <div
      style={{
        width: 44,
        background: 'var(--bg-rail)',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--border)',
      }}
    >
      {items.map((it) => (
        <button
          key={it.key}
          aria-label={it.label}
          onClick={() => onChange(it.key)}
          style={{
            height: 44,
            border: 'none',
            borderLeft:
              active === it.key ? '2px solid var(--accent)' : '2px solid transparent',
            background: 'transparent',
            color: active === it.key ? 'var(--fg)' : 'var(--fg-dim)',
            fontSize: 18,
            cursor: 'pointer',
          }}
        >
          {it.icon}
        </button>
      ))}
    </div>
  );
}
