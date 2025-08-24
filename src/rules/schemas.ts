// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";

/**
 * Valid tool targets for Rulesync
 */
export const VALID_TARGETS = [
  "all",
  "copilot",
  "cursor",
  "cline",
  "claudecode",
  "augmentcode",
  "augmentcode-legacy",
  "roo",
  "amazonqcli",
  "codexcli",
  "opencode",
  "qwencode",
  "geminicli",
  "kiro",
  "junie",
  "windsurf",
  "agentsmd",
] as const;

/**
 * Rulesync rule frontmatter schema
 */
export const rulesyncFrontmatterSchema = z
  .object({
    target: z.union([z.enum(VALID_TARGETS), z.array(z.enum(VALID_TARGETS))]).optional(),
    description: z.string().optional(),
    glob: z.union([z.string(), z.array(z.string())]).optional(),
    author: z.string().optional(),
    created: z.string().optional(),
    modified: z.string().optional(),
  })
  .passthrough(); // Allow additional properties

/**
 * Rulesync rule content schema
 */
export const rulesyncContentSchema = z
  .string()
  .min(1, "Rule content cannot be empty")
  .refine((content) => content.trim().length > 0, "Rule content cannot be only whitespace");

/**
 * Rulesync rule constructor params schema
 */
export const rulesyncConstructorSchema = z.object({
  filePath: z.string().min(1, "File path is required"),
  frontmatter: rulesyncFrontmatterSchema,
  content: rulesyncContentSchema,
});

/**
 * Claude Code rule schema
 */
export const claudecodeFilePathSchema = z
  .string()
  .refine((path) => path.endsWith("CLAUDE.md"), "Claude Code memory file must be named CLAUDE.md");

export const claudecodeContentSchema = z
  .string()
  .min(1, "Claude Code memory content cannot be empty")
  .refine(
    (content) => content.trim().length > 0,
    "Claude Code memory content cannot be only whitespace",
  );

/**
 * Claude Code rule constructor params schema
 */
export const claudecodeConstructorSchema = z.object({
  filePath: claudecodeFilePathSchema,
  content: claudecodeContentSchema,
});

/**
 * AGENTS.md rule schema
 */
export const agentsmdFilePathSchema = z
  .string()
  .refine(
    (path) => path.endsWith("AGENTS.md") || path.includes(".agents/memories/"),
    "AGENTS.md file must be named AGENTS.md or be in .agents/memories/ directory",
  );

export const agentsmdContentSchema = z
  .string()
  .min(1, "AGENTS.md content cannot be empty")
  .refine((content) => content.trim().length > 0, "AGENTS.md content cannot be only whitespace");

// Type exports
export type RulesyncFrontmatter = z.infer<typeof rulesyncFrontmatterSchema>;
export type RulesyncConstructorParams = z.infer<typeof rulesyncConstructorSchema>;
export type ClaudecodeConstructorParams = z.infer<typeof claudecodeConstructorSchema>;
