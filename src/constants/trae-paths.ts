import { join } from "node:path";

/**
 * Trae (ByteDance's AI IDE, "TraeCode" in its current docs) keeps project
 * configuration under `.trae/` and user configuration under `~/.trae/`.
 *
 * @see https://docs.trae.ai/ide/rules?_lang=en
 * @see https://docs.trae.ai/ide/skills?_lang=en
 * @see https://docs.trae.ai/ide/add-mcp-servers?_lang=en
 */
export const TRAE_DIR = ".trae";

/** Project MCP servers (`mcpServers` object), project scope only. */
export const TRAE_MCP_FILE_NAME = "mcp.json";

/** Skills: `.trae/skills/<name>/SKILL.md` (project) and `~/.trae/skills/` (global). */
export const TRAE_SKILLS_DIR_PATH = join(TRAE_DIR, "skills");
