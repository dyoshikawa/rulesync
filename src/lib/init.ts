import { join } from "node:path";

import { ConfigParams } from "../config/config.js";
import { SKILL_FILE_NAME } from "../constants/general.js";
import {
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_OVERVIEW_FILE_NAME,
} from "../constants/rulesync-paths.js";
import { RulesyncCommand } from "../features/commands/rulesync-command.js";
import { RulesyncHooks } from "../features/hooks/rulesync-hooks.js";
import { RulesyncIgnoreYaml } from "../features/ignore/rulesync-ignore-yaml.js";
import { RulesyncMcp } from "../features/mcp/rulesync-mcp.js";
import { RulesyncRule } from "../features/rules/rulesync-rule.js";
import { RulesyncSkill } from "../features/skills/rulesync-skill.js";
import { RulesyncSubagent } from "../features/subagents/rulesync-subagent.js";
import { ensureDir, fileExists, writeFileContent } from "../utils/file.js";

export type InitFileResult = {
  created: boolean;
  path: string;
};

export type InitResult = {
  configFile: InitFileResult;
  sampleFiles: InitFileResult[];
};

/**
 * Initialize rulesync configuration and sample files.
 * This is the core logic without CLI-specific logging.
 */
export async function init(): Promise<InitResult> {
  const sampleFiles = await createSampleFiles();
  const configFile = await createConfigFile();

  return {
    configFile,
    sampleFiles,
  };
}

async function createConfigFile(): Promise<InitFileResult> {
  const path = RULESYNC_CONFIG_RELATIVE_FILE_PATH;

  if (await fileExists(path)) {
    return { created: false, path };
  }

  await writeFileContent(
    path,
    JSON.stringify(
      {
        targets: ["copilot", "cursor", "claudecode", "codexcli"],
        features: ["rules", "ignore", "mcp", "commands", "subagents", "skills", "hooks"],
        baseDirs: ["."],
        delete: true,
        verbose: false,
        silent: false,
        global: false,
        simulateCommands: false,
        simulateSubagents: false,
        simulateSkills: false,
      } satisfies ConfigParams,
      null,
      2,
    ),
  );

  return { created: true, path };
}

