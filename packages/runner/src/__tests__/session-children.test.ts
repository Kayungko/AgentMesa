import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import {
  trackSessionChild,
  terminateSessionChildren,
  activeSessionChildCount,
} from '../session-children.js';

/** Remove a temp dir, retrying briefly — a freshly killed child may still hold it. */
function rmSyncRetry(dir: string): void {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      const waitUntil = Date.now() + 50;
      while (Date.now() < waitUntil) { /* busy-wait short */ }
    }
  }
}

const dirs: string[] = [];

function makeHangScript(): string {
  const dir = mkdtempSync(join(tmpdir(), 'session-children-'));
  dirs.push(dir);
  const script = join(dir, 'hang.mjs');
  // Keep the event loop alive so the process only stops when we kill it.
  writeFileSync(script, 'setInterval(()=>{},1000);');
  return script;
}

afterEach(() => {
  terminateSessionChildren();
  for (const dir of dirs) {
    rmSyncRetry(dir);
  }
  dirs.length = 0;
});

describe('session children registry', () => {
  it('tracks a spawned child and auto-deregisters on exit', async () => {
    const script = makeHangScript();
    const child = spawn(process.execPath, [script], { stdio: 'ignore' });
    trackSessionChild(child);

    expect(activeSessionChildCount()).toBe(1);

    await new Promise<void>((resolve) => {
      child.once('close', () => resolve());
      child.kill('SIGTERM');
    });

    expect(activeSessionChildCount()).toBe(0);
  });

  it('terminateSessionChildren SIGTERMs every in-flight child', async () => {
    const script = makeHangScript();
    const a = spawn(process.execPath, [script], { stdio: 'ignore' });
    const b = spawn(process.execPath, [script], { stdio: 'ignore' });
    trackSessionChild(a);
    trackSessionChild(b);
    expect(activeSessionChildCount()).toBe(2);

    terminateSessionChildren();

    await Promise.all([
      new Promise<void>((resolve) => a.once('close', () => resolve())),
      new Promise<void>((resolve) => b.once('close', () => resolve())),
    ]);
    expect(activeSessionChildCount()).toBe(0);
  });
});
