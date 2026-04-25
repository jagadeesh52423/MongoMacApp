import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsoleLogger } from '../services/logger/ConsoleLogger';

describe('ConsoleLogger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('emits error/warn/info/debug at level=debug', () => {
    const log = new ConsoleLogger('root', 'debug');
    log.error('a');
    log.warn('b');
    log.info('c');
    log.debug('d');
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(console.debug).toHaveBeenCalledTimes(1);
  });

  it('suppresses debug at level=info', () => {
    const log = new ConsoleLogger('root', 'info');
    log.debug('hidden');
    log.info('shown');
    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledTimes(1);
  });

  it('suppresses info+debug at level=warn', () => {
    const log = new ConsoleLogger('root', 'warn');
    log.debug('x');
    log.info('x');
    log.warn('y');
    log.error('z');
    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('child merges bindings and preserves level', () => {
    const log = new ConsoleLogger('root', 'info').child({ runId: 'r1' });
    log.info('go', { extra: 2 });
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('[root]'),
      expect.any(String),
      expect.objectContaining({ runId: 'r1', extra: 2 }),
    );
  });

  // Verification of team-lead's M-1 note: ConsoleLogger doesn't call
  // JSON.stringify, but it does call redactCtx({...ctx}) which walks ctx via
  // Object.entries — a property accessor that throws would propagate out of
  // emit(). Logging must never throw at the call site. (Review M-1.)
  it('does not throw if ctx contains a property accessor that throws (M-1)', () => {
    const log = new ConsoleLogger('root', 'debug');
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'boom', {
      enumerable: true,
      get() {
        throw new Error('property accessor failure');
      },
    });
    expect(() => log.info('hostile', hostile)).not.toThrow();
  });
});
