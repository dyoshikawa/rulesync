import { join } from "node:path";

import { SKILL_FILE_NAME } from "../constants/general.js";
import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_PERMISSIONS_SCHEMA_URL,
} from "../constants/rulesync-paths.js";
import { RulesyncCheck } from "../features/checks/rulesync-check.js";
import { RulesyncCommand } from "../features/commands/rulesync-command.js";
import { RulesyncHooks } from "../features/hooks/rulesync-hooks.js";
import { RulesyncIgnore } from "../features/ignore/rulesync-ignore.js";
import { RulesyncMcp } from "../features/mcp/rulesync-mcp.js";
import { RulesyncPermissions } from "../features/permissions/rulesync-permissions.js";
import { RulesyncRule } from "../features/rules/rulesync-rule.js";
import { RulesyncSkill } from "../features/skills/rulesync-skill.js";
import { RulesyncSubagent } from "../features/subagents/rulesync-subagent.js";
import { getRulesyncSourceCandidates } from "../utils/rulesync-source-path.js";

export type ScaffoldFeature =
  | "rule"
  | "command"
  | "subagent"
  | "skill"
  | "check"
  | "mcp"
  | "hooks"
  | "ignore"
  | "permissions";

export type FeatureScaffold = {
  feature: ScaffoldFeature;
  relativeFilePath: string;
  candidateRelativeFilePaths: string[];
  content: string;
};

const FEATURE_KEYWORDS = new Map<string, ScaffoldFeature>([
  ["rule", "rule"],
  ["rules", "rule"],
  ["command", "command"],
  ["commands", "command"],
  ["subagent", "subagent"],
  ["subagents", "subagent"],
  ["skill", "skill"],
  ["skills", "skill"],
  ["check", "check"],
  ["checks", "check"],
  ["mcp", "mcp"],
  ["hook", "hooks"],
  ["hooks", "hooks"],
  ["ignore", "ignore"],
  ["permission", "permissions"],
  ["permissions", "permissions"],
]);

const NAMED_FEATURES = new Set<ScaffoldFeature>(["rule", "command", "subagent", "skill", "check"]);

export function parseScaffoldFeatureKeyword(value: string): ScaffoldFeature | undefined {
  return FEATURE_KEYWORDS.get(value.toLowerCase());
}

export function isNamedScaffoldFeature(feature: ScaffoldFeature): boolean {
  return NAMED_FEATURES.has(feature);
}

export function normalizeScaffoldName({
  feature,
  name,
}: {
  feature: ScaffoldFeature;
  name: string | undefined;
}): string | undefined {
  if (!isNamedScaffoldFeature(feature)) {
    if (name !== undefined) {
      throw new Error(`Feature "${feature}" does not accept --name.`);
    }
    return undefined;
  }

  if (name === undefined || name.trim() === "") {
    throw new Error(`Feature "${feature}" requires --name <name>.`);
  }

  const normalized = name.trim().replace(/\.md$/i, "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(normalized)) {
    throw new Error(
      `Invalid ${feature} name "${name}". Use letters, numbers, dots, underscores, or hyphens without path separators.`,
    );
  }
  return normalized;
}

