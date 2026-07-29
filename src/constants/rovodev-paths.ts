import { join } from "node:path";

export const ROVODEV_DIR = ".rovodev";
export const ROVODEV_SKILLS_DIR_PATH = join(ROVODEV_DIR, "skills");
export const ROVODEV_SUBAGENTS_DIR_PATH = join(ROVODEV_DIR, "subagents");
export const ROVODEV_MODULAR_RULES_DIR_PATH = join(ROVODEV_DIR, ".rulesync", "modular-rules");
export const ROVODEV_RULE_FILE_NAME = "AGENTS.md";
export const ROVODEV_LEGACY_RULE_FILE_NAME = "AGENTS.local.md";
export const ROVODEV_MCP_FILE_NAME = "mcp.json";
export const ROVODEV_CONFIG_FILE_NAME = "config.yml";
export const ROVODEV_AGENTS_SKILLS_DIR_PATH = join(".agents", "skills");
export const ROVODEV_PROMPTS_FILE_NAME = "prompts.yml";
export const ROVODEV_PROMPTS_DIR_PATH = join(ROVODEV_DIR, "prompts");

/**
 * Custom instructions for Rovo Dev's code reviews: a plain-Markdown file (no
 * frontmatter) in the repository root's `.rovodev/` folder. Note the leading
 * dot in the file name.
 * @see https://support.atlassian.com/rovo/docs/set-custom-instructions-for-code-reviews/
 */
export const ROVODEV_REVIEW_AGENT_FILE_NAME = ".review-agent.md";
