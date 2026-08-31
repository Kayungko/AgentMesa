import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  formatRelativeTime,
  normalizePreviewItem,
  projectTail,
  truncate,
} from '../import-session-format.js';

const NOW = Date.parse('2026-08-31T12:00:00.000Z');

describe('formatRelativeTime', () => {
  it('buckets ISO timestamps into human relative labels', () => {
    expect(formatRelativeTime('2026-08-31T11:59:30.000Z', NOW)).toBe('刚刚');
    expect(formatRelativeTime('2026-08-31T11:30:00.000Z', NOW)).toBe('30 分钟前');
    expect(formatRelativeTime('2026-08-31T08:00:00.000Z', NOW)).toBe('4 小时前');
    expect(formatRelativeTime('2026-08-29T12:00:00.000Z', NOW)).toBe('2 天前');
  });

  it('returns empty string for an invalid timestamp', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('');
  });
});

describe('formatBytes', () => {
  it('formats bytes / KB / MB with one decimal below 10', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(15 * 1024)).toBe('15 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB');
  });

  it('treats invalid input as zero', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });
});

describe('projectTail', () => {
  it('prefers projectDir and takes the last path segment', () => {
    expect(projectTail({ projectDir: '/home/dev/AgentMesa', cwd: '/tmp' })).toBe('AgentMesa');
    expect(projectTail({ cwd: 'E:\\work\\sgame\\client' })).toBe('client');
  });

  it('falls back to cwd and tolerates trailing separators / empty input', () => {
    expect(projectTail({ cwd: '/home/dev/AgentMesa/' })).toBe('AgentMesa');
    expect(projectTail({})).toBe('');
  });
});

describe('truncate', () => {
  it('keeps short text verbatim and appends an ellipsis beyond the limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
    const long = 'a'.repeat(100);
    const result = truncate(long, 20);
    expect(result).toHaveLength(20);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('normalizePreviewItem', () => {
  const base = { speaker: 'assistant', createdAt: '2026-08-31T00:00:00.000Z' };

  it('keeps text items verbatim with the 文本 label', () => {
    const item = normalizePreviewItem({ ...base, text: '  帮我看看登录模块  ', kind: 'text' });
    expect(item.kindLabel).toBe('文本');
    expect(item.text).toBe('帮我看看登录模块');
    expect(item.summary).toBe('帮我看看登录模块');
  });

  it('extracts the tool name and argument digest for tool_use JSON payloads', () => {
    const item = normalizePreviewItem({
      ...base,
      text: '{"name":"Read","input":{"file_path":"src/a.ts"}}',
      kind: 'tool_use',
    });
    expect(item.kindLabel).toBe('工具调用');
    expect(item.summary).toContain('Read');
    expect(item.summary).toContain('file_path');
    expect(item.summary.startsWith('Read(')).toBe(true);
  });

  it('falls back to a truncated raw text when tool_use payload is not JSON', () => {
    const item = normalizePreviewItem({
      ...base,
      text: `Bash: npm run build ${'arg '.repeat(30)}`,
      kind: 'tool_use',
    });
    expect(item.summary.endsWith('…')).toBe(true);
    expect(item.summary.length).toBeLessThanOrEqual(80);
  });

  it('truncates long tool_result payloads', () => {
    const item = normalizePreviewItem({ ...base, text: 'x'.repeat(300), kind: 'tool_result' });
    expect(item.kindLabel).toBe('工具结果');
    expect(item.summary).toHaveLength(80);
    expect(item.summary.endsWith('…')).toBe(true);
  });

  it('labels unknown kinds with the raw kind', () => {
    const item = normalizePreviewItem({ ...base, text: 'thinking...', kind: 'reasoning' });
    expect(item.kindLabel).toBe('reasoning');
    expect(item.summary).toBe('thinking...');
  });
});
