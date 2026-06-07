/**
 * Generates a markdown template string for review reports.
 *
 * This template is used by the reviewer agent to produce
 * structured review reports that get attached as artifacts.
 */
export function generateReviewReportTemplate(): string {
  const lines: string[] = [];

  lines.push('# Review Report');
  lines.push('');
  lines.push('## Task Information');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push('| **Task ID** | {{task_id}} |');
  lines.push('| **Title** | {{task_title}} |');
  lines.push('| **Reviewer** | {{reviewer}} |');
  lines.push('| **Result** | {{result}} |');
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('{{summary}}');
  lines.push('');

  lines.push('## Issues');
  lines.push('');
  lines.push('| Severity | File | Problem | Suggestion |');
  lines.push('|----------|------|---------|------------|');
  lines.push('| {{severity}} | {{file}} | {{problem}} | {{suggestion}} |');
  lines.push('');

  lines.push('## Checks Run');
  lines.push('');
  lines.push('- [ ] Correctness: Implementation matches task goal');
  lines.push('- [ ] Code quality: Code is clean and maintainable');
  lines.push('- [ ] Tests: Adequate test coverage for changes');
  lines.push('- [ ] Edge cases: Edge cases are handled');
  lines.push('- [ ] Security: No obvious security concerns');
  lines.push('- [ ] Documentation: Changes are documented if needed');
  lines.push('');

  lines.push('## Final Decision');
  lines.push('');
  lines.push('**{{decision}}**');
  lines.push('');
  lines.push('<!-- decision must be one of: approved | changes_requested -->');
  lines.push('');

  return lines.join('\n');
}
