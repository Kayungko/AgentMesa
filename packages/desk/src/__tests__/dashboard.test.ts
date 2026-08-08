import { describe, it, expect } from 'vitest';
import { generateDashboardHtml } from '../dashboard.js';

describe('generateDashboardHtml', () => {
  const html = generateDashboardHtml();

  it('contains AgentMesa title', () => {
    expect(html).toContain('AgentMesa');
  });

  it('contains task board section', () => {
    expect(html).toContain('任务看板');
    expect(html).toContain('task-board');
  });

  it('contains meeting timeline section', () => {
    expect(html).toContain('会议时间线');
    expect(html).toContain('meeting-timeline');
  });

  it('contains agent status section', () => {
    expect(html).toContain('Agent 状态');
    expect(html).toContain('agent-status');
  });

  it('contains agent runs section', () => {
    expect(html).toContain('Agent 运行');
    expect(html).toContain('agent-runs');
  });

  it('contains workflows section', () => {
    expect(html).toContain('工作流');
    expect(html).toContain('id="workflows"');
  });

  it('contains handoffs section', () => {
    expect(html).toContain('交接');
    expect(html).toContain('id="handoffs"');
  });

  it('contains check results section', () => {
    expect(html).toContain('检查结果');
    expect(html).toContain('check-results');
  });

  it('uses Chinese for the document language', () => {
    expect(html).toContain('lang="zh-CN"');
  });

  it('is a complete HTML document', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });
});
