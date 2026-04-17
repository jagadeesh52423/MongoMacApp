import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';

describe('App shell', () => {
  it('renders icon rail with four buttons', () => {
    render(<App />);
    expect(screen.getByLabelText('Connections')).toBeInTheDocument();
    expect(screen.getByLabelText('Collections')).toBeInTheDocument();
    expect(screen.getByLabelText('Saved Scripts')).toBeInTheDocument();
    expect(screen.getByLabelText('Settings')).toBeInTheDocument();
  });

  it('toggles side panel when icon clicked', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByLabelText('Saved Scripts'));
    expect(screen.getByTestId('side-panel-title')).toHaveTextContent('Saved Scripts');
  });
});
