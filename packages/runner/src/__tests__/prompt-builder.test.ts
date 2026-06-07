import { describe, it, expect } from 'vitest';
import { fixtureTask } from '@agentmesa/protocol';
import {
  buildImplementPrompt,
  buildFixPrompt,
  buildReviewPrompt,
  buildTestPrompt,
  buildDocumentPrompt,
} from '../prompt-builder.js';

describe('buildImplementPrompt', () => {
  it('builds a basic implement prompt', () => {
    const prompt = buildImplementPrompt(fixtureTask);
    expect(prompt).toContain('Implement the following task');
    expect(prompt).toContain(fixtureTask.id);
    expect(prompt).toContain(fixtureTask.title);
  });

  it('includes goal from task context', () => {
    const prompt = buildImplementPrompt(fixtureTask);
    expect(prompt).toContain(fixtureTask.context!.goal!);
  });

  it('includes changed files from task context', () => {
    const prompt = buildImplementPrompt(fixtureTask);
    expect(prompt).toContain('src/auth/qr-login.ts');
    expect(prompt).toContain('src/auth/qr-scanner.tsx');
  });

  it('includes commands from task context', () => {
    const prompt = buildImplementPrompt(fixtureTask);
    expect(prompt).toContain('npm test');
    expect(prompt).toContain('npm run lint');
  });

  it('includes branch information', () => {
    const prompt = buildImplementPrompt(fixtureTask);
    expect(prompt).toContain('feature/qr-login');
  });

  it('overrides with provided context', () => {
    const context = {
      goal: 'Override goal',
      changedFiles: ['override.ts'],
      commands: ['override-cmd'],
    };
    const prompt = buildImplementPrompt(fixtureTask, context);
    expect(prompt).toContain('Override goal');
    expect(prompt).toContain('override.ts');
    expect(prompt).toContain('override-cmd');
  });

  it('handles task without context', () => {
    const simpleTask = {
      ...fixtureTask,
      context: undefined,
      branch: undefined,
    };
    const prompt = buildImplementPrompt(simpleTask);
    expect(prompt).toContain('Implement the following task');
    expect(prompt).toContain(simpleTask.id);
    expect(prompt).not.toContain('Goal:');
    expect(prompt).not.toContain('Branch:');
  });
});

describe('buildFixPrompt', () => {
  it('builds a fix prompt with review content', () => {
    const reviewContent = 'Missing validation on QR payload';
    const prompt = buildFixPrompt(fixtureTask, reviewContent);
    expect(prompt).toContain('Fix the issues found in this review');
    expect(prompt).toContain(fixtureTask.id);
    expect(prompt).toContain(fixtureTask.title);
    expect(prompt).toContain(reviewContent);
  });
});

describe('buildReviewPrompt', () => {
  it('builds a review prompt with diff', () => {
    const diff = 'diff --git a/src/auth/qr-login.ts b/src/auth/qr-login.ts\n+new code';
    const prompt = buildReviewPrompt(fixtureTask, diff);
    expect(prompt).toContain('Review the following implementation');
    expect(prompt).toContain(fixtureTask.id);
    expect(prompt).toContain(fixtureTask.title);
    expect(prompt).toContain(diff);
  });

  it('includes goal when present', () => {
    const prompt = buildReviewPrompt(fixtureTask, 'diff content');
    expect(prompt).toContain(fixtureTask.context!.goal!);
  });
});

describe('buildTestPrompt', () => {
  it('builds a test prompt', () => {
    const prompt = buildTestPrompt(fixtureTask);
    expect(prompt).toContain('Write and run tests');
    expect(prompt).toContain(fixtureTask.id);
    expect(prompt).toContain(fixtureTask.title);
  });

  it('includes changed files', () => {
    const prompt = buildTestPrompt(fixtureTask);
    expect(prompt).toContain('src/auth/qr-login.ts');
    expect(prompt).toContain('src/auth/qr-scanner.tsx');
  });

  it('includes goal', () => {
    const prompt = buildTestPrompt(fixtureTask);
    expect(prompt).toContain(fixtureTask.context!.goal!);
  });
});

describe('buildDocumentPrompt', () => {
  it('builds a document prompt', () => {
    const prompt = buildDocumentPrompt(fixtureTask);
    expect(prompt).toContain('Document the following');
    expect(prompt).toContain(fixtureTask.id);
    expect(prompt).toContain(fixtureTask.title);
  });

  it('includes changed files', () => {
    const prompt = buildDocumentPrompt(fixtureTask);
    expect(prompt).toContain('src/auth/qr-login.ts');
    expect(prompt).toContain('src/auth/qr-scanner.tsx');
  });

  it('handles task without context', () => {
    const simpleTask = { ...fixtureTask, context: undefined };
    const prompt = buildDocumentPrompt(simpleTask);
    expect(prompt).toContain('Document the following');
    expect(prompt).not.toContain('Files to document');
  });
});
