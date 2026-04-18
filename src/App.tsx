import { useState, useEffect } from 'react';
import { IconRail, type PanelKey } from './components/layout/IconRail';
import { SidePanel } from './components/layout/SidePanel';
import { StatusBar } from './components/layout/StatusBar';
import { ConnectionPanel } from './components/connections/ConnectionPanel';
import { EditorArea } from './components/editor/EditorArea';
import { SavedScriptsPanel } from './components/saved-scripts/SavedScriptsPanel';
import { useConnectionsStore } from './store/connections';
import { useScriptEvents } from './hooks/useScriptEvents';
import { checkNodeRunner, installNodeRunner } from './ipc';

export default function App() {
  useScriptEvents();

  useEffect(() => {
    checkNodeRunner().then((status) => {
      console.log('[runner] check:', status);
      if (!status.ready) {
        console.log('[runner] not ready, installing...');
        installNodeRunner()
          .then(() => console.log('[runner] install complete'))
          .catch((e) => console.error('[runner] install failed:', e));
      }
    }).catch((e) => console.error('[runner] check failed:', e));
  }, []);
  const [panel, setPanel] = useState<PanelKey>('connections');
  const { connections, activeConnectionId, activeDatabase } = useConnectionsStore();
  const active = connections.find((c) => c.id === activeConnectionId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <IconRail active={panel} onChange={setPanel} />
        <SidePanel active={panel}>
          {panel === 'connections' && <ConnectionPanel />}
          {panel === 'saved' && <SavedScriptsPanel />}
          {panel === 'collections' && (
            <div style={{ padding: 12, color: 'var(--fg-dim)' }}>Connect to a server to view collections.</div>
          )}
          {panel === 'settings' && (
            <div style={{ padding: 12, color: 'var(--fg-dim)' }}>Settings — coming soon.</div>
          )}
        </SidePanel>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <EditorArea />
        </div>
      </div>
      <StatusBar
        connectionName={active?.name}
        database={activeDatabase ?? undefined}
        nodeStatus="Node.js ready"
      />
    </div>
  );
}
