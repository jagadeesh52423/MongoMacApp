import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResultsPanel } from '../components/results/ResultsPanel';
import { useResultsStore } from '../store/results';

beforeEach(() => {
  useResultsStore.setState({ byTab: {} });
});

describe('ResultsPanel', () => {
  it('shows placeholder when no results for tab', () => {
    render(<ResultsPanel tabId="t1" />);
    expect(screen.getByText(/Run a script/i)).toBeInTheDocument();
  });

  it('renders JSON by default', () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{ groupIndex: 0, docs: [{ name: 'alice' }] }],
          isRunning: false,
          executionMs: 10,
        },
      },
    });
    render(<ResultsPanel tabId="t1" />);
    expect(screen.getByText(/alice/)).toBeInTheDocument();
  });

  it('switches to Table view', async () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{ groupIndex: 0, docs: [{ name: 'alice' }, { name: 'bob' }] }],
          isRunning: false,
          executionMs: 10,
        },
      },
    });
    const user = userEvent.setup();
    render(<ResultsPanel tabId="t1" />);
    await user.click(screen.getByText('Table'));
    expect(screen.getAllByRole('cell').some((c) => c.textContent === 'alice')).toBe(true);
  });
});
