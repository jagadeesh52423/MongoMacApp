// ConsoleLogger — dev/webview adapter that routes to `console.{error,warn,info,debug}`.
//
// Used when running in the browser without Tauri (`createLogger({env:'dev', invoke:null})`)
// and for local development. Honours a `threshold` so `debug` calls can be
// suppressed in noisier environments. Redacts ctx on every write.

import type { Logger, LogCtx, LogLevel } from './types';
import { levelEnabled } from './types';
import { redactCtx } from './redact';

export class ConsoleLogger implements Logger {
  constructor(
    private readonly name: string,
    private readonly threshold: LogLevel,
    private readonly bindings: LogCtx = {},
  ) {}

  private emit(level: LogLevel, msg: string, ctx: LogCtx = {}): void {
    if (!levelEnabled(level, this.threshold)) return;
    const merged = redactCtx({ ...this.bindings, ...ctx });
    const prefix = `[${this.name}]`;
    // eslint-disable-next-line no-console
    (console[level] as (...args: unknown[]) => void)(prefix, msg, merged);
  }

  error(msg: string, ctx?: LogCtx) {
    this.emit('error', msg, ctx);
  }
  warn(msg: string, ctx?: LogCtx) {
    this.emit('warn', msg, ctx);
  }
  info(msg: string, ctx?: LogCtx) {
    this.emit('info', msg, ctx);
  }
  debug(msg: string, ctx?: LogCtx) {
    this.emit('debug', msg, ctx);
  }

  child(bindings: LogCtx): Logger {
    return new ConsoleLogger(this.name, this.threshold, { ...this.bindings, ...bindings });
  }
}
