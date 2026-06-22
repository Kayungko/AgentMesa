import { describe, it, expect } from 'vitest';
import { generateHookConfig } from '../generators/hooks.js';

describe('generateHookConfig', () => {
  it('should emit a single Stop hook', () => {
    const config = generateHookConfig();
    expect(config.hooks).toHaveLength(1);
    expect(config.hooks[0]!.event).toBe('Stop');
  });

  it('should not emit fictional CLI flags or subcommands', () => {
    const command = generateHookConfig().hooks[0]!.command;
    expect(command).not.toContain('--auto-status');
    expect(command).not.toContain('--dir');
    expect(command).not.toContain('task update');
  });

  it('should reference the real status subcommand and review tool', () => {
    const command = generateHookConfig().hooks[0]!.command;
    expect(command).toContain('mesa task status');
    expect(command).toContain('mesa_request_review');
  });
});
