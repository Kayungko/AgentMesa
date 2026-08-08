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

  it('places the workspace summary above the card grid', () => {
    const summaryIdx = html.indexOf('工作区概览');
    const gridIdx = html.indexOf('class="grid"');
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(gridIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeLessThan(gridIdx);
  });

  it('provides a manual refresh button and brand favicon', () => {
    expect(html).toContain('refresh-btn');
    expect(html).toContain('rel="icon"');
  });

  it('distinguishes load failure from empty lists', () => {
    expect(html).toContain('加载失败，请检查服务连接');
    expect(html).toContain('暂无任务');
  });

  it('caps card list height so long lists scroll', () => {
    expect(html).toContain('max-height: 420px');
  });

  it('is a complete HTML document', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });
});
