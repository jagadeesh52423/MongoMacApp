import { registerExecutionMode } from './registry';
import { getStatementAtCursor } from '../utils/statementDetection';

registerExecutionMode({
  id: 'smart',
  label: '▶ Run',
  buttonStyle: 'outline',
  keybind: (m) => m.KeyMod.CtrlCmd | m.KeyCode.Enter,
  resolveContent(ctx) {
    if (ctx.selection) return ctx.selection;
    const stmt = getStatementAtCursor(ctx.content, ctx.cursorLine);
    if (stmt) return stmt.text;
    return ctx.content;
  },
});
