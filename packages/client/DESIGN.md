# AgentMesa Client — DESIGN.md

> 2026-08-12 聊天外壳落地后的设计系统文档。方向以 `index.html` 内钉选的
> DIRECTION CONTRACT 为唯一 canon；本文是它的展开与 finish review 记录。

## 1. 方向契约（摘要）

- **THESIS**：AgentMesa 是「AI agents 像同事一样协作的群聊」，不是霓虹 AI 监控台。
  骨架取飞书/QQ 聊天软件文法（三栏 / 会话列表 / 气泡 / 未读角标）。
- **OWN-WORLD**：Apple 语义 token 体系；签名色 teal（浅 `#30B0C7` / 暗 `#64D2FF`）；
  红橙绿锁定为状态色；扁平哑光、无发光、无渐变品牌面。
- **FIRST VIEWPORT**：三栏 IM 外壳——左=统一会话列表（未读角标），
  中=聊天主区（气泡 / 日期分隔 / 输入区），右=上下文面板（任务 / 运行 / 文件）。
- **FORM**：飞书/QQ 语法 × Apple token，用户钉选，no roll。

## 2. Token 架构（styles/tokens.css）

三层结构，组件只消费 Tier 2/3：

| 层 | 前缀 | 内容 |
| --- | --- | --- |
| Tier 1 Primitive | `--prim-*` | teal 色阶 + Apple system 状态色成对值 |
| Tier 2 Semantic | `--color-*` / `--text-*` / `--space-*` / `--radius-*` / `--shadow-*` / `--motion-*` | label/bg/separator/fill 语义族；浅色为 `:root` 默认，`[data-theme="dark"]` 成对覆盖 |
| Tier 3 Component | `--size-*` / `--bubble-*` / `--width-chat-content` | 聊天外壳布局常量（栏宽 280/320、气泡半径 16、气泡最大宽 62%） |

**主题机制**：`<html data-theme="light|dark">`，浅色为默认（index.html）。
迁移期遗留的 LEGACY 冻结变量块（`--bg/--panel/--line/--muted/--accent(紫)/--accent-2/--warning/--danger`）
已于外壳落地后整块删除；全仓 grep 零引用为删除前提。旧紫色品牌 `#8b7cff` 系列已全部退场。

## 3. 外壳语法（styles.css + App.tsx）

### 3.1 栅格

```
"title title title"
"conv  chat  ctx"
"status status status"
```

- 左栏 `--size-conv-list`（窄屏退到 `--size-conv-list-min`，右栏 <1000px 隐藏）；
- 中栏聊天内容列 `--width-chat-content: 800px` 居中；
- 无打开会话/部署页/新建页时 `--noctx` 两栏。

### 3.2 左栏 · 统一会话列表

- meetings（会话）与 rooms（群聊）合并为一张列表，按最后活动降序；
- 行：头像区（会话=参与者 AgentStack；群聊=teal 群气泡 glyph）+ 标题/时间 + 预览/成员数 + 未读角标；
- 未读角标 = `--color-unread`（红）+ 白字，IM 品类语法；纯客户端内存态，
  打开即清零，基线为挂载时最新事件（不追溯历史）；
- 头部两个入口：＋会话 / ＋群聊（新建视图渲染在中栏）；
- 底部「部署与集成」进入 `#/deploy`（取代旧 rail）。

### 3.3 中栏 · 聊天流

- **气泡**（iMessage 文法）：他人左、灰泡 `--color-bubble-other`，带发送者头像 +
  meta 行（名字 / 类型 chip / 时间）；自己右、teal 泡 `--color-bubble-own`。
  自己 = `user:*` 固定人类 actor（desk 默认 `user:desk`，桌面端 `user:desktop`；
  发送者不可伪造——P0 约束）；`system` 渲染为居中系统行。
- **日期分隔**：今天 / 昨天 / M月D日（跨年带年），居中 pill。
- **流内卡片**：本会话任务的待审批以 `ApprovalCard` 入流，参与 Agent 的活动运行以
  紧凑 `RunCard` 入流——工作 artifact，一键处理，符合 STORY。
