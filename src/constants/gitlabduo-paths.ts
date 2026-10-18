import { join } from "node:path";

/**
 * GitLab Duo CLI keeps its project configuration under `.gitlab/duo/` and its
 * user configuration under `~/.gitlab/duo/` (on Linux/macOS). Every path here
 * names a single file or a dedicated subdirectory so consumers such as the
 * gitignore derivation never claim the whole `.gitlab/` tree, which also holds
 * CI templates, issue templates and CODEOWNERS.
 *
 * @see https://docs.gitlab.com/user/gitlab_duo_cli/customize/
 */
export const GITLABDUO_DIR = join(".gitlab", "duo");

/** Custom rules. @see https://docs.gitlab.com/user/duo_agent_platform/customize/custom_rules/ */
export const GITLABDUO_RULE_FILE_NAME = "chat-rules.md";

/** MCP servers. @see https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_clients/ */
export const GITLABDUO_MCP_FILE_NAME = "mcp.json";

/** Lifecycle hooks (experiment). @see https://docs.gitlab.com/user/gitlab_duo_cli/customize/ */
export const GITLABDUO_HOOKS_FILE_NAME = "hooks.json";

/** Merge request review instructions. @see https://docs.gitlab.com/user/project/merge_requests/duo_in_merge_requests/ */
export const GITLABDUO_MR_REVIEW_INSTRUCTIONS_FILE_NAME = "mr-review-instructions.yaml";

/** Project custom slash commands live in the cross-tool `.agents/commands/`. */
export const GITLABDUO_COMMANDS_DIR = join(".agents", "commands");
/** User custom slash commands. */
export const GITLABDUO_GLOBAL_COMMANDS_DIR = join(GITLABDUO_DIR, "commands");

/**
 * Project skills live in the cross-tool `.agents/skills/` directory, which
 * GitLab Duo reads alongside a non-hidden `skills/` directory at the project
 * root; when both hold a skill of the same name, `.agents/skills/` wins.
 *
 * @see https://docs.gitlab.com/user/duo_agent_platform/customize/agent_skills/
 */
export const GITLABDUO_SKILLS_DIR = join(".agents", "skills");
/**
 * The project-root `skills/` directory GitLab Duo also reads. Earlier rulesync
 * versions wrote project skills there; it is now an import-only root, since it
 * routinely holds hand-authored skills rulesync must not manage.
 */
export const GITLABDUO_LEGACY_SKILLS_DIR = "skills";
/** User skills (requires `--enable-global-skills` / `GITLAB_ENABLE_GLOBAL_SKILLS`). */
export const GITLABDUO_GLOBAL_SKILLS_DIR = join(GITLABDUO_DIR, "skills");
