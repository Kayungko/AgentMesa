---
name: "AgentMesa Client"
description: "AI agents 像同事一样协作的桌面 IM——Notion warm-paper editorial 重塑：暖纸画布 + 白卡片浮层 + Notion 蓝单一主色 + Inter 主字体。"
colors:
  control-primary: "#0075de"
  control-primary-hover: "#097fe8"
  control-on: "#ffffff"
  text: "#191a1b"
  text-muted: "#615d59"
  text-subtle: "#757575"
  surface: "#f6f5f4"
  surface-secondary: "#ffffff"
  surface-tertiary: "#e6f3fe"
  surface-hover: "#eeedec"
  surface-selected: "#e6f3fe"
  surface-overlay: "#ffffff"
  line: "rgba(0, 0, 0, 0.08)"
  line-strong: "rgba(0, 0, 0, 0.16)"
  bubble-agent: "#ffffff"
  bubble-on-agent: "#191a1b"
  bubble-self: "#e6f3fe"
  bubble-on-self: "#173b63"
  status-red: "#e32d14"
  status-amber: "#e89d01"
  status-green: "#22a06b"
  status-blue: "#0075de"
  status-red-soft: "rgba(227, 45, 20, 0.08)"
  status-amber-soft: "rgba(232, 157, 1, 0.10)"
  status-green-soft: "rgba(34, 160, 107, 0.10)"
  status-blue-soft: "rgba(0, 117, 222, 0.10)"
  focus-ring: "#0075de"
  scrim: "rgba(17, 17, 17, 0.22)"
  avatar-orange: "#fff3e8"
  avatar-blue: "#e8f2fe"
  avatar-green: "#e9f6ef"
  avatar-violet: "#f2eefe"
  avatar-slate: "#f1f3f5"
typography:
  headline:
    fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.04em"
  mono:
    fontFamily: "ui-monospace, 'Cascadia Mono', 'SF Mono', Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  full: "999px"
  bubble-agent: "5px 10px 10px 10px"
  bubble-self: "10px 10px 10px 5px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.control-primary}"
    textColor: "{colors.control-on}"
    rounded: "8px"
    padding: "0 12px"
    height: "32px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.control-primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface-overlay}"
    textColor: "{colors.text}"
    rounded: "8px"
    padding: "0 12px"
    height: "32px"
  button-danger:
    backgroundColor: "{colors.status-red-soft}"
    textColor: "{colors.status-red}"
    rounded: "8px"
    padding: "0 12px"
    height: "32px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "8px"
    size: "32px"
  search-field:
    backgroundColor: "{colors.surface-overlay}"
    textColor: "{colors.text}"
    rounded: "8px"
    height: "34px"
  bubble-agent:
    backgroundColor: "{colors.bubble-agent}"
    textColor: "{colors.bubble-on-agent}"
    rounded: "{rounded.bubble-agent}"
    padding: "8px 10px"
    typography: "{typography.body}"
  bubble-self:
    backgroundColor: "{colors.bubble-self}"
    textColor: "{colors.bubble-on-self}"
    rounded: "{rounded.bubble-self}"
    padding: "8px 10px"
    typography: "{typography.body}"
  send-button:
    backgroundColor: "{colors.control-primary}"
    textColor: "{colors.control-on}"
    rounded: "8px"
    size: "30px"
  status-chip:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.text-muted}"
    rounded: "999px"
    padding: "2px 8px"
  approval-card:
    backgroundColor: "{colors.status-amber-soft}"
    rounded: "10px"
    padding: "12px"
---

# Design System: AgentMesa Client

## Overview

**Creative North Star: "The Colleague Group Chat"（同事群聊）**

AgentMesa 是「AI agents 像同事一样协作的群聊」。界面不把 agents 渲染成仪表盘上的数据点，而是渲染成群里的同事：头像、发言气泡、实时落进流里的卡片。整个视觉世界是一张午后阳光下的暖纸——Notion warm-paper editorial：整页 `#f6f5f4` 暖纸画布上浮着纯白卡片与气泡，Notion 蓝 `#0075de` 是唯一的动作色（主按钮、发送钮、激活态、信息链接）；语义色只承载状态/未读/头像底/进度。装饰不承载语义就不存在。

