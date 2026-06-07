import { describe, it, expect } from 'vitest';
import { CommandPolicyChecker } from '../command-policy.js';

const checker = new CommandPolicyChecker();

describe('CommandPolicyChecker - safe commands', () => {
  it('allows git status', () => {
    const result = checker.isAllowed('git status');
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('allows npm test', () => {
    const result = checker.isAllowed('npm test');
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('allows npx vitest run', () => {
    const result = checker.isAllowed('npx vitest run');
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('allows git diff', () => {
    const result = checker.isAllowed('git diff');
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('allows npx tsc --noEmit', () => {
    const result = checker.isAllowed('npx tsc --noEmit');
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });
});

describe('CommandPolicyChecker - blocked commands', () => {
  it('blocks rm -rf /', () => {
    const result = checker.isAllowed('rm -rf /');
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('blocks sudo commands', () => {
    const result = checker.isAllowed('sudo apt install something');
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(false);
  });

  it('blocks force push', () => {
    const result = checker.isAllowed('git push --force origin main');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Force push');
  });

  it('blocks force push with -f flag', () => {
    const result = checker.isAllowed('git push -f origin main');
    expect(result.allowed).toBe(false);
  });

  it('blocks shutdown', () => {
    const result = checker.isAllowed('shutdown -h now');
    expect(result.allowed).toBe(false);
  });
});

describe('CommandPolicyChecker - approval required', () => {
  it('requires approval for npm install --save', () => {
    const result = checker.isAllowed('npm install express --save');
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it('requires approval for git push', () => {
    const result = checker.isAllowed('git push origin main');
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it('requires approval for git merge', () => {
    const result = checker.isAllowed('git merge feature-branch');
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it('requires approval for recursive rm', () => {
    const result = checker.isAllowed('rm -r ./old-stuff');
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });
});
