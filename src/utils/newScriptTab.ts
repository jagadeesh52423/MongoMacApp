import type { EditorTab } from '../types';

export function newScriptTab(): EditorTab {
  return {
    id: `script:${Date.now()}`,
    title: 'untitled.js',
    content: '// write your MongoDB script here\n',
    isDirty: false,
    type: 'script',
  };
}
