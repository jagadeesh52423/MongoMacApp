import { useState } from 'react';
import { IconRail, type PanelKey } from './components/layout/IconRail';
import { SidePanel } from './components/layout/SidePanel';
import { StatusBar } from './components/layout/StatusBar';

export default function App() {
  const [panel, setPanel] = useState<PanelKey>('connections');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <IconRail active={panel} onChange={setPanel} />
        <SidePanel active={panel}>
          <div style={{ padding: 12, color: 'var(--fg-dim)' }}>Panel content</div>
        </SidePanel>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flex: 1, padding: 20, color: 'var(--fg-dim)' }}>
            Open a connection to get started.
          </div>
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
