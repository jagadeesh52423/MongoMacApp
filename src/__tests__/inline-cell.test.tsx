import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineCell } from '../components/results/InlineCell';

describe('InlineCell', () => {
  it('saves a new value', async () => {
    const save = vi.fn();
    const user = userEvent.setup();
    render(<InlineCell value="a" onSave={save} />);
    await user.dblClick(screen.getByText('a'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'b');
    await user.click(screen.getByText('Save'));
    expect(save).toHaveBeenCalledWith('b');
  });

  it('cancels without saving', async () => {
    const save = vi.fn();
    const user = userEvent.setup();
    render(<InlineCell value="a" onSave={save} />);
    await user.dblClick(screen.getByText('a'));
    await user.click(screen.getByText('Cancel'));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText('a')).toBeInTheDocument();
  });
});
