import { useCallback, useEffect, useState } from 'react';
import type { MesaAgent, MesaWorkspace } from '@agentmesa/protocol';
import type { RuntimeConfig } from '../../types.js';
import {
  installIntegration,
  loadAgents,
  loadSetupStatus,
  loadWorkspaces,
  registerAgent,
  saveRunnerCommands,
  uninstallIntegration,
  type IntegrationSide,
  type RunnerSource,
  type SetupStatus,
} from '../../api.js';
import { Button } from '../ui/button.js';
import { SkeletonStack } from '../ui/skeleton.js';

const runnerSourceLabels: Record<RunnerSource, string> = {
  env: '环境变量',
  config: '工作区配置',
  stub: 'stub 演示模式',
};

const sideLabels: Record<IntegrationSide, { name: string; role: string }> = {
  claude: { name: 'Claude Code', role: 'builder · 实现与修复' },
  codex: { name: 'Codex', role: 'reviewer · 审核与测试' },
};

/** Agent 身份登记约定，与 `mesa agent add` 及 MCP 环境变量保持一致。 */
const sideAgentSpecs: Record<IntegrationSide, { id: string; name: string; client: string; roles: string[] }> = {
  claude: { id: 'agent:claude', name: 'Claude', client: 'claude', roles: ['builder'] },
  codex: { id: 'agent:codex', name: 'Codex', client: 'codex', roles: ['reviewer'] },
};

/** Runner 命令的环境变量键；env 优先于工作区配置。 */
const runnerEnvKeys: Record<IntegrationSide, string> = {
  claude: 'AGENTMESA_CLAUDE_CMD',
  codex: 'AGENTMESA_CODEX_CMD',
};

function DeployCard({
  side,
  status,
  busy,
  error,
  registered,
  onAct,
  onRegister,
}: {
  side: IntegrationSide;
  status: SetupStatus;
  busy?: string;
  error?: string;
  registered?: boolean;
  onAct: (kind: 'install' | 'uninstall', side: IntegrationSide) => void;
  onRegister: () => void;
}) {
  const s = status[side];
  const busyInstall = busy === `install:${side}`;
  const busyUninstall = busy === `uninstall:${side}`;
  const busyRegister = busy === `register:${side}`;
  return (
    <article className="deploy-card">
      <div className="deploy-card__heading">
        <strong>{sideLabels[side].name}</strong>
        <small>{sideLabels[side].role}</small>
      </div>
      <div className="deploy-card__row">
        <span>CLI</span>
        <strong className={s.cliAvailable ? 'deploy-ok' : 'deploy-warn'}>
          {s.cliAvailable ? '可用' : '未检测到'}
        </strong>
      </div>
      <div className="deploy-card__row">
        <span>MCP 服务器</span>
        <strong className={s.mcpInstalled ? 'deploy-ok' : 'deploy-warn'}>
          {s.mcpInstalled ? '已注册' : '未注册'}
        </strong>
      </div>
      <div className="deploy-card__row">
        <span>Agent 身份</span>
        <strong className={registered ? 'deploy-ok' : 'deploy-warn'}>
          {registered ? '已登记' : '未登记'}
        </strong>
      </div>
      <div className="deploy-card__row">
        <span>运行后端</span>
        <strong>{runnerSourceLabels[status.runnerSources[side]]}</strong>
      </div>
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="deploy-card__actions">
        <Button
          variant="primary"
          disabled={!s.cliAvailable || s.mcpInstalled || busyInstall || busyUninstall}
          title={s.cliAvailable ? '写入 CLI 的用户级 MCP 配置' : '请先在本机安装该 CLI'}
          onClick={() => onAct('install', side)}
        >
          {busyInstall ? '安装中…' : '注册 MCP'}
        </Button>
        <Button disabled={!s.mcpInstalled || busyInstall || busyUninstall} onClick={() => onAct('uninstall', side)}>
          {busyUninstall ? '移除中…' : '移除'}
        </Button>
        <Button
          disabled={registered || busyRegister || busyInstall || busyUninstall}
          title={registered ? '该 Agent 已登记到当前工作区' : '把 Agent 身份登记到当前工作区，会话/群聊即可直接邀请'}
          onClick={onRegister}
        >
          {busyRegister ? '登记中…' : registered ? '已登记' : '登记 Agent 身份'}
        </Button>
      </div>
    </article>
  );
}

