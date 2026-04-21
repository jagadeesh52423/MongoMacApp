import { ExecutionMode } from './types';

const _modes: ExecutionMode[] = [];

export function registerExecutionMode(mode: ExecutionMode): void {
  _modes.push(mode);
}

export function getExecutionModes(): readonly ExecutionMode[] {
  return _modes;
}

export function getExecutionMode(id: string): ExecutionMode | undefined {
  return _modes.find(m => m.id === id);
}
