export interface Statement {
  startLine: number;
  endLine: number;
  text: string;
}

export function detectStatements(script: string): Statement[] {
  if (!script) return [];
  const normalized = script.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  const blocks: Statement[] = [];
  let current: { startLine: number; endLine: number; lines: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBlank = line.trim().length === 0;
    if (isBlank) {
      if (current) {
        blocks.push({
          startLine: current.startLine,
          endLine: current.endLine,
          text: current.lines.join('\n'),
        });
        current = null;
      }
    } else {
      if (!current) {
        current = { startLine: i + 1, endLine: i + 1, lines: [line] };
      } else {
        current.endLine = i + 1;
        current.lines.push(line);
      }
    }
  }
  if (current) {
    blocks.push({
      startLine: current.startLine,
      endLine: current.endLine,
      text: current.lines.join('\n'),
    });
  }

  const merged: Statement[] = [];
  for (const block of blocks) {
    const firstNonEmpty = block.text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    const startsWithDot = firstNonEmpty !== undefined && firstNonEmpty.startsWith('.');
    if (startsWithDot && merged.length > 0) {
      const prev = merged[merged.length - 1];
      prev.endLine = block.endLine;
      prev.text = `${prev.text}\n${block.text}`;
    } else {
      merged.push({ ...block });
    }
  }

  return merged;
}

export function getStatementAtCursor(script: string, cursorLine: number): Statement | null {
  const statements = detectStatements(script);
  for (const stmt of statements) {
    if (cursorLine >= stmt.startLine && cursorLine <= stmt.endLine) {
      return stmt;
    }
  }
  return null;
}