- **输入区**：自动增高 textarea；Enter 发送、Shift+Enter 换行。
- **消息体**：`body` 以等宽 inset 代码块附于摘要下方。

### 3.4 右栏 · 上下文面板

- 会话：参与 Agent 卡（头像/roles/工作中·CLI 状态/移出）、结束·归档、
  任务（状态 select + 新建）、运行（最近 6，点开 RunDetailView）、
  文件（meeting/task 关联 artifacts，可展开内容）；
- 群聊：成员列表（kind 徽章 + 移出）、拉群（工作区 → 成员类型 → 拉入）。

### 3.5 其余表面

- **titlebar**：品牌（扁平 teal M）+ 工作区切换器 + 连接徽标 + 窗口控制；
- **statusbar**：连接 + 运行/待审批/工作流计数；
- **widget**（tray）：保留原形态，换肤到 token（elevation 靠 `--shadow-*`，无发光）；
- **deploy**：内容不变，卡片/表单 token 化，成功/警告用 status 语义色。

## 4. 动效

- 实时到达项 `msg-in`（120–200ms，`--ease-out`，translateY 4px→0），
  覆盖气泡 / 流内卡片 / 系统行 / 审批卡；
- 按压反馈 `scale(0.97)`（按钮、会话行、agent-pick 等）；
- 弹层（工作区管理/注册）`@starting-style` 入场；
- 全部尊重 `prefers-reduced-motion`；running 状态点保留 pulse。

## 5. 退役清单

rail 与六宫格导航、overview/runs/workflows 区块、metric-grid、
activity 事件面板与过滤器、WorkflowDetailView、SessionCard 网格、
旧 timeline/room-msg 平铺行、back-row、LEGACY 变量块、`--size-rail`。
hash 路由保留 `#/sessions/:id`、`#/rooms/:id`、`#/deploy` 深链兼容。

## 6. 实时架构

SSE 收敛为 2 条：`useMesaRuntime` 全局事件流（所有视图共享）+ 外壳级 room 流
（覆盖全部群聊的未读与刷新）。会话流的 live refresh 改骑全局流的
`message_sent`/task 事件（游标增量扫描），不再私开第二条流。

## 7. 验证矩阵（2026-08-12）

| 项 | 结果 |
| --- | --- |
| 全仓 typecheck（16 包） | ✅ 通过 |
| client vite build | ✅ 通过 |
| 全仓测试（含 desktop E2E smoke） | ✅ 通过（shell connector 曾在全量并行下 OOM，隔离复跑 22/22 通过，判定环境内存压力） |
| E2E：widget 收起/展开、主窗口外壳 | ✅ 截图确认（浅色） |
| E2E：会话聊天（自有气泡 + 今日分隔 + 上下文四区） | ✅ 断言 + 截图确认 |
| E2E：暗色同屏 parity | ✅ 截图确认（token 成对生效，无紫色残留） |
| E2E：群聊视图（实时指示 + 成员/拉群面板） | ✅ 断言 + 截图确认 |
| 未读角标实时渲染 | ⚠️ 未验证（逻辑已评审；需第二发送者在线触发，E2E 未覆盖） |
| 文件区真实产物渲染 | ⚠️ 未验证（空态已验证；需含 artifacts 的会话数据） |

## 8. Finish review · verdict

**有条件通过。**

- 通过项：FIRST VIEWPORT 三栏文法完整落地；浅色默认 + 暗色成对；签名 teal 与
  状态色语义锁定；旧监控台品类（rail/指标卡/事件流面板/紫发光）全数退场；
  P0 发送者约束在新气泡模型中保持并修正了旧 UI 把人类消息标成「系统」的缺陷。
- 条件项：第 7 节两条 ⚠️ 未验证项需在真实协作数据下补验；补验不阻塞合入，
  但不得在补验前宣称未读与文件区「已验证」。