形态文法是桌面密度 IM（飞书/QQ 品类文法 × Notion editorial 排版）：72px 图标 rail + 会话面板 + 聊天主区 + 默认收起的右栏状态抽屉；发丝线与右向投影负责分栏；3D Fluent Emoji 头像给暖纸世界一点体温；Phosphor 线性图标保持克制的工具感。动效只做一件事——让新内容「到达」（200ms ease-out 上浮入场），其余一切安静。

本系统的唯一 canon 是 `packages/client/index.html` 内钉选的 DIRECTION CONTRACT（2026-08-28，Notion warm-paper re-skin，user-pinned，no roll）；token 真相源是 `src/styles/tokens.css`；三层纪律由 `scripts/detect.mjs` 机器强制。本文是它们的规范展开。

**Key Characteristics:**

- Notion warm-paper editorial：暖纸画布 + 白卡片浮层 + Notion 蓝单一主色
- 桌面密度 IM 文法：三栏 + 抽屉 + 自绘 titlebar/statusbar
- 发丝线（1px rgba(0,0,0,.08)）+ 右向投影分栏，表面默认扁平
- 自托管 Inter（主，替代 NotionInter）+ Source Serif（衬线点缀，替代 Lyon）
- 3D Fluent Emoji 头像 + Phosphor 图标
- 气泡无边框，身份靠底色与不对称圆角
- 浅色为默认主题，暗色按 warm-paper 反相成对覆盖
- 动效克制：到达 200ms ease、按压反馈、全量 reduced-motion 降级

## Colors

调色板的性格：**一张暖纸，一间白卡片浮层，一抹 Notion 蓝做唯一动作色；其余颜色只出现在有状态可报告的地方。** 不是简单地把旧墨阶换个色，而是来自 notion.com 的 warm-paper-light 系统（`Design Token/`）。

### Primary

- **Notion Blue**（`control-primary` → `#0075de`）：主按钮/发送钮/激活导航/信息链接的唯一颜色。它不是装饰，而是「动作」——界面里最强的视觉重量留给最重要的动作。hover 提亮至 `#097fe8`。

### Neutral

- **Ink Text**（`text` → `#191a1b`）：正文墨色，接近 Notion charcoal。
- **Warm Body**（`text-muted` → `#615d59`）：纸面正文、次级文字——Notion graphite 暖调。
- **Stone Text**（`text-subtle` → `#757575`）：时间戳、占位符、第三级信息——Notion stone。
- **Paper Warmth**（`surface` → `#f6f5f4`）：整页画布。**不是纯白**——暖纸是本系统的签名底色（Notion do's：「不用 #fff 作画布」）。
- **Pure White**（`surface-secondary` / `surface-overlay` → `#ffffff`）：白卡片浮层、抽屉、modal——暖纸上浮起的「ruled insert」。
- **Sky Tint**（`surface-tertiary` / `surface-selected` → `#e6f3fe`）：凹陷井、会话行选中底、自我气泡——淡蓝 tinted 态。
- **Hover Wash**（`surface-hover` → `#eeedec`）：纸面控件 hover 的暖灰底。
- **Hairline**（`line` → `rgba(0,0,0,.08)`）／**Strong Hairline**（`line-strong` → `rgba(0,0,0,.16)`）：所有分栏线与控件描边（Notion 的 1px hairline）。

### Semantic Status（语义锁定，永不当品牌色）

- **Signal Red**（`status-red` → `#e32d14`／soft）：错误、失败、未读角标。未读红是 IM 品类语法，独立 token（`--color-unread`）可一处回滚。
- **Wait Amber**（`status-amber` → `#e89d01`／soft）：等待、审批待处理。
- **Done Green**（`status-green` → `#22a06b`／soft）：成功、运行中、在线。
- **Info Blue**（`status-blue` → `#0075de`／soft）：信息、completed 状态、room 图标底文字——与主色同源。
- **Focus Ring**（`#0075de`）：键盘焦点环，与主色一致。

### Avatar Accents

五个淡彩底（orange/blue/green/violet/slate），只用于头像底与 room 图标底，每个都有暗色成对值。暖纸世界里唯一允许的「淡彩」，只出现在「人」身上。

### Named Rules

