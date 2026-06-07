import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateClaudeMd } from './generators/claude-md.js';
import type { ClaudeMdOptions } from './generators/claude-md.js';
import { generateMcpConfig } from './generators/mcp-config.js';
import type { McpConfigOptions } from './generators/mcp-config.js';
import { generateSkillFiles } from './generators/skills.js';
import { generateHookConfig } from './generators/hooks.js';
import type { HookConfigOptions } from './generators/hooks.js';

export interface InstallOptions {
  claudeMd?: ClaudeMdOptions;
  mcpConfig?: McpConfigOptions;
  hookConfig?: HookConfigOptions;
  skillsDir?: string;
  skipClaudeMd?: boolean;
  skipSkills?: boolean;
}

export interface InstallResult {
  filesWritten: string[];
  filesAppended: string[];
  claudeMdContent: string;
  mcpConfig: ReturnType<typeof generateMcpConfig>;
  hookConfig: ReturnType<typeof generateHookConfig>;
  skillFiles: { path: string; content: string }[];
}

export function installClaudePlugin(rootDir: string, options: InstallOptions = {}): InstallResult {
  const { claudeMd, mcpConfig, hookConfig, skillsDir, skipClaudeMd, skipSkills } = options;

  const result: InstallResult = {
    filesWritten: [],
    filesAppended: [],
    claudeMdContent: '',
    mcpConfig: generateMcpConfig(mcpConfig),
    hookConfig: generateHookConfig(hookConfig),
    skillFiles: [],
  };

  // Generate and write CLAUDE.md
  if (!skipClaudeMd) {
    const claudeMdPath = join(rootDir, 'CLAUDE.md');
    const content = generateClaudeMd(claudeMd);
    result.claudeMdContent = content;

    if (existsSync(claudeMdPath)) {
      // Append AgentMesa section if CLAUDE.md already exists
      const existing = readFileSync(claudeMdPath, 'utf-8');
      if (!existing.includes('AgentMesa')) {
        appendFileSync(claudeMdPath, '\n\n' + content);
        result.filesAppended.push(claudeMdPath);
      }
    } else {
      writeFileSync(claudeMdPath, content, 'utf-8');
      result.filesWritten.push(claudeMdPath);
    }
  }

  // Generate and write skill files
  if (!skipSkills) {
    const skillsOutputDir = skillsDir ?? '.claude/skills';
    const skillsAbsDir = join(rootDir, skillsOutputDir);

    if (!existsSync(skillsAbsDir)) {
      mkdirSync(skillsAbsDir, { recursive: true });
    }

    const skills = generateSkillFiles({ outputDir: skillsOutputDir });
    result.skillFiles = skills;

    for (const skill of skills) {
      const absPath = join(rootDir, skill.path);
      writeFileSync(absPath, skill.content, 'utf-8');
      result.filesWritten.push(absPath);
    }
  }

  return result;
}
