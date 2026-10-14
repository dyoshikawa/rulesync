// Codebuff (`codebuff` on npm), renamed to Freebuff (`freebuff` on npm). Both
// CLIs are built from the same source tree (CodebuffAI/freebuff, formerly
// CodebuffAI/codebuff) and read the same configuration files.
// @see https://github.com/CodebuffAI/freebuff

// Ignore file: `.codebuffignore`, read with gitignore syntax (the `ignore`
// package) beside `.gitignore` and a legacy ignore file, chained per
// directory. There is no user-level ignore file.
// @see https://github.com/CodebuffAI/freebuff/blob/main/common/src/util/project-ignore.ts
export const CODEBUFF_IGNORE_FILE_NAME = ".codebuffignore";

// MCP servers: the `mcpServers` map of `mcp.json` inside an `.agents/`
// directory — `{cwd}/.agents/`, `{cwd}/../.agents/` and `~/.agents/`.
// @see https://www.codebuff.com/docs/tips/mcp-servers
// @see https://github.com/CodebuffAI/freebuff/blob/main/sdk/src/agents/load-mcp-config.ts
export const CODEBUFF_AGENTS_DIR = ".agents";
export const CODEBUFF_MCP_FILE_NAME = "mcp.json";

// Rules (global scope only): the home-directory dotfile `~/.AGENTS.md`. The
// SDK lists the home directory and loads the first hidden file whose name
// matches `KNOWLEDGE_FILE_NAMES` case-insensitively, in priority order
// `AGENTS.md` > `CLAUDE.md`, so `~/.AGENTS.md` takes precedence over
// `~/.CLAUDE.md`. Another file differing only in case (e.g. `~/.agents.md`)
// matches the same name, and which one loads then depends on readdir order.
// Project scope needs no Codebuff-specific file: the project-root `AGENTS.md`
// is already written by the `agentsmd` target.
// @see https://github.com/CodebuffAI/freebuff/blob/main/sdk/src/run-state.ts
// @see https://github.com/CodebuffAI/freebuff/blob/main/common/src/constants/knowledge.ts
export const CODEBUFF_GLOBAL_RULE_FILE_NAME = ".AGENTS.md";
