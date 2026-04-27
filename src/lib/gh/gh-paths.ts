import { join } from "node:path";

import { getHomeDirectory } from "../../utils/file.js";

/**
 * Agents recognized by `--mode gh`. Mirrors the agent list documented for
 * `gh skill install`. The same skill content can be deployed under multiple
 * agent-specific directories simultaneously, one entry per `(agent, scope)`
 * pair in `rulesync.jsonc`.
 */
export const GH_AGENTS = [
  "github-copilot",
  "claude-code",
  "cursor",
  "codex",
  "gemini",
  "antigravity",
] as const;
export type GhAgent = (typeof GH_AGENTS)[number];

export type GhScope = "project" | "user";

/**
 * Resolve the absolute install directory for a given agent + scope, matching
 * the layout expected by `gh skill install`.
 *
 * Project scope writes inside `projectRoot`. The `github-copilot` agent uses the
 * shared `.agents/skills` directory (the host-agnostic project layout); other
 * agents that share that location (cursor, codex, gemini, antigravity) write
 * to `.agents/skills` for project scope and to their own `.<tool>/skills`
 * directory for user scope. Claude Code is the exception: project and user
 * scope both use `.claude/skills`, just rooted at `projectRoot` vs the home
 * directory respectively.
 */
export function resolveGhInstallDir(params: {
  agent: GhAgent;
  scope: GhScope;
  projectRoot: string;
}): string {
  const { agent, scope, projectRoot } = params;
  const home = scope === "user" ? getHomeDirectory() : projectRoot;
  const relative = relativeInstallDirFor({ agent, scope });
  return join(home, relative);
}

/**
 * Returns the install directory relative to its scope root (projectRoot for
 * project scope, home for user scope). Exposed separately so the lockfile can
 * record the same canonical relative path it deploys to.
 */
export function relativeInstallDirFor(params: { agent: GhAgent; scope: GhScope }): string {
  const { agent, scope } = params;
  if (scope === "project") {
    if (agent === "claude-code") {
      return join(".claude", "skills");
    }
    // github-copilot and the rest share the shared project layout.
    return join(".agents", "skills");
  }
  // user scope
  switch (agent) {
    case "github-copilot":
      return join(".copilot", "skills");
    case "claude-code":
      return join(".claude", "skills");
    case "cursor":
      return join(".cursor", "skills");
    case "codex":
      return join(".codex", "skills");
    case "gemini":
      return join(".gemini", "skills");
    case "antigravity":
      return join(".gemini", "antigravity", "skills");
  }
}
