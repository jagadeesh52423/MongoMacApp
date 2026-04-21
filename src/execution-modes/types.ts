export interface ExecutionContext {
  content: string;
  cursorLine: number;
  selection: string | null;
}

export interface ExecutionMode {
  readonly id: string;
  readonly label: string;
  readonly keybind?: (monaco: typeof import('monaco-editor')) => number;
  readonly buttonStyle: 'outline' | 'filled';
  resolveContent(ctx: ExecutionContext): string | null;
  // implement this interface to add a new execution mode
}
