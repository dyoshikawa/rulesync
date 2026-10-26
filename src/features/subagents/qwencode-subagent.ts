import { z } from "zod/mini";

import { QWENCODE_AGENTS_DIR_PATH } from "../../constants/qwencode-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { FrontmatterMarkdownToolSubagent } from "./frontmatter-markdown-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";

const QwencodeSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
  model: z.optional(z.string()),
  approvalMode: z.optional(z.string()),
  tools: z.optional(z.array(z.string())),
  disallowedTools: z.optional(z.array(z.string())),
  maxTurns: z.optional(z.number()),
  color: z.optional(z.string()),
  // Qwen Code documents per-agent `mcpServers` as a record of MCP server specs
  // (an object), but earlier rulesync versions only accepted an array of server
  // names. Accept both so per-agent MCP overrides round-trip either way. See
  // QwenLM/qwen-code docs/users/features/sub-agents.md.
  mcpServers: z.optional(z.union([z.array(z.string()), z.record(z.string(), z.looseObject({}))])),
  hooks: z.optional(z.unknown()),
});

type QwencodeSubagentFrontmatter = z.infer<typeof QwencodeSubagentFrontmatterSchema>;

export class QwencodeSubagent extends FrontmatterMarkdownToolSubagent<QwencodeSubagentFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: QWENCODE_AGENTS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "qwencode";
  }

  protected static override getFrontmatterSchema() {
    return QwencodeSubagentFrontmatterSchema;
  }
}
