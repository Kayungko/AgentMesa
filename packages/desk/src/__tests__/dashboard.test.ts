import { describe, it, expect } from 'vitest';
import { generateDashboardHtml } from '../dashboard.js';

describe('generateDashboardHtml', () => {
  const html = generateDashboardHtml();

  it('contains AgentMesa title', () => {
    expect(html).toContain('AgentMesa');
  });

  it('contains task board section', () => {
    expect(html).toContain('Task Board');
    expect(html).toContain('task-board');
  });

  it('contains meeting timeline section', () => {
    expect(html).toContain('Meeting Timeline');
    expect(html).toContain('meeting-timeline');
  });

  it('contains agent status section', () => {
    expect(html).toContain('Agent Status');
    expect(html).toContain('agent-status');
  });

  it('contains agent runs section', () => {
    expect(html).toContain('Agent Runs');
    expect(html).toContain('agent-runs');
  });

  it('contains workflows section', () => {
    expect(html).toContain('Workflows');
    expect(html).toContain('id="workflows"');
  });

  it('contains handoffs section', () => {
    expect(html).toContain('Handoffs');
    expect(html).toContain('id="handoffs"');
  });

  it('contains check results section', () => {
    expect(html).toContain('Check Results');
    expect(html).toContain('check-results');
  });

  it('is a complete HTML document', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });
});
