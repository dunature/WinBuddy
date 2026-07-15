# 导入剩余的 Claude Code Skills 到 Craft Agent

## 背景

用户 `~/.claude/skills/` 中大部分 skill 已经是 `~/.agents/skills/{slug}` 的符号链接（Craft Agent 全局 skill 目录）。但仍有几个 skill **没有链接过去**，需要补齐。

## 状态盘点

| Skill | 类型 | 状态 |
|---|---|---|
| `agent-reach/` | 目录 | ✅ 已存在于 `~/.agents/skills/`，内容同步（mtime 相同） |
| `frontend-slides/` | 目录 | ❌ 待导入 (48K, 含 SKILL.md + STYLE_PRESETS.md) |
| `web-design-engineer/` | 目录 | ❌ 待导入 (40K, 含 SKILL.md + references/) |
| `youtube-transcript/` | 目录 | ❌ 待导入 (16K, 仅含 SKILL.md) |
| `yt-dlp/` | 目录 | ❌ 待导入 (4K, 含 SKILL.md) |
| `shared/` | 目录 | ⏭️ 跳过 (仅含 chrome_profile/，是共享资源文件夹不是 skill) |
| `explain-diff-html.md` | 独立 .md | ❌ 待包装为 skill 目录 |
| `explain-diff-notion.md` | 独立 .md | ❌ 待包装为 skill 目录 |

## 实施方案

按现有约定（其他 skill 的做法是让 `~/.claude/skills/X` 作为软链指回 `~/.agents/skills/X`），但目前未链接的几个是**真实源**在 `~/.claude/skills/`。最稳妥且最快的方案是：**让 `~/.agents/skills/X` 反向软链到 `~/.claude/skills/X`**，这样：

- 不复制数据，节省空间
- 双系统实时同步（修改一处两边都看到）
- 与现有链接模式一致（都是符号链接）

### 步骤

1. **创建 4 个目录型 skill 的反向符号链接**
   ```bash
   ln -s ~/.claude/skills/frontend-slides     ~/.agents/skills/frontend-slides
   ln -s ~/.claude/skills/web-design-engineer ~/.agents/skills/web-design-engineer
   ln -s ~/.claude/skills/youtube-transcript  ~/.agents/skills/youtube-transcript
   ln -s ~/.claude/skills/yt-dlp              ~/.agents/skills/yt-dlp
   ```

2. **包装 2 个独立的 .md 文件为 skill 目录**（保持原文件不动）
   ```bash
   mkdir -p ~/.agents/skills/explain-diff-html
   cp ~/.claude/skills/explain-diff-html.md ~/.agents/skills/explain-diff-html/SKILL.md
   mkdir -p ~/.agents/skills/explain-diff-notion
   cp ~/.claude/skills/explain-diff-notion.md ~/.agents/skills/explain-diff-notion/SKILL.md
   ```

3. **验证**：6 个新增 skill 全部出现在 `~/.agents/skills/` 中
   - 4 个 symlink（蓝色箭头显示）
   - 2 个新目录

## 副作用 / 注意

- 不修改任何 `~/.claude/skills/` 现有内容（包括 loose `.md` 文件）
- 不动 `~/.agents/skills/` 中已存在的任何 skill
- `shared/` 跳过（不是 skill）
- 如需撤销：删除 `~/.agents/skills/` 下对应的 symlink / 目录即可

## 风险评估

- **极低风险**：仅创建符号链接 + 复制小文件，不动任何现有数据
- 不影响任何已有 skill，因为 `~/.agents/skills/` 下这些 slug 当前都不存在（已二次确认 `agent-reach` 除外）
