import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { LoggerProvider, useLogger, createLogger } from '../services/logger';
import { NoopLogger } from '../services/logger/NoopLogger';
import { MemoryLogger } from '../services/logger/MemoryLogger';

describe('createLogger', () => {
  it('returns NoopLogger when env=test', () => {
    const l = createLogger({ env: 'test', level: 'info', invoke: vi.fn() });
    expect(l).toBeInstanceOf(NoopLogger);
  });

  it('returns ConsoleLogger when env=dev and no Tauri', () => {
    const l = createLogger({ env: 'dev', level: 'debug', invoke: null });
    expect(l.constructor.name).toBe('ConsoleLogger');
  });

  it('returns IpcLogger when env=prod and invoke provided', () => {
    const l = createLogger({ env: 'prod', level: 'info', invoke: vi.fn() });
    expect(l.constructor.name).toBe('IpcLogger');
  });
});

describe('useLogger', () => {
  it('returns a child of the provided logger named by argument', () => {
    const root = new MemoryLogger('root');
    let captured: ReturnType<typeof useLogger> | null = null;
    function Probe() {
      captured = useLogger('components.Foo');
      return null;
    }
    render(
      <LoggerProvider value={root}>
        <Probe />
      </LoggerProvider>,
    );
    captured!.info('hello', { x: 1 });
    expect(root.records).toHaveLength(1);
    expect(root.records[0].logger).toBe('root');
    expect(root.records[0].ctx).toMatchObject({ logger: 'components.Foo', x: 1 });
  });

  it('falls back to NoopLogger when no provider present', () => {
    let captured: ReturnType<typeof useLogger> | null = null;
    function Probe() {
      captured = useLogger('x');
      return null;
    }
    render(<Probe />);
    expect(() => captured!.info('no-op')).not.toThrow();
  });

  it('returns a stable reference across renders (memoized on root + name)', () => {
    // Regression for review B-2: a fresh child per render makes useLogger
    // unsafe to put in effect dep arrays — every render re-runs the effect.
    const root = new MemoryLogger('root');
    const seen: ReturnType<typeof useLogger>[] = [];
    let bumpCounter: () => void = () => {};
    function Probe() {
      const [, setN] = useState(0);
      bumpCounter = () => setN((n) => n + 1);
      seen.push(useLogger('components.Stable'));
      return null;
    }
    render(
      <LoggerProvider value={root}>
        <Probe />
      </LoggerProvider>,
    );
    act(() => bumpCounter());
    act(() => bumpCounter());
    expect(seen.length).toBeGreaterThanOrEqual(3);
    // All references should be identical — memoized on (root, name).
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBe(seen[0]);
    }
  });
});
