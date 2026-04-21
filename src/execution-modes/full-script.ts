import { registerExecutionMode } from './registry';

registerExecutionMode({
  id: 'full-script',
  label: '▶▶ Run Script',
  buttonStyle: 'filled',
  keybind: (m) => m.KeyMod.Shift | m.KeyMod.CtrlCmd | m.KeyCode.Enter,
  resolveContent(ctx) {
    return ctx.content;
  },
});
