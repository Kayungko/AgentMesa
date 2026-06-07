import { describe, it, expect } from 'vitest';
import { generateReviewReportTemplate } from '../generators/review-report-template.js';

describe('generateReviewReportTemplate', () => {
  it('returns a non-empty markdown string', () => {
    const template = generateReviewReportTemplate();
    expect(template.length).toBeGreaterThan(0);
    expect(template).toContain('# Review Report');
  });

  it('includes task information section with ID, Title, Reviewer, Result', () => {
    const template = generateReviewReportTemplate();
    expect(template).toContain('Task Information');
    expect(template).toContain('Task ID');
    expect(template).toContain('Title');
    expect(template).toContain('Reviewer');
    expect(template).toContain('Result');
  });

  it('includes a Summary section', () => {
    const template = generateReviewReportTemplate();
    expect(template).toContain('## Summary');
  });

  it('includes an Issues section with required columns', () => {
    const template = generateReviewReportTemplate();
    expect(template).toContain('## Issues');
    expect(template).toContain('Severity');
    expect(template).toContain('File');
    expect(template).toContain('Problem');
    expect(template).toContain('Suggestion');
  });

  it('includes a Checks Run section', () => {
    const template = generateReviewReportTemplate();
    expect(template).toContain('## Checks Run');
    expect(template).toContain('Correctness');
    expect(template).toContain('Code quality');
    expect(template).toContain('Tests');
    expect(template).toContain('Edge cases');
    expect(template).toContain('Security');
  });

  it('includes a Final Decision section', () => {
    const template = generateReviewReportTemplate();
    expect(template).toContain('## Final Decision');
    expect(template).toContain('approved');
    expect(template).toContain('changes_requested');
  });

  it('includes template placeholders', () => {
    const template = generateReviewReportTemplate();
    expect(template).toContain('{{task_id}}');
    expect(template).toContain('{{task_title}}');
    expect(template).toContain('{{reviewer}}');
    expect(template).toContain('{{result}}');
    expect(template).toContain('{{summary}}');
    expect(template).toContain('{{severity}}');
    expect(template).toContain('{{decision}}');
  });

  it('uses markdown table syntax', () => {
    const template = generateReviewReportTemplate();
    expect(template).toContain('| Field | Value |');
    expect(template).toContain('|-------|-------|');
    expect(template).toContain('| Severity | File | Problem | Suggestion |');
    expect(template).toContain('|----------|------|---------|------------|');
  });

  it('is idempotent — calling twice returns the same result', () => {
    const a = generateReviewReportTemplate();
    const b = generateReviewReportTemplate();
    expect(a).toBe(b);
  });
});
