import { describe, it, expect } from 'vitest';
import {
  resolveSessionDriverPreference,
  resolveSessionDriverRegistry,
  shouldUseSessionDriver,
  SESSION_DRIVER_PREFERENCE_ENV,
} from '../drivers/env.js';
import { DRIVER_PREFERENCE_ENV } from '../drivers/resolve.js';
import { parseDriverPreference } from '../drivers/resolve.js';

describe('resolveSessionDriverPreference', () => {
  it('defaults to cli when the env var is unset', () => {
    expect(resolveSessionDriverPreference({})).toBe('cli');
    expect(resolveSessionDriverPreference({ [SESSION_DRIVER_PREFERENCE_ENV]: undefined })).toBe('cli');
  });

  it('accepts the four legal values', () => {
    expect(resolveSessionDriverPreference({ [SESSION_DRIVER_PREFERENCE_ENV]: 'cli' })).toBe('cli');
    expect(resolveSessionDriverPreference({ [SESSION_DRIVER_PREFERENCE_ENV]: 'auto' })).toBe('auto');
    expect(
      resolveSessionDriverPreference({ [SESSION_DRIVER_PREFERENCE_ENV]: 'claude-agent-sdk' }),
    ).toBe('claude-agent-sdk');
    expect(
      resolveSessionDriverPreference({ [SESSION_DRIVER_PREFERENCE_ENV]: 'codex-app-server' }),
    ).toBe('codex-app-server');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveSessionDriverPreference({ [SESSION_DRIVER_PREFERENCE_ENV]: ' auto ' })).toBe('auto');
  });

  it('falls back to the default (cli) on invalid values — same pattern as AGENTMESA_DRIVER', () => {
    // AGENTMESA_DRIVER treats unknown values as its default ('auto'), never
    // throwing; the session switch mirrors that with its own default ('cli').
    for (const invalid of ['nonsense', 'CLAUDE-AGENT-SDK', 'deep', '0', ' ']) {
      expect(parseDriverPreference(invalid)).toEqual({ kind: 'auto' });
      expect(resolveSessionDriverPreference({ [SESSION_DRIVER_PREFERENCE_ENV]: invalid })).toBe('cli');
    }
  });

  it('is independent of AGENTMESA_DRIVER (meeting speech never follows the task-run switch)', () => {
    expect(
      resolveSessionDriverPreference({
        AGENTMESA_DRIVER: 'auto',
        [SESSION_DRIVER_PREFERENCE_ENV]: undefined,
      }),
    ).toBe('cli');
  });
});

describe('resolveSessionDriverRegistry', () => {
  it('returns an empty registry when the session switch is cli (the default)', () => {
    expect(resolveSessionDriverRegistry({})).toEqual([]);
    expect(resolveSessionDriverRegistry({ [SESSION_DRIVER_PREFERENCE_ENV]: 'cli' })).toEqual([]);
  });

  it('returns the default registry once the session switch opts in', () => {
    const registry = resolveSessionDriverRegistry({ [SESSION_DRIVER_PREFERENCE_ENV]: 'auto' });
    expect(Array.isArray(registry)).toBe(true);
    expect(registry.length).toBeGreaterThan(0);
  });

  it('ignores AGENTMESA_DRIVER=cli — the task-run switch must not empty the session registry', () => {
    // The takeover blind spot: AGENTMESA_DRIVER=cli used to empty the shared
    // registry even when AGENTMESA_SESSION_DRIVER had explicitly opted in,
    // silently degrading session runs back to the one-shot CLI path.
    const registry = resolveSessionDriverRegistry({
      [DRIVER_PREFERENCE_ENV]: 'cli',
      [SESSION_DRIVER_PREFERENCE_ENV]: 'claude-agent-sdk',
    });
    expect(registry.length).toBeGreaterThan(0);
  });
});

describe('shouldUseSessionDriver', () => {
  it('cli → always false regardless of client', () => {
    expect(shouldUseSessionDriver('cli', 'claude-code')).toBe(false);
    expect(shouldUseSessionDriver('cli', 'codex')).toBe(false);
    expect(shouldUseSessionDriver('cli', undefined)).toBe(false);
  });

  it('auto → true only for claude-family clients (Phase 1 conservative)', () => {
    expect(shouldUseSessionDriver('auto', 'claude')).toBe(true);
    expect(shouldUseSessionDriver('auto', 'claude-code')).toBe(true);
  });

  it('auto → false for codex clients (patch payload fix pending)', () => {
    expect(shouldUseSessionDriver('auto', 'codex')).toBe(false);
  });

  it('auto → false for unknown or missing clients', () => {
    expect(shouldUseSessionDriver('auto', undefined)).toBe(false);
    expect(shouldUseSessionDriver('auto', 'cursor')).toBe(false);
  });

  it('explicit kinds → always true, independent of the client', () => {
    expect(shouldUseSessionDriver('claude-agent-sdk', 'codex')).toBe(true);
    expect(shouldUseSessionDriver('claude-agent-sdk', undefined)).toBe(true);
    expect(shouldUseSessionDriver('codex-app-server', 'claude')).toBe(true);
    expect(shouldUseSessionDriver('codex-app-server', undefined)).toBe(true);
  });
});