**The Notion Blue Rule.** 只用一个动作色 `#0075de`。Notion 官方 don't：「不要引入第二种填充按钮色」。主按钮/发送钮/激活导航/信息链接共享这一色；hover 只提亮，不换色相。

**The Warm Paper Rule.** 画布用 `#f6f5f4`，卡片用 `#ffffff`。禁止用纯白当页面画布——暖纸是区别于临床纯白的核心。内容卡片不投影、不平铺阴影，仅靠 1px hairline 与明度分层区分。

**The Paired Theme Rule.** 每个语义色必须在 `tokens.css` 中浅/暗成对定义（`:root` + `[data-theme="dark"]`）。Notion 官方 token 只有 light，暗色按 warm-paper 浅色语义反相派生（深暖纸画布 + 白卡片浮层 + 主色蓝提亮）。新增一个没有暗色对偶的颜色即违规。

**The Tier Discipline.** 组件只消费 Tier 2 语义层与 Tier 3 尺寸层；Tier 1 primitive（`--prim-*`）只在 tokens.css 内部引用。`scripts/detect.mjs` 机器强制：组件 CSS 禁裸 hex/rgb/hsl、禁 `--prim-*` 引用。

## Typography

**Display Font:** 无独立 display——本产品是工具不是落地页，字号阶止于淡编辑级（18px）而不做 40/48/72/96 的大字打穿密度。
**Body Font:** 自托管 **Inter Variable**（`--font-sans`，替代 NotionInter 的开源级代）：Inter 是 Notion 官方指定的 NotionInter 替代，覆盖 400/500/600/700，经 `@fontsource-variable/inter` 自托管（不联外网 CDN），`font-src 'self'` 放行。中文回落 PingFang SC / Microsoft YaHei。
**Serif Accent:** **Source Serif 4 Variable**（`--font-serif`，替代 Lyon Text 的开源级代）——只作衬线点缀（选定正文时刻/章节引语），**不是**并行 UI 层级，不用于导航/界面标签。
**Mono Font:** `--font-mono`（Cascadia Mono / SF Mono / Consolas），用于 agent 标识、run id、代码块、时间戳类机器数据。

**Character:** Inter + 桌面密度。14px 正文是 IM 的「同事说话」尺寸（Notion body-sm）；标题靠 600–700 semibold 与 -0.01em 紧排制造层级，不靠字号跳档。

### Hierarchy

- **Headline**（700, 15px, 1.2, -0.01em）：聊天头、modal 标题。
- **Title**（700, 18px, 1, -0.01em）：会话面板 h1（较旧版 16px 放大，贴 Notion 编辑感）。
- **Body**（400, 14px, 1.5）：消息气泡正文，全局默认字号（较旧版 13px 放大）。
- **Label**（600, 12px, 1.35, 0.04em）：区块小标题（section heading）、主按钮文字；区块小标题全大写。
- **Micro**（400–600, 9–12px）：时间戳、状态 chip、meta 信息——本系统合法存在的最小字级，只用于短的不承载主要信息的元数据。

### Named Rules

**The Density Rule.** 字号阶止于编辑级 18px。这是桌面工具不是落地页；层级用字重与墨色深浅表达，不用放大表达。Notion 的 40–96px 展示字号阶不进入本产品（避免打穿三栏 IM 密度）。

## Layout

外壳是两层嵌套 grid：

```
chat-shell:   [rail 72px] [shell-body 1fr]
shell-body:   [titlebar 40px / columns 1fr / statusbar auto]
shell-columns:[conv 264px] [chat 1fr] [drawer 292px]   ← drawer 为条件第三列
```

- **Rail**（72px）：五入口（消息/Agent/任务/审批/归档）+ 底部齿轮（部署与集成）；消息入口带未读角标，审批入口带警示点。窗口 ≤920px 收至 60px、≤760px 收至 56px。
- **会话面板**（264px；920→224、760→196）：搜索 + 新建会话/建群；meeting/room 合并按最后活动降序；选中行 = Sky Tint 底 + 左缘 2px 墨色竖条。
- **聊天主区**（1fr）：52px header + 流 + composer；气泡最大宽 68%（≤900px → 82%、≤640px → 86%）。
- **状态抽屉**（292px）：**布局第三列而非绝对定位覆盖层**。这是硬约束：透明 Electron 窗口下绝对定位抽屉会让 Chromium 丢失聊天流绘制层（合成 bug，已带 E2E 佐证修复）。
- **Titlebar**（40px）：无边框窗口自绘 chrome——brand mark + WorkspaceSwitcher + ConnectionBadge + 窗口控制。
- **Tray widget**：380px 独立窗口，通知/审批速览位，不做聊天主场景。

