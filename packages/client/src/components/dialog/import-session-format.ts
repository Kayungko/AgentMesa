import type { ExternalSessionPreviewItem, ExternalSessionSummary, ImportSessionResult } from '../../types.js';

// ---------------------------------------------------------------------------
// 外部会话导入的展示层纯函数：格式化 / 归一化都集中在这里，方便单测。
// ---------------------------------------------------------------------------

/** 相对时间：<1min 刚刚 / <1h N 分钟前 / <24h N 小时前 / <7d N 天前 / 更早返回日期。now 可注入便于测试。 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  const diff = now - time;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** 字节数 → 人类可读（B / KB / MB）。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** 取 `projectDir || cwd` 的最后一段作为项目名（Windows / POSIX 分隔符都兼容）。 */
export function projectTail(session: Pick<ExternalSessionSummary, 'projectDir' | 'cwd'>): string {
  const path = session.projectDir || session.cwd || '';
  const segments = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return segments[segments.length - 1] ?? '';
}

/** 列表页「进行中」会话行的接管冲突提示文案。 */
export const ACTIVE_SESSION_CONFLICT_HINT = '该会话可能正被原生客户端使用，接管续跑可能冲突';

/** 导入结果里需要用户看到的提示（接管失败 / cli 模式不生效）。 */
export interface ImportNotice {
  kind: 'error' | 'warning';
  text: string;
}

/**
 * 归一化导入结果的提示：快照导入成功的前提下，adoptError（接管失败，仅降级）
 * 排在 adoptWarning（接管成功但 driverMode=cli 不生效）之前；无提示返回空数组，
 * 调用方直接跳转会议。
 */
export function importResultNotices(
  result: Pick<ImportSessionResult, 'adoptError' | 'adoptWarning'>,
): ImportNotice[] {
  const notices: ImportNotice[] = [];
  if (result.adoptError) {
    notices.push({ kind: 'error', text: `接管续跑未生效（快照导入已成功）：${result.adoptError}` });
  }
  if (result.adoptWarning) {
    notices.push({ kind: 'warning', text: result.adoptWarning });
  }
  return notices;
}

export function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

/** 预览条目归一化后的展示模型。 */
export interface NormalizedPreviewItem {
  speaker: string;
  /** kind 的中文标签（未知 kind 原样展示）。 */
  kindLabel: string;
  kind: string;
  /** 一行摘要：text 为原文；tool_use 为工具名+参数摘要；tool_result 为截断结果。 */
  summary: string;
  /** 原文（text kind 完整展示，其余折叠为摘要）。 */
  text: string;
  createdAt: string;
}

const kindLabels: Record<string, string> = {
  text: '文本',
  tool_use: '工具调用',
  tool_result: '工具结果',
};

function toolNameOf(raw: string): { name: string; args: string } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const name = record.name ?? record.tool_name ?? record.tool;
      if (typeof name === 'string' && name) {
        const args =
          record.input ?? record.args ?? record.arguments ?? record.parameters ?? undefined;
        const argsText = args === undefined ? '' : JSON.stringify(args);
        return { name, args: argsText };
      }
    }
  } catch {
    // text 不是 JSON —— 原样截断展示。
  }
  return { name: '', args: '' };
}

/**
 * 归一化单条预览消息：
 * - text → 原文完整展示；
 * - tool_use → 尝试从 text 解析 JSON 取工具名，展示「工具名(参数摘要)」，解析失败则截断原文；
 * - tool_result → 截断摘要；
 * - 其他 kind → 显示 kind 标签 + 原文。
 */
export function normalizePreviewItem(item: ExternalSessionPreviewItem): NormalizedPreviewItem {
  const raw = (item.text ?? '').trim();
  const kindLabel = kindLabels[item.kind] ?? item.kind;
  if (item.kind === 'tool_use') {
    const { name, args } = toolNameOf(raw);
    const summary = name
      ? `${name}(${truncate(args, 60)})`
      : truncate(raw, 80);
    return { speaker: item.speaker, kind: item.kind, kindLabel, summary, text: raw, createdAt: item.createdAt };
  }
  if (item.kind === 'tool_result') {
    return {
      speaker: item.speaker,
      kind: item.kind,
      kindLabel,
      summary: truncate(raw, 80),
      text: raw,
      createdAt: item.createdAt,
    };
  }
  return { speaker: item.speaker, kind: item.kind, kindLabel, summary: raw, text: raw, createdAt: item.createdAt };
}
