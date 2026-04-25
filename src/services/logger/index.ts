// Public logger entrypoint.
//
// This is the only module call sites should import from. It exposes:
//   - Adapter classes (NoopLogger, MemoryLogger, ConsoleLogger, IpcLogger)
//   - Type re-exports (Logger, LogCtx, LogLevel, LogRecord)
//   - createLogger(): factory used by the composition root (main.tsx)
//   - LoggerProvider / useLogger(): React-tree access to the root logger
//
// To add a new adapter: implement Logger, export it from here, and add a
// branch to `createLogger` keyed on env/capability. Nothing else changes.

import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import type { Logger, LogLevel } from './types';
import { NoopLogger } from './NoopLogger';
import { ConsoleLogger } from './ConsoleLogger';
import { IpcLogger, type InvokeFn } from './IpcLogger';

export type { Logger, LogCtx, LogLevel, LogRecord } from './types';
export { NoopLogger } from './NoopLogger';
export { MemoryLogger } from './MemoryLogger';
export { ConsoleLogger } from './ConsoleLogger';
export { IpcLogger } from './IpcLogger';
export type { InvokeFn } from './IpcLogger';

export interface CreateLoggerOpts {
  env: 'dev' | 'prod' | 'test';
  level: LogLevel;
  invoke: InvokeFn | null;
}

export function createLogger(opts: CreateLoggerOpts): Logger {
  if (opts.env === 'test') return new NoopLogger();
  if (opts.env === 'dev' || !opts.invoke) return new ConsoleLogger('app', opts.level);
  return new IpcLogger('app', opts.level, opts.invoke);
}

const LoggerContext = createContext<Logger>(new NoopLogger());

export function LoggerProvider({ value, children }: { value: Logger; children: ReactNode }) {
  return createElement(LoggerContext.Provider, { value }, children);
}

/**
 * Returns a child logger bound to `name` (added as ctx.logger).
 *
 * The result is memoized on `(root, name)` so the reference is stable across
 * renders. This matters because callers commonly include the logger in
 * `useEffect` / `useCallback` dependency arrays — without memoization, a
 * fresh child every render would re-run effects (e.g., re-subscribing to
 * Tauri events in `useScriptEvents`). See review finding B-2.
 */
export function useLogger(name: string): Logger {
  const root = useContext(LoggerContext);
  return useMemo(() => root.child({ logger: name }), [root, name]);
}