async function createSampleFiles(): Promise<InitFileResult[]> {
  const results: InitFileResult[] = [];

  // Sample file contents
  const sampleRuleFile = {
    filename: RULESYNC_OVERVIEW_FILE_NAME,
    content: `---
root: true
targets: ["*"]
description: "Project overview and general development guidelines"
globs: ["**/*"]
---

# Project Overview

## General Guidelines

- Use TypeScript for all new code
- Follow consistent naming conventions
- Write self-documenting code with clear variable and function names
- Prefer composition over inheritance
- Use meaningful comments for complex business logic

## Code Style

- Use 2 spaces for indentation
- Use semicolons
- Use double quotes for strings
- Use trailing commas in multi-line objects and arrays

## Architecture Principles

- Organize code by feature, not by file type
- Keep related files close together
- Use dependency injection for better testability
- Implement proper error handling
- Follow single responsibility principle
`,
  };

  const sampleMcpFile = {
    filename: "mcp.json",
    content: `{
  "mcpServers": {
    "serena": {
      "type": "stdio",
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--context",
        "ide-assistant",
        "--enable-web-dashboard",
        "false",
        "--project",
        "."
      ],
      "env": {}
    },
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@upstash/context7-mcp"
      ],
      "env": {}
    }
  }
}
`,
  };

  const sampleCommandFile = {
    filename: "review-pr.md",
    content: `---
description: 'Review a pull request'
targets: ["*"]
---

target_pr = $ARGUMENTS

If target_pr is not provided, use the PR of the current branch.

Execute the following in parallel:

1. Check code quality and style consistency
2. Review test coverage
3. Verify documentation updates
4. Check for potential bugs or security issues

Then provide a summary of findings and suggestions for improvement.
`,
  };

  const sampleSubagentFile = {
    filename: "planner.md",
    content: `---
name: planner
targets: ["*"]
description: >-
  This is the general-purpose planner. The user asks the agent to plan to
  suggest a specification, implement a new feature, refactor the codebase, or
  fix a bug. This agent can be called by the user explicitly only.
claudecode:
  model: inherit
---

You are the planner for any tasks.

Based on the user's instruction, create a plan while analyzing the related files. Then, report the plan in detail. You can output files to @tmp/ if needed.

Attention, again, you are just the planner, so though you can read any files and run any commands for analysis, please don't write any code.
`,
  };

  const sampleSkillFile = {
    dirName: "project-context",
    content: `---
name: project-context
description: "Summarize the project context and key constraints"
targets: ["*"]
---

Summarize the project goals, core constraints, and relevant dependencies.
Call out any architecture decisions, shared conventions, and validation steps.
Keep the summary concise and ready to reuse in future tasks.`,
  };

  const sampleIgnoreFile = {
    content: `version: 1
rules:
  - path: credentials/
    actions: [read]
`,
  };

  const sampleHooksFile = {
    content: `{
  "version": 1,
  "hooks": {
    "postToolUse": [
      {
        "matcher": "Write|Edit",
        "command": ".rulesync/hooks/format.sh"
      }
    ]
  }
}
`,
  };

  // Get paths from settable paths
  const rulePaths = RulesyncRule.getSettablePaths();
  const mcpPaths = RulesyncMcp.getSettablePaths();
  const commandPaths = RulesyncCommand.getSettablePaths();
  const subagentPaths = RulesyncSubagent.getSettablePaths();
  const skillPaths = RulesyncSkill.getSettablePaths();
  const ignorePaths = RulesyncIgnoreYaml.getSettablePaths();
  const hooksPaths = RulesyncHooks.getSettablePaths();

  // Ensure directories
  await ensureDir(rulePaths.recommended.relativeDirPath);
  await ensureDir(mcpPaths.recommended.relativeDirPath);
  await ensureDir(commandPaths.relativeDirPath);
  await ensureDir(subagentPaths.relativeDirPath);
  await ensureDir(skillPaths.relativeDirPath);
  await ensureDir(ignorePaths.relativeDirPath);

  // Create rule sample file
  const ruleFilepath = join(rulePaths.recommended.relativeDirPath, sampleRuleFile.filename);
  results.push(await writeIfNotExists(ruleFilepath, sampleRuleFile.content));

  // Create MCP sample file
  const mcpFilepath = join(
    mcpPaths.recommended.relativeDirPath,
    mcpPaths.recommended.relativeFilePath,
  );
  results.push(await writeIfNotExists(mcpFilepath, sampleMcpFile.content));

  // Create command sample file
  const commandFilepath = join(commandPaths.relativeDirPath, sampleCommandFile.filename);
  results.push(await writeIfNotExists(commandFilepath, sampleCommandFile.content));

  // Create subagent sample file
  const subagentFilepath = join(subagentPaths.relativeDirPath, sampleSubagentFile.filename);
  results.push(await writeIfNotExists(subagentFilepath, sampleSubagentFile.content));

  // Create skill sample file
  const skillDirPath = join(skillPaths.relativeDirPath, sampleSkillFile.dirName);
  await ensureDir(skillDirPath);
  const skillFilepath = join(skillDirPath, SKILL_FILE_NAME);
  results.push(await writeIfNotExists(skillFilepath, sampleSkillFile.content));

  // Create ignore sample file
  const ignoreFilepath = join(ignorePaths.relativeDirPath, ignorePaths.relativeFilePath);
  results.push(await writeIfNotExists(ignoreFilepath, sampleIgnoreFile.content));

  // Create hooks sample file
  const hooksFilepath = join(hooksPaths.relativeDirPath, hooksPaths.relativeFilePath);
  results.push(await writeIfNotExists(hooksFilepath, sampleHooksFile.content));

  return results;
}

async function writeIfNotExists(path: string, content: string): Promise<InitFileResult> {
  if (await fileExists(path)) {
    return { created: false, path };
  }

  await writeFileContent(path, content);
  return { created: true, path };
}