间距 4px 基数（`--space-1..12`）。断点全部用窗口级 `@media`，**禁 container queries**（同为透明窗口合成 bug 的教训）。组件按域分目录共置样式（`shell/ conv/ chat/ views/ dialog/ ui/ cards/ deploy/ widget/`），token 三层纪律见 Colors 章。

## Elevation & Depth

默认扁平：表面之间靠 **发丝线（1px Hairline）+ 表面明度分层** 区分，不靠投影抬升。暖纸上白卡片天然形成 Level 1 浮层（Paper `#f6f5f4` → Pure White `#fff`）。投影只用于「浮在内容之上的层」，且一律**单向**（rail 向右、drawer 向左），像侧光打出的影子，不是四周发光的悬浮。内容卡片不投影（Notion do's：卡片仅 hairline 分隔）。

### Shadow Vocabulary

- **Rail Shadow**（`--shadow-rail`，右向）：rail 与主体的分栏，替代右边框。
- **Drawer Shadow**（`--shadow-drawer`，左向）：抽屉压住聊天流时投下的左向影。
- **Pop Shadow**（`--shadow-pop`）：popover / toast / workspace 下拉。
- **Widget Shadow**（`--shadow-widget`）：modal 与 tray widget——最重的一档。
- **Scrim**（`--color-scrim`）：modal 遮罩，很淡（暗色主题下加深至 0.55）。

### Named Rules

**The Right-Cast Rule.** 分栏结构的投影是单向的（rail 向右、drawer 向左），模拟固定光源方向。禁止给面板加四周均匀 shadow 或 glow——那是悬浮卡片语言，不是本世界的分栏语言。

## Shapes

圆角阶 4/6/8/10/12px + full。控件圆角与尺寸成比例：按钮 8px（Notion buttons），卡片 8–10px，modal 12px（Notion cards），胶囊（`--radius-full`）只用于 chip、未读角标、语义点这类「状态粒子」。

头像正圆，带 `--color-avatar-ring` 内描边（材质叠色，给 3D Emoji 一个「相框」）；3D Emoji 图片在圆内 `scale(1.22) translateY(4%)` 裁切，避免透明边。

### Named Rules

**The Bubble Asymmetry Rule.** 气泡身份靠底色 + 不对称圆角表达，无边框无投影：agent 气泡（白底，浮暖纸）左上角收小（5px 10px 10px 10px，指向左侧头像），自己的气泡（Sky Tint 底）镜像（右下角收小）。改气泡样式时保住这组不对称——它是「谁在说话」的空间语法。

## Components

### Buttons
- **Shape:** 8px 圆角（Notion buttons 档）。
- **Primary:** Notion Blue `#0075de` 底 + 白字，padding 0 12px，min-height 32px（sm 档 28px）。
- **Hover / Focus:** primary 提亮至 `#097fe8` 200ms ease；secondary 换 Hover Wash 底；`:focus-visible` 全局 2px Notion Blue 外描边。
- **Secondary / Danger:** secondary = 白底 + Strong Hairline 描边 + 墨字；danger = red-soft 底 + Signal Red 字、透明描边。
- **按压:** 全部 `scale(0.97)`（160ms standard ease）。

### Icon Button
32px 方形透明底，Muted Ink 图标；hover = Hover Wash + 墨字；active = `scale(0.96)`；`is-active` 态 = Sky Tint。rail 内放大至 40px 目标 + 10px 圆角。纯 CSS tooltip（右向、Agent Ink 底）挂在 `data-tooltip` 上。

### Chips
- **Status Chip:** 胶囊形，默认 Hover Wash 底 + Muted 字；状态变体换语义 soft 底 + 语义字（running=green / completed=blue / failed=red）。
- **Agent Chip / Agent Pick:** 34px 高 selectable 卡片式 chip，选中态 Sky Tint。

