import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
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
});
