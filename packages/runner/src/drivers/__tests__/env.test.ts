import { describe, it, expect } from 'vitest';
import { resolveDriverRegistryFromEnv } from '../env.js';

describe('resolveDriverRegistryFromEnv', () => {
  it('returns the default driver registry when AGENTMESA_DRIVER is unset', () => {
    const registry = resolveDriverRegistryFromEnv({});
    expect(registry.map((d) => d.kind)).toEqual(['claude-agent-sdk', 'codex-app-server']);
  });

  it('returns the default driver registry for auto', () => {
    const registry = resolveDriverRegistryFromEnv({ AGENTMESA_DRIVER: 'auto' });
    expect(registry.map((d) => d.kind)).toEqual(['claude-agent-sdk', 'codex-app-server']);
  });

  it('returns the default driver registry for unknown or blank values (parse to auto)', () => {
    for (const value of ['nonsense', '  ', 'CLAUDE-AGENT-SDK', 'codex']) {
      const registry = resolveDriverRegistryFromEnv({ AGENTMESA_DRIVER: value });
      expect(registry.map((d) => d.kind)).toEqual(['claude-agent-sdk', 'codex-app-server']);
    }
  });

  it('returns the default driver registry for explicit driver kinds', () => {
    // The env value itself drives which driver executeRun selects
    // (resolveDriverPreference); the registry still carries both backends.
    expect(resolveDriverRegistryFromEnv({ AGENTMESA_DRIVER: 'claude-agent-sdk' })).toHaveLength(2);
    expect(resolveDriverRegistryFromEnv({ AGENTMESA_DRIVER: 'codex-app-server' })).toHaveLength(2);
  });

  it('returns an empty registry for cli (deep drivers explicitly off)', () => {
    expect(resolveDriverRegistryFromEnv({ AGENTMESA_DRIVER: 'cli' })).toEqual([]);
    expect(resolveDriverRegistryFromEnv({ AGENTMESA_DRIVER: ' cli ' })).toEqual([]);
  });

  it('returns fresh driver instances on every call', () => {
    const a = resolveDriverRegistryFromEnv({});
    const b = resolveDriverRegistryFromEnv({});
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    expect(a[1]).not.toBe(b[1]);
  });

  it('reads process.env when no env source is passed', () => {
    const previous = process.env.AGENTMESA_DRIVER;
    try {
      delete process.env.AGENTMESA_DRIVER;
      expect(resolveDriverRegistryFromEnv()).toHaveLength(2);
      process.env.AGENTMESA_DRIVER = 'cli';
      expect(resolveDriverRegistryFromEnv()).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.AGENTMESA_DRIVER;
      else process.env.AGENTMESA_DRIVER = previous;
    }
  });
});
