import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionPanel } from '../components/connections/ConnectionPanel';
import { useConnectionsStore } from '../store/connections';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  useConnectionsStore.setState({
    connections: [], activeConnectionId: null, activeDatabase: null, connectedIds: new Set(),
  });
});

describe('ConnectionPanel', () => {
  it('loads connections on mount', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'local', host: 'localhost', port: 27017, createdAt: 't' },
    ]);
    render(<ConnectionPanel />);
    await waitFor(() => expect(screen.getByText('local')).toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith('list_connections');
  });

  it('opens the add dialog', async () => {
    invokeMock.mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<ConnectionPanel />);
    await user.click(screen.getByText('+ Add'));
    expect(screen.getByText('New Connection')).toBeInTheDocument();
  });
});
