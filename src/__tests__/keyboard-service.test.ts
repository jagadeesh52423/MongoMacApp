import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyboardService, formatKeyCombo } from '../services/KeyboardService';

let svc: KeyboardService;

beforeEach(() => {
  svc = new KeyboardService();
});

function makeKeyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: 'c',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe('KeyboardService', () => {
  it('calls registered action on matching keydown', () => {
    const action = vi.fn();
    svc.register({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', action });
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).toHaveBeenCalledOnce();
  });

  it('does not fire on non-matching event', () => {
    const action = vi.fn();
    svc.register({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', action });
    svc.dispatch(makeKeyEvent({ key: 'v', metaKey: true }));
    expect(action).not.toHaveBeenCalled();
  });

  it('calls preventDefault when a shortcut matches', () => {
    const e = makeKeyEvent({ key: 'c', metaKey: true });
    svc.register({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', action: vi.fn() });
    svc.dispatch(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('requires all modifiers to match', () => {
    const action = vi.fn();
    svc.register({ id: 'test', keys: { cmd: true, shift: true, key: 'c' }, label: 'Copy', action });
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true, shiftKey: false }));
    expect(action).not.toHaveBeenCalled();
  });

  it('unregisters via returned function', () => {
    const action = vi.fn();
    const unregister = svc.register({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', action });
    unregister();
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).not.toHaveBeenCalled();
  });

  it('getAll returns registered shortcuts', () => {
    svc.register({ id: 'a', keys: { cmd: true, key: 'c' }, label: 'A', action: vi.fn(), showInContextMenu: true });
    svc.register({ id: 'b', keys: { cmd: true, key: 'v' }, label: 'B', action: vi.fn() });
    expect(svc.getShortcuts()).toHaveLength(2);
  });

  it('fires scoped shortcut when active scope matches', () => {
    const action = vi.fn();
    svc.register({ id: 'scoped', keys: { cmd: true, key: 'c' }, label: 'Copy', action, scope: 'results' });
    svc.setScope('results');
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).toHaveBeenCalledOnce();
  });

  it('does not fire scoped shortcut when active scope does not match', () => {
    const action = vi.fn();
    svc.register({ id: 'scoped', keys: { cmd: true, key: 'c' }, label: 'Copy', action, scope: 'results' });
    svc.setScope('editor');
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).not.toHaveBeenCalled();
  });

  it('does not fire scoped shortcut when active scope is empty', () => {
    const action = vi.fn();
    svc.register({ id: 'scoped', keys: { cmd: true, key: 'c' }, label: 'Copy', action, scope: 'results' });
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).not.toHaveBeenCalled();
  });

  it('fires unscoped shortcut regardless of active scope', () => {
    const action = vi.fn();
    svc.register({ id: 'unscoped', keys: { cmd: true, key: 'c' }, label: 'Copy', action });
    svc.setScope('editor');
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).toHaveBeenCalledOnce();
  });

  it('fires unscoped shortcut when no scope is active', () => {
    const action = vi.fn();
    svc.register({ id: 'unscoped', keys: { cmd: true, key: 'c' }, label: 'Copy', action });
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).toHaveBeenCalledOnce();
  });

  it('setScope / getScope round-trip returns the stored scope', () => {
    expect(svc.getScope()).toBe('');
    svc.setScope('results');
    expect(svc.getScope()).toBe('results');
    svc.setScope('editor');
    expect(svc.getScope()).toBe('editor');
    svc.setScope('');
    expect(svc.getScope()).toBe('');
  });
});

describe('formatKeyCombo', () => {
  it('formats cmd+c as ⌘C', () => {
    expect(formatKeyCombo({ cmd: true, key: 'c' })).toBe('⌘C');
  });

  it('formats ctrl+cmd+c as ⌃⌘C', () => {
    expect(formatKeyCombo({ ctrl: true, cmd: true, key: 'c' })).toBe('⌃⌘C');
  });

  it('formats shift+alt+cmd+c as ⇧⌥⌘C', () => {
    expect(formatKeyCombo({ shift: true, alt: true, cmd: true, key: 'c' })).toBe('⇧⌥⌘C');
  });

  it('formats shift+cmd+c as ⇧⌘C', () => {
    expect(formatKeyCombo({ shift: true, cmd: true, key: 'c' })).toBe('⇧⌘C');
  });
});

import { renderHook } from '@testing-library/react';
import { useKeyboard } from '../hooks/useKeyboard';

describe('useKeyboard', () => {
  it('registers shortcut on mount and unregisters on unmount', () => {
    const svc2 = new KeyboardService();
    const action = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboard({ id: 'hook-test', keys: { cmd: true, key: 'z' }, label: 'Test', action }, svc2)
    );
    expect(svc2.getShortcuts()).toHaveLength(1);
    unmount();
    expect(svc2.getShortcuts()).toHaveLength(0);
  });
});