function titleFromName(name: string): string {
  return name
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function namedFeatureScaffold({
  feature,
  relativeFilePath,
  content,
}: {
  feature: ScaffoldFeature;
  relativeFilePath: string;
  content: string;
}): FeatureScaffold {
  return {
    feature,
    relativeFilePath,
    candidateRelativeFilePaths: [relativeFilePath],
    content,
  };
}

function ruleTemplate(name: string): string {
  if (name === "overview") {
    return `---
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
`;
  }

  const title = titleFromName(name);
  return `---
root: false
targets: ["*"]
description: "${title} guidelines"
globs: ["**/*"]
---

# ${title}

Describe the project guidance that should apply when the configured globs match.
`;
}

function commandTemplate(name: string): string {
  if (name === "review-pr") {
    return `---
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
`;
  }

  const title = titleFromName(name);
  return `---
description: "Run the ${title} workflow"
targets: ["*"]
---

# ${title}

Use $ARGUMENTS as input and describe the steps this command should perform.
`;
}

function subagentTemplate(name: string): string {
  if (name === "planner") {
    return `---
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
`;
  }

  const title = titleFromName(name);
  return `---
name: ${JSON.stringify(name)}
targets: ["*"]
description: "${title} specialist"
---

You are the ${title} specialist. Describe the role, constraints, and expected output here.
`;
}

function skillTemplate(name: string): string {
  if (name === "project-context") {
    return `---
name: project-context
description: "Summarize the project context and key constraints"
targets: ["*"]
---

Summarize the project goals, core constraints, and relevant dependencies.
Call out any architecture decisions, shared conventions, and validation steps.
Keep the summary concise and ready to reuse in future tasks.`;
  }

  const title = titleFromName(name);
  return `---
name: ${JSON.stringify(name)}
description: "Use ${title} guidance for relevant tasks"
targets: ["*"]
---

# ${title}

Describe when to use this skill and the workflow it should follow.
`;
}

function checkTemplate(name: string): string {
  const title = titleFromName(name);
  return `---
targets: ["*"]
description: "${title} review criteria"
severity: medium
---

# ${title}

Describe the conditions this check should detect and the evidence it should report.
`;
}

function singletonTemplate(feature: ScaffoldFeature): string {
  switch (feature) {
    case "mcp":
      return `{
  "$schema": "${RULESYNC_MCP_SCHEMA_URL}",
  "mcpServers": {
    "deepwiki": {
      "type": "http",
      "url": "https://mcp.deepwiki.com/mcp",
      "env": {}
    },
    "rulesync": {
      "type": "stdio",
      "command": "pnpm",
      "args": [
        "dlx",
        "rulesync",
        "mcp"
      ],
      "env": {}
    }
  }
}
`;
    case "hooks":
      return `{
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
`;
    case "ignore":
      return `credentials/
`;
    case "permissions":
      return `{
  "$schema": "${RULESYNC_PERMISSIONS_SCHEMA_URL}",
  "permission": {
    "bash": {
      "git status": "allow",
      "git diff": "allow",
      "ls *": "allow",
      "rm -rf *": "deny",
      "*": "ask"
    },
    "edit": {
      "src/**": "allow"
    },
    "read": {
      ".env": "deny",
      "credentials/**": "deny"
    }
  },
  "codexcli": {
    "approval_policy": "on-request",
    "approvals_reviewer": "auto_review",
    "base_permission_profile": ":danger-full-access"
  }
}
`;
    default:
      throw new Error(`Feature "${feature}" requires a name.`);
  }
}

export function createFeatureScaffold({
  feature,
  name,
}: {
  feature: ScaffoldFeature;
  name?: string;
}): FeatureScaffold {
  const normalizedName = normalizeScaffoldName({ feature, name });

  switch (feature) {
    case "rule":
      return namedFeatureScaffold({
        feature,
        relativeFilePath: join(
          RulesyncRule.getSettablePaths().recommended.relativeDirPath,
          `${normalizedName}.md`,
        ),
        content: ruleTemplate(normalizedName!),
      });
    case "command":
      return namedFeatureScaffold({
        feature,
        relativeFilePath: join(
          RulesyncCommand.getSettablePaths().relativeDirPath,
          `${normalizedName}.md`,
        ),
        content: commandTemplate(normalizedName!),
      });
    case "subagent":
      return namedFeatureScaffold({
        feature,
        relativeFilePath: join(
          RulesyncSubagent.getSettablePaths().relativeDirPath,
          `${normalizedName}.md`,
        ),
        content: subagentTemplate(normalizedName!),
      });
    case "skill":
      return namedFeatureScaffold({
        feature,
        relativeFilePath: join(
          RulesyncSkill.getSettablePaths().relativeDirPath,
          normalizedName!,
          SKILL_FILE_NAME,
        ),
        content: skillTemplate(normalizedName!),
      });
    case "check":
      return namedFeatureScaffold({
        feature,
        relativeFilePath: join(
          RulesyncCheck.getSettablePaths().relativeDirPath,
          `${normalizedName}.md`,
        ),
        content: checkTemplate(normalizedName!),
      });
    case "mcp": {
      const paths = RulesyncMcp.getSettablePaths();
      const relativeFilePath = join(
        paths.recommended.relativeDirPath,
        paths.recommended.relativeFilePath,
      );
      return {
        feature,
        relativeFilePath,
        candidateRelativeFilePaths: getRulesyncSourceCandidates({ paths }).map((candidate) =>
          join(candidate.relativeDirPath, candidate.relativeFilePath),
        ),
        content: singletonTemplate(feature),
      };
    }
    case "hooks": {
      const paths = RulesyncHooks.getSettablePaths();
      const relativeFilePath = join(
        paths.recommended.relativeDirPath,
        paths.recommended.relativeFilePath,
      );
      return {
        feature,
        relativeFilePath,
        candidateRelativeFilePaths: getRulesyncSourceCandidates({ paths }).map((candidate) =>
          join(candidate.relativeDirPath, candidate.relativeFilePath),
        ),
        content: singletonTemplate(feature),
      };
    }
    case "ignore": {
      const paths = RulesyncIgnore.getSettablePaths();
      const relativeFilePath = join(
        paths.recommended.relativeDirPath,
        paths.recommended.relativeFilePath,
      );
      return {
        feature,
        relativeFilePath,
        candidateRelativeFilePaths: [
          relativeFilePath,
          ...(paths.legacy
            ? [join(paths.legacy.relativeDirPath, paths.legacy.relativeFilePath)]
            : []),
        ],
        content: singletonTemplate(feature),
      };
    }
    case "permissions": {
      const paths = RulesyncPermissions.getSettablePaths();
      const relativeFilePath = join(
        paths.recommended.relativeDirPath,
        paths.recommended.relativeFilePath,
      );
      return {
        feature,
        relativeFilePath,
        candidateRelativeFilePaths: getRulesyncSourceCandidates({ paths }).map((candidate) =>
          join(candidate.relativeDirPath, candidate.relativeFilePath),
        ),
        content: singletonTemplate(feature),
      };
    }
  }
}