export function DeployView({ config }: { config: RuntimeConfig }) {
  const [status, setStatus] = useState<SetupStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [sideError, setSideError] = useState<{ side: IntegrationSide; message: string }>();
  const [busy, setBusy] = useState<string>();
  const [claudeCmd, setClaudeCmd] = useState('');
  const [codexCmd, setCodexCmd] = useState('');
  const [saved, setSaved] = useState(false);
  const [envWarnings, setEnvWarnings] = useState<string[]>([]);
  const [activeWs, setActiveWs] = useState<MesaWorkspace>();
  const [agents, setAgents] = useState<MesaAgent[]>([]);

  const refresh = useCallback(async () => {
    try {
      const next = await loadSetupStatus(config);
      setStatus(next);
      setClaudeCmd(next.runners.claudeCmd ?? '');
      setCodexCmd(next.runners.codexCmd ?? '');
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    loadWorkspaces(config)
      .then((state) => setActiveWs(state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId)))
      .catch(() => undefined);
  }, [config]);

  useEffect(() => {
    loadAgents(config).then(setAgents).catch(() => undefined);
  }, [config]);

  const act = async (kind: 'install' | 'uninstall', side: IntegrationSide) => {
    setBusy(`${kind}:${side}`);
    setSideError(undefined);
    setSaved(false);
    try {
      if (kind === 'install') {
        await installIntegration(config, side);
      } else {
        await uninstallIntegration(config, side);
      }
      await refresh();
    } catch (reason) {
      setSideError({ side, message: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setBusy(undefined);
    }
  };

  const saveRunners = async () => {
    setBusy('runners');
    setError(undefined);
    setSideError(undefined);
    setSaved(false);
    try {
      // If an env var pins the command for a side, the workspace config is
      // shadowed — warn rather than silently claiming the save took effect.
      const claudeTrimmed = claudeCmd.trim();
      const codexTrimmed = codexCmd.trim();
      const warnings: string[] = [];
      if (claudeTrimmed && status?.runnerSources.claude === 'env') {
        warnings.push(`环境变量 ${runnerEnvKeys.claude} 优先，工作区命令不会生效`);
      }
      if (codexTrimmed && status?.runnerSources.codex === 'env') {
        warnings.push(`环境变量 ${runnerEnvKeys.codex} 优先，工作区命令不会生效`);
      }
      setEnvWarnings(warnings);
      await saveRunnerCommands(config, {
        claudeCmd: claudeTrimmed || null,
        codexCmd: codexTrimmed || null,
      });
      await refresh();
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const registerSide = async (side: IntegrationSide) => {
    setBusy(`register:${side}`);
    setSideError(undefined);
    setSaved(false);
    try {
      const spec = sideAgentSpecs[side];
      await registerAgent(config, {
        id: spec.id,
        name: spec.name,
        client: spec.client,
        roles: spec.roles,
      });
      setAgents(await loadAgents(config));
    } catch (reason) {
      setSideError({ side, message: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setBusy(undefined);
    }
  };

  if (!loading && error) {
    return (
      <div className="error-state">
        <strong>无法加载部署状态</strong>
        <p>{error}</p>
        <Button variant="primary" onClick={() => { setLoading(true); void refresh(); }}>重试</Button>
      </div>
    );
  }

  if (loading || !status) {
    return <SkeletonStack count={2} />;
  }

  return (
    <>
      <div className="deploy-mcp-scope">
        <span className="deploy-mcp-scope__dot" />
        <p>
          MCP 当前生效于：<strong>{activeWs ? activeWs.name : '当前工作区'}</strong>
          {activeWs ? `（${activeWs.rootDir}）` : ''}
          <small>切换工作区后，未固定 AGENTMESA_WORKSPACE 的 Agent 会话会跟随新的激活工作区。</small>
        </p>
        <Button
          small
          onClick={() => { setLoading(true); void refresh(); }}
          disabled={busy === 'reprobe'}
          title="重新探测 CLI 与 MCP 注册状态"
        >
          重新探测
        </Button>
      </div>

      <section className="content-block">
        <div className="section-heading">
          <span>Agent CLI 集成</span>
          <small>MCP 是连接通道，Agent 身份登记让会话/群聊立即可邀</small>
        </div>
        <p className="deploy-note">
          <strong>注册 MCP</strong> 让该 CLI 的会话能调用 mesa 工具；
          <strong>登记 Agent 身份</strong> 把该 Agent 写进当前工作区，新建会话与群聊拉人时可直接选中。
          CLI 未安装也可先登记身份，等会话上线后自动桥接。
        </p>
        <div className="deploy-grid">
          {(['claude', 'codex'] as const).map((side) => (
            <DeployCard
              key={side}
              side={side}
              status={status}
              busy={busy}
              error={sideError?.side === side ? sideError.message : undefined}
              registered={agents.some((agent) => agent.id === sideAgentSpecs[side].id)}
              onAct={act}
              onRegister={() => void registerSide(side)}
            />
          ))}
        </div>
      </section>

      <section className="content-block">
        <div className="section-heading">
          <span>运行后端命令</span>
          <small>工作区级配置（.agentmesa/config.json）——与用户级 MCP 注册相互独立</small>
        </div>
        <p className="deploy-note">
          MCP 注册写入 CLI 的用户级配置（<code>~/.claude.json</code> / <code>~/.codex/config.toml</code>），对每个 Agent 会话全局生效；
          这里的运行命令只作用于当前工作区，留空则回退到环境变量或 stub 演示模式。
        </p>
        <div className="deploy-form">
          <label>
            Claude 命令（builder）
            <input
              value={claudeCmd}
              onChange={(event) => { setClaudeCmd(event.target.value); setSaved(false); setEnvWarnings([]); }}
              placeholder="例如 claude -p"
              spellCheck={false}
            />
            {status.runnerSources.claude === 'env' ? (
              <span className="deploy-source-hint deploy-source-hint--warn">
                环境变量 {runnerEnvKeys.claude} 当前优先，工作区命令不会生效
              </span>
            ) : null}
          </label>
          <label>
            Codex 命令（reviewer）
            <input
              value={codexCmd}
              onChange={(event) => { setCodexCmd(event.target.value); setSaved(false); setEnvWarnings([]); }}
              placeholder="例如 codex exec -"
              spellCheck={false}
            />
            {status.runnerSources.codex === 'env' ? (
              <span className="deploy-source-hint deploy-source-hint--warn">
                环境变量 {runnerEnvKeys.codex} 当前优先，工作区命令不会生效
              </span>
            ) : null}
          </label>
          {envWarnings.length > 0 ? (
            <p className="deploy-source-hint deploy-source-hint--warn">
              {envWarnings.join('；')}
            </p>
          ) : null}
          {error ? <p className="inline-error">{error}</p> : null}
          {saved ? <p className="deploy-saved">已保存到工作区配置</p> : null}
          <div>
            <Button variant="primary" disabled={busy === 'runners'} onClick={() => void saveRunners()}>
              {busy === 'runners' ? '保存中…' : '保存命令'}
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
