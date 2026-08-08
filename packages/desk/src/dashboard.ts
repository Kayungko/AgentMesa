export function generateDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentMesa 工作台</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect x='2' y='2' width='60' height='60' rx='14' fill='%238B7CFF'/%3E%3Cpath d='M15 47 L24 32 L40 32 L49 47 Z' fill='white'/%3E%3Ccircle cx='32' cy='21' r='4.5' fill='white'/%3E%3C/svg%3E">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      line-height: 1.6;
      padding: 2rem;
    }

    .header {
      text-align: center;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #30363d;
    }

    .header h1 {
      color: #58a6ff;
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    .header .subtitle {
      color: #8b949e;
      font-size: 0.9rem;
    }

    .refresh-btn {
      margin-top: 0.9rem;
      padding: 0.35rem 1.1rem;
      background: #21262d;
      color: #c9d1d9;
      border: 1px solid #30363d;
      border-radius: 6px;
      font-size: 0.85rem;
      cursor: pointer;
    }

    .refresh-btn:hover {
      background: #30363d;
      border-color: #58a6ff;
    }

    .summary-card {
      margin-bottom: 1.5rem;
    }

    #task-board, #meeting-timeline, #agent-status, #artifacts,
    #agent-runs, #workflows, #handoffs, #check-results {
      max-height: 420px;
      overflow-y: auto;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }

    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.5rem;
    }

    .card h2 {
      color: #58a6ff;
      font-size: 1.2rem;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #30363d;
    }

    .item {
      padding: 0.75rem;
      margin-bottom: 0.5rem;
      background: #0d1117;
      border-radius: 4px;
      border-left: 3px solid #30363d;
    }

    .item:last-child {
      margin-bottom: 0;
    }

    .item-title {
      font-weight: 600;
      color: #f0f6fc;
      margin-bottom: 0.25rem;
    }

    .item-meta {
      font-size: 0.85rem;
      color: #8b949e;
    }

    .badge {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .badge-todo { background: #6e7681; color: #fff; }
    .badge-in_progress { background: #1f6feb; color: #fff; }
    .badge-ready_for_review { background: #8957e5; color: #fff; }
    .badge-reviewing { background: #d29922; color: #fff; }
    .badge-approved { background: #238636; color: #fff; }
    .badge-done { background: #238636; color: #fff; }
    .badge-blocked { background: #da3633; color: #fff; }
    .badge-failed { background: #f85149; color: #fff; }
    .badge-cancelled { background: #6e7681; color: #fff; }
    .badge-changes_requested { background: #d29922; color: #fff; }
    .badge-conflict { background: #f85149; color: #fff; }
    .badge-needs_user_decision { background: #d29922; color: #fff; }

    .badge-open { background: #238636; color: #fff; }
    .badge-closed { background: #6e7681; color: #fff; }
    .badge-archived { background: #30363d; color: #fff; }

    .badge-pending { background: #6e7681; color: #fff; }
    .badge-running { background: #1f6feb; color: #fff; }
    .badge-completed { background: #238636; color: #fff; }
    .badge-passed { background: #238636; color: #fff; }
    .badge-error { background: #f85149; color: #fff; }
    .badge-skipped { background: #6e7681; color: #fff; }
    .badge-waiting_approval { background: #d29922; color: #fff; }
    .badge-paused { background: #6e7681; color: #fff; }
    .badge-processed { background: #238636; color: #fff; }

    .badge-role {
      background: #30363d;
      color: #c9d1d9;
      margin-right: 0.25rem;
      margin-bottom: 0.25rem;
    }

    .empty {
      color: #6e7681;
      font-style: italic;
      padding: 1rem;
      text-align: center;
    }

    .status-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
      gap: 0.75rem;
    }

    .stat {
      text-align: center;
      padding: 1rem;
      background: #0d1117;
      border-radius: 4px;
    }

    .stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: #58a6ff;
    }

    .stat-label {
      font-size: 0.8rem;
      color: #8b949e;
      margin-top: 0.25rem;
    }

    .refresh-indicator {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      padding: 0.5rem 1rem;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 4px;
      font-size: 0.8rem;
      color: #8b949e;
    }

    @media (max-width: 768px) {
      .grid {
        grid-template-columns: 1fr;
      }

      body {
        padding: 1rem;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>AgentMesa 工作台</h1>
    <div class="subtitle">本地工作区监控 · 每 30 秒自动刷新</div>
    <button id="refresh-btn" class="refresh-btn" type="button">刷新</button>
  </div>

  <div class="card summary-card">
    <h2>工作区概览</h2>
    <div id="status-summary">
      <div class="empty">正在加载概览...</div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>任务看板</h2>
      <div id="task-board">
        <div class="empty">正在加载任务...</div>
      </div>
    </div>

    <div class="card">
      <h2>会议时间线</h2>
      <div id="meeting-timeline">
        <div class="empty">正在加载会议...</div>
      </div>
    </div>

    <div class="card">
      <h2>Agent 状态</h2>
      <div id="agent-status">
        <div class="empty">正在加载 Agent...</div>
      </div>
    </div>

    <div class="card">
      <h2>产出物</h2>
      <div id="artifacts">
        <div class="empty">正在加载产出物...</div>
      </div>
    </div>

    <div class="card">
      <h2>Agent 运行</h2>
      <div id="agent-runs">
        <div class="empty">正在加载运行记录...</div>
      </div>
    </div>

    <div class="card">
      <h2>工作流</h2>
      <div id="workflows">
        <div class="empty">正在加载工作流...</div>
      </div>
    </div>

    <div class="card">
      <h2>交接</h2>
      <div id="handoffs">
        <div class="empty">正在加载交接记录...</div>
      </div>
    </div>

    <div class="card">
      <h2>检查结果</h2>
      <div id="check-results">
        <div class="empty">正在加载检查结果...</div>
      </div>
    </div>
  </div>

  <div class="refresh-indicator" id="refresh-indicator">
    上次刷新：从未
  </div>

  <script>
    async function fetchJson(url) {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
      } catch (e) {
        console.error('Fetch error:', e);
        return null;
      }
    }

    function renderTasks(tasks) {
      const el = document.getElementById('task-board');
      if (!tasks) {
        el.innerHTML = '<div class="empty">加载失败，请检查服务连接</div>';
        return;
      }
      if (tasks.length === 0) {
        el.innerHTML = '<div class="empty">暂无任务</div>';
        return;
      }

      el.innerHTML = tasks.map(task => \`
        <div class="item">
          <div class="item-title">\${task.title}</div>
          <div class="item-meta">
            <span class="badge badge-\${task.status.replace(/ /g, '_')}">\${task.status}</span>
            <span>ID：\${task.id}</span>
            \${task.assignedTo ? ' | 负责人：' + task.assignedTo : ''}
          </div>
        </div>
      \`).join('');
    }

    function renderMeetings(meetings) {
      const el = document.getElementById('meeting-timeline');
      if (!meetings) {
        el.innerHTML = '<div class="empty">加载失败，请检查服务连接</div>';
        return;
      }
      if (meetings.length === 0) {
        el.innerHTML = '<div class="empty">暂无会议</div>';
        return;
      }

      el.innerHTML = meetings.map(meeting => \`
        <div class="item">
          <div class="item-title">\${meeting.title}</div>
          <div class="item-meta">
            <span class="badge badge-\${meeting.status}">\${meeting.status}</span>
            <span>ID：\${meeting.id}</span>
            <span> | 任务数：\${meeting.tasks.length}</span>
            <span> | Agent 数：\${meeting.agents.length}</span>
          </div>
        </div>
      \`).join('');
    }

    function renderAgents(agents) {
      const el = document.getElementById('agent-status');
      if (!agents) {
        el.innerHTML = '<div class="empty">加载失败，请检查服务连接</div>';
        return;
      }
      if (agents.length === 0) {
        el.innerHTML = '<div class="empty">暂无已注册 Agent</div>';
        return;
      }

      el.innerHTML = agents.map(agent => \`
        <div class="item">
          <div class="item-title">\${agent.name}</div>
          <div class="item-meta">
            <span>客户端：\${agent.client}</span>
            <span> | 角色：</span>
            \${agent.roles.map(r => '<span class="badge badge-role">' + r + '</span>').join('')}
          </div>
        </div>
      \`).join('');
    }

    function renderArtifacts(artifacts) {
      const el = document.getElementById('artifacts');
      if (!artifacts) {
        el.innerHTML = '<div class="empty">加载失败，请检查服务连接</div>';
        return;
      }
      if (artifacts.length === 0) {
        el.innerHTML = '<div class="empty">暂无产出物</div>';
        return;
      }

      el.innerHTML = artifacts.map(artifact => \`
        <div class="item">
          <div class="item-title">产出物 \${artifact.id}</div>
          <div class="item-meta">
            <span class="badge badge-role">\${artifact.kind}</span>
            \${artifact.format ? '<span class="badge badge-role">' + artifact.format + '</span>' : ''}
            <span> | 创建者：\${artifact.createdBy}</span>
          </div>
        </div>
      \`).join('');
    }

    function renderRuns(runs) {
      const el = document.getElementById('agent-runs');
      if (!runs) {
        el.innerHTML = '<div class="empty">加载失败，请检查服务连接</div>';
        return;
      }
      if (runs.length === 0) {
        el.innerHTML = '<div class="empty">暂无 Agent 运行记录</div>';
        return;
      }

      el.innerHTML = runs.map(run => \`
        <div class="item">
          <div class="item-title">\${run.action} — \${run.agentId}</div>
          <div class="item-meta">
            <span class="badge badge-\${run.status}">\${run.status}</span>
            <span>ID：\${run.id}</span>
            \${run.taskId ? ' | 任务：' + run.taskId : ''}
          </div>
        </div>
      \`).join('');
    }

    function renderWorkflows(workflows) {
      const el = document.getElementById('workflows');
      if (!workflows) {
        el.innerHTML = '<div class="empty">加载失败，请检查服务连接</div>';
        return;
      }
      if (workflows.length === 0) {
        el.innerHTML = '<div class="empty">暂无工作流</div>';
        return;
      }

      el.innerHTML = workflows.map(wf => \`
        <div class="item">
          <div class="item-title">\${wf.workflowDefinitionId}</div>
          <div class="item-meta">
            <span class="badge badge-\${wf.status}">\${wf.status}</span>
            <span>步骤：\${wf.currentStep}</span>
            <span> | 任务：\${wf.taskId}</span>
          </div>
        </div>
      \`).join('');
    }

    function renderHandoffs(handoffs) {
      const el = document.getElementById('handoffs');
      if (!handoffs) {
        el.innerHTML = '<div class="empty">加载失败，请检查服务连接</div>';
        return;
      }
      const all = [...handoffs.outbound, ...handoffs.inbound];
      if (all.length === 0) {
        el.innerHTML = '<div class="empty">暂无交接记录</div>';
        return;
      }

      el.innerHTML = all.map(h => \`
        <div class="item">
          <div class="item-title">\${h.type}</div>
          <div class="item-meta">
            <span class="badge badge-\${h.status}">\${h.status}</span>
            <span>任务：\${h.taskId}</span>
            <span> | \${h.direction}</span>
          </div>
        </div>
      \`).join('');
    }

    function renderChecks(checks) {
      const el = document.getElementById('check-results');
      if (!checks) {
        el.innerHTML = '<div class="empty">加载失败，请检查服务连接</div>';
        return;
      }
      if (checks.length === 0) {
        el.innerHTML = '<div class="empty">暂无检查结果</div>';
        return;
      }

      el.innerHTML = checks.map(check => \`
        <div class="item">
          <div class="item-title">\${check.checkName}</div>
          <div class="item-meta">
            <span class="badge badge-\${check.status}">\${check.status}</span>
            <span class="badge badge-role">\${check.kind}</span>
            <span> | 任务：\${check.taskId}</span>
          </div>
        </div>
      \`).join('');
    }

    function renderStatus(status) {
      const el = document.getElementById('status-summary');
      if (!status) {
        el.innerHTML = '<div class="empty">无法加载概览</div>';
        return;
      }

      el.innerHTML = \`
        <div class="status-summary">
          <div class="stat">
            <div class="stat-value">\${status.tasks}</div>
            <div class="stat-label">任务</div>
          </div>
          <div class="stat">
            <div class="stat-value">\${status.meetings}</div>
            <div class="stat-label">会议</div>
          </div>
          <div class="stat">
            <div class="stat-value">\${status.agents}</div>
            <div class="stat-label">Agent</div>
          </div>
          <div class="stat">
            <div class="stat-value">\${status.artifacts}</div>
            <div class="stat-label">产出物</div>
          </div>
          <div class="stat">
            <div class="stat-value">\${status.runs}</div>
            <div class="stat-label">运行</div>
          </div>
          <div class="stat">
            <div class="stat-value">\${status.checks}</div>
            <div class="stat-label">检查</div>
          </div>
          <div class="stat">
            <div class="stat-value">\${status.handoffs}</div>
            <div class="stat-label">交接</div>
          </div>
        </div>
      \`;
    }

    async function refresh() {
      document.getElementById('refresh-indicator').textContent = '刷新中…';
      const [tasks, meetings, agents, artifacts, runs, workflows, handoffs, checks, status] = await Promise.all([
        fetchJson('/api/tasks'),
        fetchJson('/api/meetings'),
        fetchJson('/api/agents'),
        fetchJson('/api/artifacts'),
        fetchJson('/api/runs'),
        fetchJson('/api/workflows'),
        fetchJson('/api/handoffs'),
        fetchJson('/api/checks'),
        fetchJson('/api/status'),
      ]);

      renderTasks(tasks);
      renderMeetings(meetings);
      renderAgents(agents);
      renderArtifacts(artifacts);
      renderRuns(runs);
      renderWorkflows(workflows);
      renderHandoffs(handoffs);
      renderChecks(checks);
      renderStatus(status);

      const now = new Date().toLocaleTimeString();
      document.getElementById('refresh-indicator').textContent = '上次刷新：' + now;
    }

    document.getElementById('refresh-btn').addEventListener('click', () => {
      void refresh();
    });

    refresh();
    setInterval(refresh, 30000);
  </script>
</body>
</html>`;
}
