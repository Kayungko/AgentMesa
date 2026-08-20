# AgentMesa Client — DESIGN.md

> 2026-08-13 视觉世界替换落地后的设计系统文档。方向以 `index.html` 内钉选的
> DIRECTION CONTRACT 为唯一 canon；本文是它的展开与 finish review 记录。

## 1. 方向契约（摘要）

- **THESIS**：AgentMesa 是「AI agents 像同事一样协作的群聊」。
- **OWN-WORLD**：白底中性墨色语言，**无全局主题色**；语义色只承载状态/未读/头像底/进度；
  桌面密度 IM 文法；3D Fluent Emoji 头像；Phosphor 图标；发丝线 + 右向投影分栏。
- **FIRST VIEWPORT**：72px 图标 rail + 会话面板 + 聊天面板；状态上下文默认收起的右栏抽屉；
  新建会话/群聊为 modal。
- **FORM**：飞书/QQ 聊天软件文法 × 中性墨色 token，用户钉选，no roll。

## 2. Token 架构（styles/tokens.css）

三层结构，组件只消费 Tier 2/3，`scripts/detect.mjs` 机器强制：

| 层 | 前缀 | 内容 |
| --- | --- | --- |
| Tier 1 Primitive | `--prim-*` | 墨色阶、暗面阶、状态色成对、头像 accent 底成对（仅本文件内部引用） |
| Tier 2 Semantic | `--color-*` / `--shadow-*` | text/surface/line/focus/control/bubble/unread/avatar-accent 语义族；浅色为 `:root`，`[data-theme="dark"]` 成对覆盖 |
| Tier 3 Component | `--size-*` / `--text-*` / `--radius-*` / `--motion-*` / `--font-*` / `--space-*` | 栏宽/控件尺寸/字号阶/圆角阶/动效时长/字体栈/间距 |

**主题机制**：`<html data-theme="light|dark">`，浅色为默认（index.html）。暗色按 Apple 语义方式成对：
表面明度分层（`#1f2328/#17191d/#121417`）、文本反白、语义色提亮、气泡暗底 `#16304a`。

**纪律**（detect.mjs 强制）：
- 组件 CSS 禁裸 hex / `rgb()` / `rgba()` / `hsl()` 颜色值；
- 禁引用 `--prim-*`；
- 图标禁内联 `<svg>`，一律走 `components/ui/icons.ts`（Phosphor 单一导入点）。

## 3. 外壳语法

```
"rail" | "titlebar"          (titlebar 在 shell-body 顶部，rail 全高在左)
"rail" | "conv  chat  [drawer]"   (drawer 为布局第三列，条件渲染)
"rail" | "statusbar"
```

- **rail**（72px，920px→60，760px→56）：五入口（消息/Agent/任务/审批/归档，40px 目标 + 20px 图标）
  + 底部齿轮（部署与集成）；无右边框，右向 `--shadow-rail` 分栏；消息入口带未读角标、审批入口带警示点。
- **会话面板**（264px）：搜索 + 新建会话/建群两个 IconButton；meeting/room 合并按最后活动降序；
  行头像 = 参与者 AvatarStack（room = UsersThree + accent 底）；选中 = 底 + 左 2px 墨色竖条。
- **聊天主区**：气泡无边框，agent 灰泡 `--color-bubble-agent`（圆角 `5px 10px 10px 10px`），
  自己 `--color-bubble-self`（镜像圆角）；消息 13px；流内审批/运行卡片；composer 随列宽。
- **状态抽屉**（292px）：右栏上下文，默认收起，头部「详情」按钮开、Esc/关闭钮关；
  **布局第三列而非绝对定位**——绝对定位抽屉会让透明窗口丢失聊天流绘制层（Chromium 合成 bug）。
  内容 = 参与 Agent / 任务 / 运行 / 文件（群聊 = 成员 / 拉群）。
- **titlebar**（40px）：桌面无边框窗口自绘 chrome——brand + WorkspaceSwitcher + ConnectionBadge + 窗口控制。

## 4. 模块树（src/components/**，样式共置）

| 目录 | 文件 | 职责 |
| --- | --- | --- |
| `shell/` | route / app-shell / rail / titlebar / statusbar / toast / workspace-switcher | 路由 + 双 SSE 流 + 外壳骨架 |
| `conv/` | conversation-list / conv-row | 会话列表 |
| `chat/` | hooks / meeting-chat / room-chat / chat-header / bubbles / divider / composer / status-drawer / task-form / empty | 聊天流 + 抽屉 |
| `views/` | agents / tasks / approvals / archive / view-page | rail 四入口真实视图 |
| `dialog/` | modal / create-session / create-room | 新建模态 |
| `ui/` | avatar / icon-button / button / search / semantic-dot / progress / empty / skeleton / badge / use-fresh-members / format / icons | 原子基元 |
| `cards/` | run-card / approval-card / run-detail-view | 运行/审批/详情卡 |
| `deploy/` | deploy-view | 部署与集成 |
| `widget/` | widget-view | tray widget |

数据层零改动：`api.ts`、`useMesaRuntime.ts`、`types.ts`、SSE 双流（全局流 + room 流）、未读基线、hash 路由。

## 5. 动效

- 实时到达 `msg-in`（180ms `--ease-out`，translateY 4px→0）覆盖气泡/流内卡/系统行/审批卡；
- 按压 `scale(0.96–0.98)`（icon-button 0.96、button 0.97、卡片 0.98）；
- drawer/modal 入场（180ms ease-out）；`prefers-reduced-motion` 全量降级。

## 6. 退役清单

teal 签名色（`#30B0C7`/`#64D2FF`）与 `--color-accent` 族、`--color-label` 族、旧 `--color-bg/sidebar/context`
语义、旧三栏（`ctx-panel` 常驻栏）、`styles.css` 单文件、`ui.tsx`/`cards.tsx`/`WidgetView.tsx`/`DeployView.tsx`/
`WorkspaceSwitcher.tsx` 平铺模块、`RoomGlyph` 内联 SVG、`AgentMark`/`AgentStack`（并入 `Avatar`/`AvatarStack`）、
container queries（透明窗口合成 bug，改为 `@media` 窗口级断点）。

## 7. 验证矩阵（2026-08-13）

| 项 | 结果 |
| --- | --- |
| client typecheck + vite build | ✅ 通过（phosphor 增量 ~15KB gzip） |
| desktop smoke E2E（widget 收起/展开、主窗口、modal、会话聊天发气泡、日期分隔、drawer、暗色 parity、rooms） | ✅ 通过（4.6s） |
| tokens:detect | ✅ 退出 0（零裸色、零 --prim- 引用、零内联 svg） |
| 浅色/暗色成对截图 | ✅ 主窗口/会话/drawer/widget 逐屏确认 |
| 透明窗口合成 bug | ✅ 定位并修复（绝对定位抽屉 → 布局第三列；container-type 移除） |

## 8. Finish review · verdict

**通过。**

视觉世界替换完整落地：白底中性墨色、rail 五入口接真实数据、会话/聊天/抽屉/modal/四视图/deploy/widget
全部重画并模块化；严格三层 token + detect.mjs 机器强制；暗色对偶成对覆盖；数据层零改动、smoke 契约类名保留。
唯一超出原计划的技术修正（绝对定位抽屉触发透明窗口 Chromium 合成 bug → 布局列）已记录在案并带 E2E 佐证。
