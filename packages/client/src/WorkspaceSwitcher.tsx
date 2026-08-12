// ---------------------------------------------------------------------------
// WorkspaceSwitcher — titlebar workspace picker (switch / register / manage).
// Extracted verbatim from App.tsx (S1 atomic move); no logic changes.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import type { RuntimeConfig, WorkspaceList } from './types.js';
import { activateWorkspace, loadWorkspaces, registerWorkspace, removeWorkspace } from './api.js';

export function WorkspaceSwitcher({ config }: { config: RuntimeConfig }) {
  const [state, setState] = useState<WorkspaceList>();
  const [busy, setBusy] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [newRoot, setNewRoot] = useState('');
  const [newName, setNewName] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(() => {
    loadWorkspaces(config).then(setState).catch(() => undefined);
  }, [config]);

  useEffect(() => refresh(), [refresh]);

  const activeName = state?.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId)?.name;

  const remove = async (workspaceId: string) => {
    const workspace = state?.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace || busy) return;
    // The active workspace is where the desk is currently running; removing it
    // would orphan the live view. Guarded in the UI as well as the backend.
    if (workspaceId === state?.activeWorkspaceId) return;
    if (!window.confirm(`从工作区列表移除「${workspace.name}」？\n（不会删除项目目录，仅解除注册）`)) return;
    setBusy(true);
    setError(undefined);
    try {
      await removeWorkspace(config, workspaceId);
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const switchTo = async (workspaceId: string) => {
    if (busy || workspaceId === state?.activeWorkspaceId) return;
    setBusy(true);
    setError(undefined);
    try {
      // The desktop main process restarts the desk for the new root and reloads
      // this window with the new base URL — the renderer must NOT self-reload
      // (that would race the main process's reload and reconnect to a stale
      // base URL). Fire-and-forget the activation; the reload lands on top.
      await activateWorkspace(config, workspaceId).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    const rootDir = newRoot.trim();
    if (!rootDir || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await registerWorkspace(config, { rootDir, ...(newName.trim() ? { name: newName.trim() } : {}) });
      setNewRoot('');
      setNewName('');
      setRegisterOpen(false);
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="workspace-switcher no-drag">
      <select
        className="workspace-switcher__select"
        value={state?.activeWorkspaceId ?? ''}
        onChange={(event) => {
          if (event.target.value === '__register__') {
            setRegisterOpen(true);
            setError(undefined);
            return;
          }
          if (event.target.value) void switchTo(event.target.value);
        }}
        disabled={busy}
        aria-label="切换工作区"
        title="切换工作区"
      >
        <option value="" disabled>{activeName ?? '工作区'}</option>
        {state?.workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
        ))}
        <option value="__register__">＋ 注册工作区…</option>
      </select>
      {registerOpen ? (
        <div className="workspace-register">
          <input
            value={newRoot}
            onChange={(event) => setNewRoot(event.target.value)}
            placeholder="项目目录，例如 D:\git\Idel-Game"
            spellCheck={false}
          />
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="显示名（可选）"
            spellCheck={false}
          />
          {error ? <p className="inline-error">{error}</p> : null}
          <div className="workspace-register__actions">
            <button className="button button--sm button--ghost" onClick={() => { setRegisterOpen(false); setError(undefined); }}>取消</button>
            <button className="button button--sm button--primary" onClick={() => void register()} disabled={busy || !newRoot.trim()}>
              注册
            </button>
          </div>
        </div>
      ) : (
        <div className="workspace-switcher__adds">
          <button className="workspace-switcher__add" onClick={() => { setRegisterOpen(true); setError(undefined); }} title="注册工作区" aria-label="注册工作区">＋</button>
          <button
            className="workspace-switcher__manage"
            onClick={() => setManageOpen((value) => !value)}
            title="管理工作区"
            aria-label="管理工作区"
          >⚙</button>
        </div>
      )}
      {manageOpen ? (
        <div className="workspace-manage">
          <strong className="workspace-manage__title">工作区</strong>
          {state?.workspaces.length === 0 ? (
            <p className="workspace-manage__empty">还没有注册工作区。</p>
          ) : (
            <ul className="workspace-manage__list">
              {state?.workspaces.map((workspace) => (
                <li key={workspace.id} className="workspace-manage__row">
                  <span
                    className={`workspace-manage__name ${workspace.id === state.activeWorkspaceId ? 'workspace-manage__name--active' : ''}`}
                    title={workspace.rootDir}
                  >
                    {workspace.name}
                    {workspace.id === state.activeWorkspaceId ? ' · 当前' : ''}
                  </span>
                  <button
                    className="workspace-manage__remove"
                    disabled={workspace.id === state.activeWorkspaceId || busy}
                    title={workspace.id === state.activeWorkspaceId ? '当前工作区不可移除' : '从列表移除（不删目录）'}
                    aria-label={`移除 ${workspace.name}`}
                    onClick={() => void remove(workspace.id)}
                  >×</button>
                </li>
              ))}
            </ul>
          )}
          {error ? <p className="inline-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