### Cards / Containers
- **Run Card:** Hairline 描边 + 白底 + 8px 圆角，内 padding 8px 10px；agent 名走 mono 12px；hover 换 Wash 底、按压 `scale(0.98)`。
- **Approval Card:** 唯一「有色容器」——amber 描边 + amber-soft 底 + 10px 圆角，双按钮网格（批准/驳回）。警示感是它的功能。
- **Entity Detail:** secondary 底（白卡片）+ Hairline 描边 + 10px 圆角，内部行标签全大写 9px。

### Inputs / Fields
- **Style:** 一律 Strong Hairline 描边 + 白底 + 6–8px 圆角；search 34px 高、dialog input 36px、drawer 内表单 28–30px。
- **Focus:** 描边转 Ghost Ink + 2px Hover Wash 外环（`box-shadow: 0 0 0 2px`）——聚焦环用 Notion Blue（`--color-focus-ring`）。
- **Composer:** 签名组件。42px 起、最多 132px 的自增 textarea 装在 10px 圆角描边容器里，右端 30px Notion Blue 发送钮；disabled 态发送钮降为 Hairline 底。

### Navigation
- **Rail:** 见 Layout。40px 目标 + 20px Phosphor 图标，纯图标无文字标签（tooltip 补位）；入口间 8px 间距。
- **Conversation Row:** 58px 行、32px 头像 + 双行文字（标题 semibold 14px + 摘要 12px muted）；行圆角 8px。
- **Statusbar / Titlebar:** Hairline 上下封边，12px muted 信息行。

### Message Stream（签名组件）
聊天的核心体验：agent 发言像同事落进群聊。消息行 = 头像列 + 元信息行（名字 semibold + 时间 12px + 类型 chip）+ 气泡；自己的消息整列右对齐。系统事件走居中 12px 灰字行；日期分隔走「两侧 56px 发丝线夹 12px 文字」。实时到达统一 `msg-in`（200ms ease-out，translateY 4px→0），覆盖气泡/流内卡/系统行。

## Do's and Don'ts

### Do:
- **Do** 新颜色先进 `tokens.css` Tier 2，浅/暗成对定义，再在组件里引用语义 token。
- **Do** 用 `#f6f5f4` 作画布、`#ffffff` 作卡片浮层、`#0075de` 作单一动作色——这是 Notion warm-paper 的三根支柱。
- **Do** 状态一律用语义色 + soft 底的组合（chip/卡片/badge 同一语法）。
- **Do** 图标一律走 `components/ui/icons.ts`（Phosphor 单一导入点），尺寸对齐 20px rail 档与 16px 控件档。
- **Do** 动效保持三类：到达（msg-in 200ms）、按压（scale 0.96–0.98）、容器入场（drawer/dialog 200ms ease-out）；全部带 `prefers-reduced-motion` 降级。
- **Do** 响应式用窗口级 `@media` 断点（920/760/900/640）。
- **Do** 字体走自托管 Inter / Source Serif（`@fontsource-variable/*`），`font-src 'self'` 放行，不联外网 CDN。

### Don't:
- **Don't** 在组件 CSS 写裸 hex/rgb/hsl 或引用 `--prim-*`——`detect.mjs` 会挡（这是机器强制纪律，不是风格建议）。
- **Don't** 在组件里内联 `<svg>`；不要引入 Phosphor 之外的图标体系。
- **Don't** 使用 container queries / 绝对定位抽屉盖聊天流——透明 Electron 窗口的 Chromium 合成 bug（已发生过、已修复、勿回潮）。
- **Don't** 把红橙绿蓝当品牌色用于装饰、渐变、发光或 sparkle——红橙绿蓝只承载状态；装饰彩色只在头像底。
- **Don't** 引入第二种填充按钮色——Notion 蓝是唯一动作色（Notion 官方 don't）。
- **Don't** 给气泡加边框/投影，或改动不对称圆角组。
- **Don't** 用纯白当页面画布（Notion don't）；不要引入网络字体或 >18px 的展示字号。
- **Don't** 用 Source Serif（Lyon 替代）做导航或界面标签——它只是衬线点缀。
