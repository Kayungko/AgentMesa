import { describe, it, expect } from 'vitest';
import { generateCodexExecScript } from '../generators/codex-exec-flow.js';

describe('generateCodexExecScript', () => {
  it('uses the real mesa task show CLI command', () => {
    const script = generateCodexExecScript({ taskId: 'task-1' });
    expect(script).toContain('mesa task show "${TASK_ID}" --json');
  });

  it('does not reference the nonexistent --mesa-dir flag or mesa task read', () => {
    const script = generateCodexExecScript({ taskId: 'task-1' });
    expect(script).not.toContain('--mesa-dir');
    expect(script).not.toContain('mesa task read');
  });

  it('does not reference the nonexistent mesa artifact attach command', () => {
    const script = generateCodexExecScript({ taskId: 'task-1' });
    expect(script).not.toContain('mesa artifact attach');
  });

  it('runs codex with the review skill for the given task', () => {
    const script = generateCodexExecScript({ taskId: 'task-1' });
    expect(script).toContain('codex --skill agentmesa-review');
    expect(script).toContain('Review task task-1');
  });

  it('cds into the workspace root before running mesa commands', () => {
    const script = generateCodexExecScript({ taskId: 'task-1', mesaDir: '/repo' });
    expect(script).toContain('MESA_DIR="/repo"');
    expect(script).toContain('cd "${MESA_DIR}"');
  });
});
