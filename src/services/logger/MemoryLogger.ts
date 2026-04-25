// MemoryLogger — test adapter that accumulates LogRecords in-memory.
//
// Children share the root's `records` array so a test can assert on the full
// record stream without walking a tree. Each write passes its merged ctx
// through `redactCtx`, matching the redaction behaviour of the runtime
// adapters (Console/Ipc) so tests catch redaction regressions.
//
// Logging must NEVER throw at the call site (review M-1). The `write` body
// is wrapped in try/catch; on first failure we emit a single `console.warn`
// and silently drop subsequent failing records.

import type { Logger, LogCtx, LogLevel, LogRecord } from './types';
import { redactCtx } from './redact';

export class MemoryLogger implements Logger {
  public readonly records: LogRecord[] = [];
  private static warned = false;

  /** Test-only helper. Clears module-level static state between test cases. */
  public static resetForTests(): void {
    MemoryLogger.warned = false;
  }

  constructor(
    private readonly loggerName: string,
    private readonly bindings: LogCtx = {},
    private readonly parent?: MemoryLogger,
  ) {}

  private write(level: LogLevel, msg: string, ctx: LogCtx = {}): void {
    try {
      const merged = redactCtx({ ...this.bindings, ...ctx });
      const record: LogRecord = {
        ts: Date.now(),
        level,
        logger: this.loggerName,
        runId: typeof merged.runId === 'string' ? merged.runId : undefined,
        msg,
        ctx: merged,
      };
      // Root owns the records array; children forward to root.
      (this.parent ?? this).records.push(record);
    } catch (err) {
      if (!MemoryLogger.warned) {
        MemoryLogger.warned = true;
        // eslint-disable-next-line no-console
        console.warn(
          '[MemoryLogger] write failed; subsequent failing records will be dropped silently.',
          err,
        );
      }
    }
  }

  error(msg: string, ctx?: LogCtx) {
    this.write('error', msg, ctx);
  }
  warn(msg: string, ctx?: LogCtx) {
    this.write('warn', msg, ctx);
  }
  info(msg: string, ctx?: LogCtx) {
    this.write('info', msg, ctx);
  }
  debug(msg: string, ctx?: LogCtx) {
    this.write('debug', msg, ctx);
  }

  child(bindings: LogCtx): Logger {
    return new MemoryLogger(
      this.loggerName,
      { ...this.bindings, ...bindings },
      this.parent ?? this,
    );
  }
}
