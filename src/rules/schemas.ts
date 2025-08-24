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
 * Cline rule schema
 */
export const clineFilePathSchema = z
  .string()
  .refine(
    (path) => path.includes(".clinerules/") && (path.endsWith(".md") || path.endsWith(".mdx")),
    "Cline rule file must be in .clinerules/ directory and have .md or .mdx extension",
  );

export const clineContentSchema = z
  .string()
  .min(1, "Cline rule content cannot be empty")
  .refine((content) => content.trim().length > 0, "Cline rule content cannot be only whitespace");

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

/**
 * Amazon Q CLI rule schema
 */
export const amazonqcliFilePathSchema = z
  .string()
  .refine(
    (path) => path.includes(".amazonq/rules/") && path.endsWith(".md"),
    "Amazon Q CLI rule file must be in .amazonq/rules/ directory and have .md extension",
  );

export const amazonqcliContentSchema = z
  .string()
  .min(1, "Amazon Q CLI rule content cannot be empty")
  .refine(
    (content) => content.trim().length > 0,
    "Amazon Q CLI rule content cannot be only whitespace",
  );

/**
 * AugmentCode rule schema
 */
export const augmentcodeFilePathSchema = z
  .string()
  .refine(
    (path) => path.includes(".augment/rules/") && path.endsWith(".md"),
    "AugmentCode rule file must be in .augment/rules/ directory and have .md extension",
  );

export const augmentcodeContentSchema = z
  .string()
  .min(1, "AugmentCode rule content cannot be empty")
  .refine(
    (content) => content.trim().length > 0,
    "AugmentCode rule content cannot be only whitespace",
  );

/**
 * Copilot rule schema
 */
export const copilotFilePathSchema = z
  .string()
  .refine(
    (path) => path.endsWith("copilot-instructions.md") || path.includes(".github/instructions/"),
    "Copilot rule file must be copilot-instructions.md or in .github/instructions/ directory",
  );

export const copilotContentSchema = z
  .string()
  .min(1, "Copilot rule content cannot be empty")
  .refine((content) => content.trim().length > 0, "Copilot rule content cannot be only whitespace");

/**
 * Cursor rule schema
 */
export const cursorFilePathSchema = z
  .string()
  .refine(
    (path) => path.includes(".cursor/rules/") && path.endsWith(".mdc"),
    "Cursor rule file must be in .cursor/rules/ directory and have .mdc extension",
  );

export const cursorContentSchema = z
  .string()
  .min(1, "Cursor rule content cannot be empty")
  .refine((content) => content.trim().length > 0, "Cursor rule content cannot be only whitespace");

/**
 * Codex CLI rule schema
 */
export const codexcliFilePathSchema = z
  .string()
  .refine(
    (path) => path.endsWith("AGENTS.md") || path.includes(".codex/instructions.md"),
    "Codex CLI rule file must be AGENTS.md or .codex/instructions.md",
  );

export const codexcliContentSchema = z
  .string()
  .min(1, "Codex CLI rule content cannot be empty")
  .refine(
    (content) => content.trim().length > 0,
    "Codex CLI rule content cannot be only whitespace",
  );

/**
 * OpenCode rule schema
 */
export const opencodeFilePathSchema = z
  .string()
  .refine((path) => path.endsWith("AGENTS.md"), "OpenCode rule file must be named AGENTS.md");

export const opencodeContentSchema = z
  .string()
  .min(1, "OpenCode rule content cannot be empty")
  .refine(
    (content) => content.trim().length > 0,
    "OpenCode rule content cannot be only whitespace",
  );

/**
 * QwenCode rule schema
 */
export const qwencodeFilePathSchema = z
  .string()
  .refine(
    (path) => path.endsWith("QWEN.md") || path.endsWith("AGENTS.md") || path.endsWith("GEMINI.md"),
    "QwenCode rule file must be QWEN.md, AGENTS.md, or GEMINI.md",
  );

export const qwencodeContentSchema = z
  .string()
  .min(1, "QwenCode rule content cannot be empty")
  .refine(
    (content) => content.trim().length > 0,
    "QwenCode rule content cannot be only whitespace",
  );

/**
 * Roo Code rule schema
 */
export const rooFilePathSchema = z
  .string()
  .refine(
    (path) => path.includes(".roo/rules/") && path.endsWith(".md"),
    "Roo Code rule file must be in .roo/rules/ directory and have .md extension",
  );

export const rooContentSchema = z
  .string()
  .min(1, "Roo Code rule content cannot be empty")
  .refine(
    (content) => content.trim().length > 0,
    "Roo Code rule content cannot be only whitespace",
  );

/**
 * Gemini CLI rule schema
 */
export const geminicliFilePathSchema = z
  .string()
  .refine((path) => path.endsWith("GEMINI.md"), "Gemini CLI rule file must be named GEMINI.md");

export const geminicliContentSchema = z
  .string()
  .min(1, "Gemini CLI rule content cannot be empty")
  .refine(
    (content) => content.trim().length > 0,
    "Gemini CLI rule content cannot be only whitespace",
  );

/**
 * Kiro rule schema
 */
export const kiroFilePathSchema = z.string().refine((path) => {
  // Must end with .md
  if (!path.endsWith(".md")) return false;

  // Must contain .kiro/steering/
  const steeringIndex = path.indexOf(".kiro/steering/");
  if (steeringIndex === -1) return false;

  // Check that the file is directly in .kiro/steering/ (no subdirectories)
  const afterSteering = path.substring(steeringIndex + ".kiro/steering/".length);
  // Should not contain any path separators (meaning no subdirectories)
  return !afterSteering.includes("/") && !afterSteering.includes("\\");
}, "Kiro rule file must be in .kiro/steering/ directory and have .md extension");

export const kiroContentSchema = z
  .string()
  .min(1, "Kiro rule content cannot be empty")
  .refine((content) => content.trim().length > 0, "Kiro rule content cannot be only whitespace");

/**
 * Junie rule schema
 */
export const junieFilePathSchema = z
  .string()
  .refine(
    (path) => path.includes(".junie/") && path.endsWith("guidelines.md"),
    "Junie rule file must be .junie/guidelines.md",
  );

export const junieContentSchema = z
  .string()
  .min(1, "Junie rule content cannot be empty")
  .refine((content) => content.trim().length > 0, "Junie rule content cannot be only whitespace");

/**
 * Windsurf rule schema
 */
export const windsurfFilePathSchema = z
  .string()
  .refine(
    (path) =>
      path.endsWith("global_rules.md") ||
      (path.includes(".windsurf") && (path.endsWith(".windsurf-rules") || path.includes("rules/"))),
    "Windsurf rule file must be global_rules.md, .windsurf-rules, or in .windsurf/rules/ directory",
  );

export const windsurfContentSchema = z
  .string()
  .min(1, "Windsurf rule content cannot be empty")
  .refine(
    (content) => content.trim().length > 0,
    "Windsurf rule content cannot be only whitespace",
  );

// Type exports
export type RulesyncFrontmatter = z.infer<typeof rulesyncFrontmatterSchema>;
export type RulesyncConstructorParams = z.infer<typeof rulesyncConstructorSchema>;
export type ClaudecodeConstructorParams = z.infer<typeof claudecodeConstructorSchema>;
