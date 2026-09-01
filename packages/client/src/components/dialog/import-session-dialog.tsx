import { useCallback, useState } from 'react';
import { importExternalSession, listExternalSessions, previewExternalSession, refreshImportedMeeting } from '../../api.js';
import type { ExternalSessionSource, ExternalSessionSummary, ImportSessionResult, RuntimeConfig } from '../../types.js';
import { Button } from '../ui/button.js';
import { SkeletonStack } from '../ui/skeleton.js';
import {
  ACTIVE_SESSION_CONFLICT_HINT,
  formatBytes,
  formatRelativeTime,
  importResultNotices,
  normalizePreviewItem,
  projectTail,
  type NormalizedPreviewItem,
} from './import-session-format.js';
import { Modal } from './modal.js';

type ImportView = 'source' | 'list' | 'preview' | 'result';

const sourceOptions: Array<{ source: ExternalSessionSource; title: string; detail: string }> = [
  { source: 'claude', title: 'Claude Code', detail: '~/.claude/projects' },
  { source: 'codex', title: 'codex', detail: '~/.codex/sessions' },
];

/**
 * 导入外部会话弹窗：来源选择 → 会话列表 → 预览（前 10 条）→ 确认导入，
 * 导入成功但接管有提示（失败 / cli 不生效）时进入结果页，同一 Modal 内
 * 视图切换（非路由跳转）。
 */
