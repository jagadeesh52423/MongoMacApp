import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { SavedScriptsPanel } from '../components/saved-scripts/SavedScriptsPanel';
import { useEditorStore } from '../store/editor';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  useEditorStore.setState({ tabs: [], activeTabId: null });
});

describe('SavedScriptsPanel', () => {
  it('loads and opens a script into a tab', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: 's1', name: 'find users', content: 'db.users.find({})', tags: 'users', createdAt: 't' },
    ]);
    const user = userEvent.setup();
    render(<SavedScriptsPanel />);
    await waitFor(() => expect(screen.getByText('find users')).toBeInTheDocument());
    await user.click(screen.getByText('find users'));
    expect(useEditorStore.getState().tabs[0].content).toBe('db.users.find({})');
  });

  it('filters by search query', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'alpha', content: '', tags: '', createdAt: 't' },
      { id: '2', name: 'beta', content: '', tags: '', createdAt: 't' },
    ]);
    const user = userEvent.setup();
    render(<SavedScriptsPanel />);
    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Search…'), 'bet');
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });
});
