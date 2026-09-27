import { CODEXCLI_DIR } from "../../constants/codexcli-paths.js";
import { NestedAgentsmdRule, NestedAgentsmdRuleFamily } from "./nested-agentsmd-rule.js";

/**
 * Rule generator for OpenAI Codex CLI.
 *
 * Codex CLI loads instructions only from the `AGENTS.md` family: the global
 * `~/.codex/AGENTS.md` (or `AGENTS.override.md`), then one file per directory
 * level from the project root down to the current working directory, joined
 * root-first so deeper files take precedence. Nested per-directory files are
 * therefore a real scoping surface, and Codex's docs recommend splitting large
 * instruction sets across nested directories. It does NOT scan a
 * `.codex/memories/` directory for instruction files — that directory belongs
 * to Codex's separate SQLite-backed auto-memory system.
 *
 * A non-root rule carrying `agentsmd.subprojectPath` is emitted as a nested
 * `<subprojectPath>/AGENTS.md` (project scope only); every other non-root rule
 * folds into the root `AGENTS.md`, since Codex has no modular rules directory.
 * The project files on the root-to-cwd chain share one `project_doc_max_bytes`
 * budget (32 KiB by default), which the RulesProcessor warns about.
 *
 * @see https://learn.chatgpt.com/docs/agent-configuration/agents-md
 */
export class CodexcliRule extends NestedAgentsmdRule {
  protected static getFamily(): NestedAgentsmdRuleFamily {
    return { globalDir: CODEXCLI_DIR, toolTarget: "codexcli" };
  }
}