export function ImportSessionDialog({
  config,
  onCreated,
  onClose,
}: {
  config: RuntimeConfig;
  onCreated: (meetingId: string) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<ImportView>('source');
  const [source, setSource] = useState<ExternalSessionSource>();
  const [sessions, setSessions] = useState<ExternalSessionSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string>();
  const [selected, setSelected] = useState<ExternalSessionSummary>();
  const [preview, setPreview] = useState<NormalizedPreviewItem[]>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string>();
  // Phase 2 adopt：导入时把外部 session 种入 runner 驱动句柄（默认关）。
  const [adopt, setAdopt] = useState(false);
  // 导入成功但带提示（接管失败 / cli 模式不生效）时停留在结果页展示。
  const [importResult, setImportResult] = useState<ImportSessionResult>();
  // 快照刷新：某条已导入会话的源文件变化后，就地重拉快照（列表内操作）。
  const [refreshingId, setRefreshingId] = useState<string>();
  // 多选成组导入：勾选 ≥1 条后可批量导入并打上同一组名。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');
  const [batchImporting, setBatchImporting] = useState(false);
  // codex：同时列出 subagent / guardian_review 线程（默认只列 user 线程）。
  const [includeSubagents, setIncludeSubagents] = useState(false);

  const toggleSelected = (sessionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  const submitBatchImport = async () => {
    if (!source || batchImporting || selectedIds.size === 0) return;
    const targets = sessions.filter((session) => selectedIds.has(session.sessionId));
    if (targets.length === 0) return;
    setBatchImporting(true);
    setError(undefined);
    try {
      let last: ImportSessionResult | undefined;
      for (const session of targets) {
        last = await importExternalSession(
          config,
          source,
          session.sessionId,
          adopt,
          groupName || undefined,
        );
      }
      // 组内最后一个（通常是最新会话）作为落点。
      onCreated(last!.meetingId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      // 部分成功时刷新列表：已导入的条目会亮起"已导入"徽标，便于补齐。
      await loadSessions(source, includeSubagents);
      setBatchImporting(false);
    }
  };

  const loadSessions = useCallback(async (next: ExternalSessionSource, subagents = false) => {
    setListLoading(true);
    setListError(undefined);
    try {
      setSessions(await listExternalSessions(config, next, { includeSubagents: subagents }));
    } catch (reason) {
      setSessions([]);
      setListError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setListLoading(false);
    }
  }, [config]);

  // 每次选择来源都重新拉取列表（同一来源重复进入也刷新，覆盖"失败后重试"）。
  const pickSource = (next: ExternalSessionSource) => {
    setSource(next);
    setView('list');
    setSelectedIds(new Set());
    void loadSessions(next, includeSubagents);
  };

  const toggleSubagents = () => {
    const next = !includeSubagents;
    setIncludeSubagents(next);
    if (source) {
      setSelectedIds(new Set());
      void loadSessions(source, next);
    }
  };

  const refreshSnapshot = async (session: ExternalSessionSummary) => {
    if (!session.imported || refreshingId) return;
    setRefreshingId(session.sessionId);
    setListError(undefined);
    try {
      await refreshImportedMeeting(config, session.imported.meetingId);
      // 重新拉取列表：刷新后源锚点对齐，hasUpdates 徽标消失。
      if (source) {
        await loadSessions(source, includeSubagents);
      }
    } catch (reason) {
      setListError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRefreshingId(undefined);
    }
  };

  const openPreview = async (session: ExternalSessionSummary) => {
    setSelected(session);
    setView('preview');
    setPreview(undefined);
    setPreviewLoading(true);
    setError(undefined);
    try {
      const items = await previewExternalSession(config, session.source, session.sessionId);
      setPreview(items.map(normalizePreviewItem));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPreviewLoading(false);
    }
  };

  const backToList = () => {
    setView('list');
    setSelected(undefined);
    setPreview(undefined);
    setError(undefined);
    setImportResult(undefined);
  };

  const backToSource = () => {
    setView('source');
    setListError(undefined);
    setImportResult(undefined);
  };

  const submitImport = async () => {
    if (!source || !selected || importing) return;
    setImporting(true);
    setError(undefined);
    try {
      const result = await importExternalSession(config, source, selected.sessionId, adopt);
      // 快照导入已成功；只有存在需要用户看到的提示（接管失败 / cli 模式
      // 不生效）时才停留在结果页，否则直接跳转新会议。
      if (importResultNotices(result).length > 0) {
        setImportResult(result);
        setView('result');
        setImporting(false);
        return;
      }
      onCreated(result.meetingId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setImporting(false);
    }
  };

  const sourceTitle = sourceOptions.find((option) => option.source === source)?.title ?? source ?? '';

  return (
    <Modal title="导入外部会话" onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); void submitImport(); }}>
        {view === 'source' ? (
          <div className="import-sources">
            <p className="ctx-hint">选择要导入的会话来源——仅读取本机转写文件，导入后生成新的会议时间线。</p>
            {sourceOptions.map((option) => (
              <button
                key={option.source}
                type="button"
                className="import-source"
                onClick={() => pickSource(option.source)}
              >
                <strong>{option.title}</strong>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
        ) : view === 'list' ? (
          <>
            <div className="import-list-head">
              <span>{sourceTitle}</span>
              {source === 'codex' ? (
                <label className="import-subagents">
                  <input
                    type="checkbox"
                    checked={includeSubagents}
                    onChange={toggleSubagents}
                    disabled={listLoading || batchImporting}
                  />
                  子代理线程
                </label>
              ) : null}
              <button type="button" className="import-back" onClick={backToSource}>切换来源</button>
            </div>
            <div className="import-list">
              {listLoading ? (
                <SkeletonStack count={3} compact />
              ) : listError ? (
                <p className="inline-error">{listError}</p>
              ) : sessions.length === 0 ? (
                <p className="import-empty">未发现会话——先在对应 CLI 里跑一次，再回来导入。</p>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.sessionId}
                    className={`import-row${selectedIds.has(session.sessionId) ? ' import-row--selected' : ''}`}
                  >
                    <label className="import-row__check">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(session.sessionId)}
                        onChange={() => toggleSelected(session.sessionId)}
                        disabled={batchImporting}
                      />
                    </label>
                    <button
                      type="button"
                      className="import-row__main"
                      onClick={() => void openPreview(session)}
                      disabled={batchImporting}
                    >
                      <span className="import-row__top">
                        <span className="import-row__title" title={session.title}>{session.title}</span>
                        {session.imported ? (
                          <span className="import-badge import-badge--imported">已导入</span>
                        ) : null}
                        {session.hasUpdates ? (
                          <span className="import-badge import-badge--stale">源有更新</span>
                        ) : null}
                        {session.threadSource && session.threadSource !== 'user' ? (
                          <span className="import-badge import-badge--thread">{session.threadSource}</span>
                        ) : null}
                        {session.active ? (
                          <span className="agent-state agent-state--active">
                            <span className="agent-state__dot" />
                            进行中
                          </span>
                        ) : null}
                      </span>
                      <span className="import-row__meta">
                        <span title={session.projectDir ?? session.cwd ?? ''}>{projectTail(session) || '未知项目'}</span>
                        <span>{formatRelativeTime(session.lastModified)}</span>
                        <span>{formatBytes(session.sizeBytes)}</span>
                        {session.hasUpdates && session.imported ? (
                          <button
                            type="button"
                            className="import-refresh"
                            disabled={refreshingId === session.sessionId}
                            onClick={(event) => {
                              event.stopPropagation();
                              void refreshSnapshot(session);
                            }}
                          >
                            {refreshingId === session.sessionId ? '刷新中…' : '刷新快照'}
                          </button>
                        ) : null}
                      </span>
                      {session.active ? (
                        <span className="import-row__conflict">{ACTIVE_SESSION_CONFLICT_HINT}</span>
                      ) : null}
                    </button>
                  </div>
                ))
              )}
            </div>
            {error ? <p className="inline-error import-batch-error">{error}</p> : null}
            <div className="import-batch">
              <label className="import-adopt">
                <input
                  type="checkbox"
                  checked={adopt}
                  onChange={(event) => setAdopt(event.target.checked)}
                  disabled={batchImporting}
                />
                <span>
                  <strong>接管续跑</strong>
                </span>
              </label>
              <input
                type="text"
                className="import-batch__group"
                placeholder="组名（可选）——勾选多条一起导入时归为一组"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                disabled={batchImporting}
              />
              <Button
                variant="primary"
                type="button"
                disabled={batchImporting || selectedIds.size === 0}
                onClick={() => void submitBatchImport()}
              >
                {batchImporting ? '导入中…' : `导入所选（${selectedIds.size}）`}
              </Button>
            </div>
          </>
        ) : view === 'preview' ? (
          <>
            <div className="import-list-head">
              <span className="import-row__title" title={selected?.title}>{selected?.title ?? ''}</span>
              <button type="button" className="import-back" onClick={backToList}>返回列表</button>
            </div>
            <div className="import-preview">
              {previewLoading ? (
                <SkeletonStack count={3} compact />
              ) : !preview || preview.length === 0 ? (
                <p className="import-empty">该会话没有可预览的消息。</p>
              ) : (
                preview.map((item, index) => (
                  <div key={`${item.createdAt}-${index}`} className="import-preview__item">
                    <span className="import-preview__meta">
                      <strong>{item.speaker}</strong>
                      {item.kind !== 'text' ? <em className="chat-msg__type">{item.kindLabel}</em> : null}
                      <small>{formatRelativeTime(item.createdAt)}</small>
                    </span>
                    {item.kind === 'text' ? (
                      <p className="import-preview__text">{item.text}</p>
                    ) : (
                      <pre className="import-preview__mono">{item.summary}</pre>
                    )}
                  </div>
                ))
              )}
              {error ? <p className="inline-error">{error}</p> : null}
            </div>
            <label className="import-adopt">
              <input
                type="checkbox"
                checked={adopt}
                onChange={(event) => setAdopt(event.target.checked)}
                disabled={importing || previewLoading}
              />
              <span>
                <strong>接管续跑</strong>
                <small>导入后在深度驱动模式下继续原会话（resume 外部 session）</small>
              </span>
            </label>
            <p className="ctx-hint import-preview__hint">预览最多展示前 10 条消息；导入后会生成完整时间线。</p>
            <footer>
              <Button onClick={backToList} disabled={importing}>返回</Button>
              <Button
                variant="primary"
                type="submit"
                disabled={importing || previewLoading || !preview || preview.length === 0}
              >
                {importing ? '导入中…' : '导入'}
              </Button>
            </footer>
          </>
        ) : view === 'result' && importResult ? (
          <>
            <div className="import-result">
              <p className="import-result__ok">
                快照导入成功——已生成 {importResult.messageCount} 条消息的会议时间线。
              </p>
              {importResultNotices(importResult).map((notice, index) => (
                <p key={index} className={`import-notice import-notice--${notice.kind}`}>{notice.text}</p>
              ))}
            </div>
            <footer>
              <Button onClick={onClose} disabled={importing}>关闭</Button>
              <Button variant="primary" onClick={() => onCreated(importResult.meetingId)}>
                前往会议
              </Button>
            </footer>
          </>
        ) : null}

        {view === 'source' || view === 'list' ? (
          <footer>
            <Button onClick={onClose} disabled={importing || listLoading}>取消</Button>
          </footer>
        ) : null}
      </form>
    </Modal>
  );
}
