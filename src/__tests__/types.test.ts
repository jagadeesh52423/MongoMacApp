import { describe, it, expect } from 'vitest';
import type { Connection } from '../types';

describe('types smoke', () => {
  it('Connection shape accepts all known fields', () => {
    const c: Connection = {
      id: '1',
      name: 'local',
      host: 'localhost',
      port: 27017,
      createdAt: '2026-04-17T00:00:00Z',
    };
    expect(c.name).toBe('local');
  });

});
