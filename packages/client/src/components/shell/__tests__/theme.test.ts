import { describe, it, expect } from 'vitest';
import { normalizeTheme } from '../theme.js';

// Note: the first-paint resolution order (persisted explicit choice, else OS
// preference) lives in public/theme-boot.js — a plain, CSP-constrained classic
// script outside the module graph, so it cannot be imported here. The storage
// key and accepted values below must stay in sync with that file.

describe('normalizeTheme', () => {
  it('accepts the two canonical values', () => {
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('dark')).toBe('dark');
  });

  it('coerces anything else — including missing/unknown/hand-mangled values — to light', () => {
    expect(normalizeTheme(undefined)).toBe('light');
    expect(normalizeTheme(null)).toBe('light');
    expect(normalizeTheme('')).toBe('light');
    expect(normalizeTheme('DARK')).toBe('light'); // case-sensitive on purpose
    expect(normalizeTheme('dark ')).toBe('light'); // trailing space = corrupt
    expect(normalizeTheme('system')).toBe('light'); // no tri-state in v1
    expect(normalizeTheme(0)).toBe('light');
    expect(normalizeTheme({ theme: 'dark' })).toBe('light');
  });
});
