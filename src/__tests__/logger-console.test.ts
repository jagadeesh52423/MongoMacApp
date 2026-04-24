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
});
