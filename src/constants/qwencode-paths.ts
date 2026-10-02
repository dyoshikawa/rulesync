import { join } from "node:path";

export const QWENCODE_DIR = ".qwen";
export const QWENCODE_COMMANDS_DIR_PATH = join(QWENCODE_DIR, "commands");
export const QWENCODE_AGENTS_DIR_PATH = join(QWENCODE_DIR, "agents");
export const QWENCODE_SKILLS_DIR_PATH = join(QWENCODE_DIR, "skills");
export const QWENCODE_RULE_FILE_NAME = "QWEN.md";
// Personal project-scoped context file (v0.16.2): loads after the shared
// QWEN.md so it can override team instructions. Qwen Code does not gitignore
// it for the user, so rulesync hand-maintains a gitignore entry for it.
// https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/memory.md
export const QWENCODE_LOCAL_RULE_FILE_NAME = "QWEN.local.md";
export const QWENCODE_IGNORE_FILE_NAME = ".qwenignore";
export const QWENCODE_SETTINGS_FILE_NAME = "settings.json";
// Project review rules read by `/review` ahead of its fallbacks
// (`.github/copilot-instructions.md`, then a `## Code Review` section in
// AGENTS.md / QWEN.md). PR reviews read it from the base branch.
// https://qwenlm.github.io/qwen-code-docs/en/users/features/code-review/
export const QWENCODE_REVIEW_RULES_FILE_NAME = "review-rules.md";
