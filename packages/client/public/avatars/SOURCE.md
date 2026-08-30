# Notion 风手绘头像资产

本目录的头像是 **Notion 风格手绘线稿头像**,由 `notion-avatar` 部件的 `preview/` 图层预组合而成
(脸部 + 五官 + 发型 + 眼镜,`1080×1080` 同坐标系叠加,face 部件强制白底),导出为独立 SVG。

**上游来源**: [mayandev/notion-avatar](https://github.com/mayandev/notion-avatar) — 社区复刻的 Notion 手绘头像工程(Next.js),
部件资产在 `public/avatar/part/` 下,按类别(face/nose/mouth/eyes/eyebrows/glasses/hair/accessories/beard/details)
各提供可索引版本。本目录只抽取其部件 + 组合器,预组合后输出独立 SVG;概念沿用 Notion,部件为该仓库自绘。

> 注:真正的 Notion 官方头像组件是闭源的,此为社区复刻版,风格近似而非官方资产。

生成脚本(临时产物,不随仓库提交):

```
.tmpfiles/notion-avatar/compose.js   # 单头像组合器
.tmpfiles/notion-avatar/batch.js     # 批量生成 7 角色 + 12 兜底
```

命名规则:

- `claude-scientist` / `codex-technologist` / `chapter-detective` / `api-robot` / `dashboard-astronaut` / `knowledge-mage` / `market-artist`
  — 对应角色关键词映射(见 `src/components/ui/avatar.tsx` 的 `avatarAssetFor`)。
- `notion-avatar-01~12` — 兜底池,按 agentId 哈希取模,提供更多区分度。

不再使用 Microsoft Fluent Emoji 3D 资产(原 `*.png` 已移除)。
