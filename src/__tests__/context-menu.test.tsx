import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextMenu } from '../components/ui/ContextMenu';

const items = [
  { label: 'Copy Value', shortcutHint: '⌘C', action: vi.fn() },
  { label: 'Copy Document', shortcutHint: '⇧⌘C', action: vi.fn() },
];

describe('ContextMenu', () => {
  it('renders all item labels', () => {
    render(<ContextMenu x={100} y={200} items={items} onClose={vi.fn()} />);
    expect(screen.getByText('Copy Value')).toBeInTheDocument();
    expect(screen.getByText('Copy Document')).toBeInTheDocument();
  });

  it('renders shortcut hints', () => {
    render(<ContextMenu x={100} y={200} items={items} onClose={vi.fn()} />);
    expect(screen.getByText('⌘C')).toBeInTheDocument();
  });

  it('calls action and onClose when item clicked', async () => {
    const onClose = vi.fn();
    const action = vi.fn();
    const user = userEvent.setup();
    render(
      <ContextMenu x={100} y={200} items={[{ label: 'Copy Value', action }]} onClose={onClose} />
    );
    await user.click(screen.getByText('Copy Value'));
    expect(action).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose on Escape key', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu x={100} y={200} items={items} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not render disabled items as clickable', async () => {
    const action = vi.fn();
    const user = userEvent.setup();
    render(
      <ContextMenu
        x={100} y={200}
        items={[{ label: 'Copy Value', action, disabled: true }]}
        onClose={vi.fn()}
      />
    );
    await user.click(screen.getByText('Copy Value'));
    expect(action).not.toHaveBeenCalled();
  });
});
