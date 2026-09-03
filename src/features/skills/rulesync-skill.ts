import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiDir, AiDirFile, containsPathSeparator, ValidationResult } from "../../types/ai-dir.js";
import { RulesyncTargetsSchema } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { parseFrontmatterWithYamlRepair } from "../../utils/frontmatter.js";

/**
 * Several targets use a skill's `name` verbatim as the directory name they write
 * (`roo`, `rovodev`, `junie`, `cline`), and `rulesync fetch` can pull a
 * skill from a third-party repository. `AiDir` also rejects the names that
 * `path.join` normalizes away, but it reports only the name, and it does not
 * reject the Windows-stripped spellings below; checking here catches the whole
 * set and names the offending skill's path.
 *
 * Rejected: names that `path.join` normalizes away (`"."`, `".."`, `""`), names
 * carrying a path separator, and names whose last character Windows strips from
 * a path component — a trailing dot or space would make the directory on disk
 * differ from the path the run claims, which turns it into an orphan.
 */
function isUnsafeSkillDirName(name: string): boolean {
  return (
    name === "" ||
    name === "." ||
    name === ".." ||
    containsPathSeparator(name) ||
    name.endsWith(".") ||
    name.endsWith(" ")
  );
}

const RulesyncSkillFrontmatterSchemaInternal = z.looseObject({
  name: z.string().check(
    z.refine((name) => !isUnsafeSkillDirName(name), {
      message:
        'name is used as a directory name: it may not be empty, "." or "..", contain a path separator, or end with a dot or a space',
    }),
  ),
  description: z.string(),
  targets: z._default(RulesyncTargetsSchema, ["*"]),
  // Default for tools that support the flag (claudecode, cursor, zed, pi, qwencode, grokcli, factorydroid).
  // A target-section value of the same key overrides this default.
  // `devin` also consumes this root value (mapping `true` onto a user-only
  // `triggers` list); it has no section key of the same name, but a
  // `devin.triggers` section value overrides it.
  "disable-model-invocation": z.optional(z.boolean()),
  // Default for tools that support the flag (claudecode, copilot, copilotcli, cursor,
  // qwencode, vibe, grokcli, factorydroid).
  // A target-section value of the same key overrides this default.
  // `devin` also consumes this root value (mapping `false` onto a model-only
  // `triggers` list); it has no section key of the same name, but a
  // `devin.triggers` section value overrides it.
  "user-invocable": z.optional(z.boolean()),
  // Shared defaults for the three Agent Skills standard packaging fields. Each
  // applies to every tool that models the field, and a target-section value of
  // the same key overrides it. The per-field tool lists live in
  // `docs/reference/file-formats.md` (the `.rulesync/skills/` frontmatter).
  // The Agent Skills spec types `compatibility` as a free-form string (1–500
  // chars) and `metadata` as a string→string map; the object form of
  // `compatibility` and non-string `metadata` values stay accepted for
  // back-compat and are normalized per target where the target requires it.
  license: z.optional(z.string()),
  compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
  metadata: z.optional(z.looseObject({})),
  claudecode: z.optional(
    z.looseObject({
      when_to_use: z.optional(z.string()),
      "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
      "disallowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
      model: z.optional(z.string()),
      effort: z.optional(z.string()),
      "argument-hint": z.optional(z.string()),
      arguments: z.optional(z.union([z.string(), z.array(z.string())])),
      context: z.optional(z.string()),
      agent: z.optional(z.string()),
      background: z.optional(z.boolean()),
      hooks: z.optional(z.looseObject({})),
      shell: z.optional(z.string()),
      "disable-model-invocation": z.optional(z.boolean()),
      "user-invocable": z.optional(z.boolean()),
      "scheduled-task": z.optional(z.boolean()),
      paths: z.optional(z.union([z.string(), z.array(z.string())])),
      license: z.optional(z.string()),
      compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
      metadata: z.optional(z.looseObject({})),
    }),
  ),
  codexcli: z.optional(
    z.looseObject({
      "short-description": z.optional(z.string()),
      // Fields emitted to the `agents/openai.yaml` sidecar next to SKILL.md.
      // See https://developers.openai.com/codex/skills.md
      interface: z.optional(
        z.looseObject({
          display_name: z.optional(z.string()),
          short_description: z.optional(z.string()),
          icon_small: z.optional(z.string()),
          icon_large: z.optional(z.string()),
          brand_color: z.optional(z.string()),
          default_prompt: z.optional(z.string()),
        }),
      ),
      policy: z.optional(
        z.looseObject({
          allow_implicit_invocation: z.optional(z.boolean()),
        }),
      ),
      dependencies: z.optional(
        z.looseObject({
          tools: z.optional(
            z.array(
              z.looseObject({
                type: z.optional(z.string()),
                value: z.optional(z.string()),
                description: z.optional(z.string()),
                transport: z.optional(z.string()),
                url: z.optional(z.string()),
              }),
            ),
          ),
        }),
      ),
    }),
  ),
  opencode: z.optional(
    z.looseObject({
      "allowed-tools": z.optional(z.array(z.string())),
      // OpenCode's actual `Frontmatter` schema (`packages/core/src/skill.ts`
      // in sst/opencode) does not define `license`, `compatibility`, or
      // `metadata` at all, so it never validates or rejects them. Left
      // untyped so rulesync never aborts on a value the tool itself
      // tolerates. See https://opencode.ai/docs/skills/
      license: z.optional(z.unknown()),
      compatibility: z.optional(z.unknown()),
      metadata: z.optional(z.unknown()),
    }),
  ),
  kilo: z.optional(
    z.looseObject({
      // `allowed-tools` is not part of Kilo's official SKILL.md frontmatter; it is
      // retained for backward compatibility with existing rulesync skill files.
      "allowed-tools": z.optional(z.array(z.string())),
      // Kilo Code's SKILL.md parser is forked from OpenCode's engine, whose
      // schema does not model `license`, `compatibility`, or `metadata` at
      // all, so it cannot reject any shape rulesync writes for them. Left
      // untyped so rulesync never aborts on a value the tool itself
      // tolerates.
      license: z.optional(z.unknown()),
      compatibility: z.optional(z.unknown()),
      metadata: z.optional(z.unknown()),
    }),
  ),
  kiro: z.optional(
    z.looseObject({
      // Kiro's SKILL.md frontmatter beyond `name`/`description`: `license`,
      // `compatibility` (a free-form string per the Agent Skills spec), and
      // `metadata`. https://kiro.dev/docs/skills/
      license: z.optional(z.string()),
      compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
      metadata: z.optional(z.looseObject({})),
    }),
  ),
  deepagents: z.optional(
    z.looseObject({
      "allowed-tools": z.optional(z.array(z.string())),
      // dcode's `_parse_skill_metadata` never hard-fails on an unexpected
      // shape for `license`, `compatibility`, or `metadata`: values are
      // coerced with `str()`, an overlong `compatibility` is truncated with a
      // logged warning, and non-dict `metadata` is replaced with `{}` and a
      // logged warning. Left untyped so rulesync never aborts on a value the
      // tool itself tolerates.
      license: z.optional(z.unknown()),
      compatibility: z.optional(z.unknown()),
      metadata: z.optional(z.unknown()),
    }),
  ),
  copilot: z.optional(
    z.looseObject({
      license: z.optional(z.string()),
      "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
      "argument-hint": z.optional(z.string()),
      // The same two invocation gates the `copilotcli` section carries; both
      // targets write the same SKILL.md shape.
      "user-invocable": z.optional(z.boolean()),
      "disable-model-invocation": z.optional(z.boolean()),
      // VS Code's experimental execution context (`fork`).
      context: z.optional(z.string()),
    }),
  ),
  copilotcli: z.optional(
    z.looseObject({
      license: z.optional(z.string()),
      "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
      "argument-hint": z.optional(z.string()),
      // Copilot CLI's two invocation gates: `user-invocable` (default true)
      // controls `/SKILL-NAME`, `disable-model-invocation` (default false)
      // stops the agent from picking the skill up on its own.
      "user-invocable": z.optional(z.boolean()),
      "disable-model-invocation": z.optional(z.boolean()),
    }),
  ),
  pi: z.optional(
    z.looseObject({
      // Pi implements the Agent Skills spec: `allowed-tools` is a
      // space-delimited string and `compatibility` a 1-500 character string.
      // Both legacy rulesync forms stay accepted.
      // https://agentskills.io/specification
      "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
      "disable-model-invocation": z.optional(z.boolean()),
      license: z.optional(z.string()),
      compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
      metadata: z.optional(z.looseObject({})),
    }),
  ),
  zed: z.optional(
    z.looseObject({
      "disable-model-invocation": z.optional(z.boolean()),
    }),
  ),
  replit: z.optional(
    z.looseObject({
      // Replit conforms to the Agent Skills spec: `allowed-tools` is a
      // space-separated string and `compatibility` a 1-500 character string.
      // Both legacy rulesync forms stay accepted.
      // https://agentskills.io/specification
      "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
      license: z.optional(z.string()),
      compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
      metadata: z.optional(z.looseObject({})),
    }),
  ),
  cline: z.optional(z.looseObject({})),
  roo: z.optional(z.looseObject({})),
  // Amp reads the open Agent Skills standard and documents no field beyond
  // `name`/`description`, so this section only carries keys a hand-written
  // SKILL.md happens to add.
  amp: z.optional(z.looseObject({})),
  devin: z.optional(
    z.looseObject({
      "argument-hint": z.optional(z.string()),
      model: z.optional(z.string()),
      subagent: z.optional(z.union([z.string(), z.boolean()])),
      agent: z.optional(z.string()),
      "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
      // Load-bearing for auto-approvals since Devin CLI v3000.1.23.
      permissions: z.optional(z.looseObject({})),
      // Omitted = both; the canonical disable-model-invocation/user-invocable
      // flags map onto this when the section does not state it outright.
      triggers: z.optional(z.array(z.enum(["user", "model"]))),
    }),
  ),
  qwencode: z.optional(
    z.looseObject({
      priority: z.optional(z.number()),
      // Qwen Code's parser requires an array; a scalar is coerced on emit.
      paths: z.optional(z.union([z.string(), z.array(z.string())])),
      "user-invocable": z.optional(z.boolean()),
      "disable-model-invocation": z.optional(z.boolean()),
      allowedTools: z.optional(z.array(z.string())),
      model: z.optional(z.string()),
      hooks: z.optional(z.looseObject({})),
      when_to_use: z.optional(z.string()),
      "argument-hint": z.optional(z.string()),
    }),
  ),
  rovodev: z.optional(
    z.looseObject({
      "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
      license: z.optional(z.string()),
      // The Agent Skills spec defines `compatibility` as a free-form string
      // (1–500 chars); the object form stays accepted for back-compat.
      compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
      metadata: z.optional(z.looseObject({})),
    }),
  ),
  cursor: z.optional(
    z.looseObject({
      paths: z.optional(z.union([z.string(), z.array(z.string())])),
      "disable-model-invocation": z.optional(z.boolean()),
      "user-invocable": z.optional(z.boolean()),
      metadata: z.optional(z.looseObject({})),
    }),
  ),
  factorydroid: z.optional(
    z.looseObject({
      "disable-model-invocation": z.optional(z.boolean()),
      "user-invocable": z.optional(z.boolean()),
      // `enabled: false` keeps the skill on disk but stops Droid loading it.
      enabled: z.optional(z.boolean()),
      "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
      // Packaging metadata for shared or catalogued skills. Droid documents
      // these without a type and never validates them, so they are carried
      // through as-is rather than type-constrained — see `factorydroid-skill.ts`.
      // https://docs.factory.ai/cli/configuration/skills
      license: z.optional(z.unknown()),
      compatibility: z.optional(z.unknown()),
      metadata: z.optional(z.unknown()),
      version: z.optional(z.unknown()),
    }),
  ),
  // Grok honours both flags: `user-invocable: false` hides a skill from the
  // skill tool, `disable-model-invocation: true` blocks auto-invocation.
  grokcli: z.optional(
    z.looseObject({
      "disable-model-invocation": z.optional(z.boolean()),
      "user-invocable": z.optional(z.boolean()),
    }),
  ),
  "kimi-code": z.optional(
    z.looseObject({
      type: z.optional(z.enum(["prompt", "inline", "flow"])),
      whenToUse: z.optional(z.string()),
      disableModelInvocation: z.optional(z.boolean()),
      arguments: z.optional(z.union([z.string(), z.array(z.string())])),
    }),
  ),
  agentsskills: z.optional(
    z.looseObject({
      license: z.optional(z.string()),
      // The Agent Skills spec defines `compatibility` as a free-form string
      // (1–500 chars); the object form stays accepted for back-compat.
      compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
      metadata: z.optional(z.looseObject({})),
      "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
    }),
  ),
  hermesagent: z.optional(z.looseObject({})),
  vibe: z.optional(
    z.looseObject({
      license: z.optional(z.string()),
      compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
      metadata: z.optional(z.looseObject({})),
      "user-invocable": z.optional(z.boolean()),
      "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
    }),
  ),
  takt: z.optional(
    z.looseObject({
      // Rename the emitted file stem (e.g. "test-skill.md" → "{name}.md").
      name: z.optional(z.string()),
      // Facet inheritance: emit a leading `{extends:<parent>}` directive (Takt 0.39.0+).
      // Skills map to the `knowledge` facet, which supports inheritance.
      extends: z.optional(z.string()),
    }),
  ),
});

// Export schema with targets optional for input but guaranteed in output
export const RulesyncSkillFrontmatterSchema = RulesyncSkillFrontmatterSchemaInternal;

// Type for input (targets is optional)
export type RulesyncSkillFrontmatterInput = {
  name: string;
  description: string;
  targets?: ("*" | string)[];
  "disable-model-invocation"?: boolean;
  "user-invocable"?: boolean;
  license?: string;
  compatibility?: string | Record<string, unknown>;
  metadata?: Record<string, unknown>;
  claudecode?: {
    when_to_use?: string;
    "allowed-tools"?: string | string[];
    "disallowed-tools"?: string | string[];
    model?: string;
    effort?: string;
    "argument-hint"?: string;
    arguments?: string | string[];
    context?: string;
    agent?: string;
    background?: boolean;
    hooks?: Record<string, unknown>;
    shell?: string;
    "disable-model-invocation"?: boolean;
    "user-invocable"?: boolean;
    "scheduled-task"?: boolean;
    paths?: string | string[];
    license?: string;
    compatibility?: string | Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  grokcli?: {
    "disable-model-invocation"?: boolean;
    "user-invocable"?: boolean;
  };
  codexcli?: {
    "short-description"?: string;
    interface?: {
      display_name?: string;
      short_description?: string;
      icon_small?: string;
      icon_large?: string;
      brand_color?: string;
      default_prompt?: string;
    };
    policy?: {
      allow_implicit_invocation?: boolean;
    };
    dependencies?: {
      tools?: Array<{
        type?: string;
        value?: string;
        description?: string;
        transport?: string;
        url?: string;
      }>;
    };
  };
  opencode?: {
    "allowed-tools"?: string[];
    license?: unknown;
    compatibility?: unknown;
    metadata?: unknown;
  };
  kilo?: {
    "allowed-tools"?: string[];
    license?: unknown;
    compatibility?: unknown;
    metadata?: unknown;
  };
  kiro?: {
    license?: string;
    compatibility?: string | Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  deepagents?: {
    "allowed-tools"?: string[];
    license?: unknown;
    compatibility?: unknown;
    metadata?: unknown;
  };
  copilot?: {
    license?: string;
    "allowed-tools"?: string | string[];
    "argument-hint"?: string;
    "user-invocable"?: boolean;
    "disable-model-invocation"?: boolean;
    context?: string;
  };
  copilotcli?: {
    license?: string;
    "allowed-tools"?: string | string[];
    "argument-hint"?: string;
    "user-invocable"?: boolean;
    "disable-model-invocation"?: boolean;
  };
  pi?: {
    "allowed-tools"?: string | string[];
    "disable-model-invocation"?: boolean;
    license?: string;
    compatibility?: string | Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  zed?: {
    "disable-model-invocation"?: boolean;
  };
  replit?: {
    "allowed-tools"?: string | string[];
    license?: string;
    compatibility?: string | Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  roo?: Record<string, unknown>;
  cline?: Record<string, unknown>;
  amp?: Record<string, unknown>;
  devin?: {
    "argument-hint"?: string;
    model?: string;
    subagent?: string | boolean;
    agent?: string;
    "allowed-tools"?: string | string[];
    permissions?: Record<string, unknown>;
    triggers?: ("user" | "model")[];
  };
  qwencode?: {
    priority?: number;
    paths?: string | string[];
    "user-invocable"?: boolean;
    "disable-model-invocation"?: boolean;
    allowedTools?: string[];
    model?: string;
    hooks?: Record<string, unknown>;
    when_to_use?: string;
    "argument-hint"?: string;
  };
  rovodev?: {
    "allowed-tools"?: string | string[];
    license?: string;
    compatibility?: string | Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  cursor?: {
    paths?: string | string[];
    "disable-model-invocation"?: boolean;
    "user-invocable"?: boolean;
    metadata?: Record<string, unknown>;
  };
  factorydroid?: {
    "disable-model-invocation"?: boolean;
    "user-invocable"?: boolean;
    enabled?: boolean;
    "allowed-tools"?: string | string[];
    license?: unknown;
    compatibility?: unknown;
    metadata?: unknown;
    version?: unknown;
  };
  "kimi-code"?: {
    type?: "prompt" | "inline" | "flow";
    whenToUse?: string;
    disableModelInvocation?: boolean;
    arguments?: string | string[];
  };
  agentsskills?: {
    license?: string;
    compatibility?: string | Record<string, unknown>;
    metadata?: Record<string, unknown>;
    "allowed-tools"?: string | string[];
  };
  hermesagent?: Record<string, unknown>;
  vibe?: {
    license?: string;
    compatibility?: string | Record<string, unknown>;
    metadata?: Record<string, unknown>;
    "user-invocable"?: boolean;
    "allowed-tools"?: string | string[];
  };
  takt?: {
    name?: string;
    extends?: string;
  };
};

// Type for output/validated data (targets is always present after validation)
export type RulesyncSkillFrontmatter = z.infer<typeof RulesyncSkillFrontmatterSchemaInternal>;

/**
 * Type alias for AiDirFile, specific to skill files
 */
export type SkillFile = AiDirFile;

export type RulesyncSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: RulesyncSkillFrontmatterInput;
  body: string;
  otherFiles?: AiDirFile[];
  validate?: boolean;
  global?: boolean;
};

export type RulesyncSkillSettablePaths = {
  relativeDirPath: string;
};

export type RulesyncSkillFromDirParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  global?: boolean;
};

/**
 * Represents a Rulesync skill directory with SKILL.md and optional additional files.
 * Extends AiDir to inherit directory management and security features.
 */
export class RulesyncSkill extends AiDir {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = RULESYNC_SKILLS_RELATIVE_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: RulesyncSkillParams) {
    super({
      outputRoot,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter },
      },
      otherFiles,
      global,
    });

    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(): RulesyncSkillSettablePaths {
    // Rulesync skills use the same relative path for both project and global modes
    // The actual location differs based on outputRoot:
    // - Project mode: {process.cwd()}/.rulesync/skills/
    // - Global mode: {getHomeDirectory()}/.rulesync/skills/
    return {
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
    };
  }

  getFrontmatter(): RulesyncSkillFrontmatter {
    if (!this.mainFile?.frontmatter) {
      throw new Error(`Frontmatter is not defined in ${join(this.relativeDirPath, this.dirName)}`);
    }
    const result = RulesyncSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }

  getBody(): string {
    return this.mainFile?.body ?? "";
  }

  validate(): ValidationResult {
    const result = RulesyncSkillFrontmatterSchema.safeParse(this.mainFile?.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`,
        ),
      };
    }

    return { success: true, error: null };
  }

  static async fromDir({
    outputRoot = process.cwd(),
    relativeDirPath = RULESYNC_SKILLS_RELATIVE_DIR_PATH,
    dirName,
    global = false,
  }: RulesyncSkillFromDirParams): Promise<RulesyncSkill> {
    const skillDirPath = join(outputRoot, relativeDirPath, dirName);
    const skillFilePath = join(skillDirPath, SKILL_FILE_NAME);

    if (!(await fileExists(skillFilePath))) {
      throw new Error(`${SKILL_FILE_NAME} not found in ${skillDirPath}`);
    }

    const fileContent = await readFileContent(skillFilePath);
    const {
      frontmatter,
      body: content,
      hasFrontmatter,
    } = parseFrontmatterWithYamlRepair(fileContent, skillFilePath);

    if (!hasFrontmatter) {
      throw new Error(
        `Missing frontmatter in ${skillFilePath}. Rulesync files must begin with a YAML frontmatter block delimited by '---'.`,
      );
    }

    const result = RulesyncSkillFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${skillFilePath}: ${formatError(result.error)}`);
    }
    const otherFiles = await this.collectOtherFiles(
      outputRoot,
      relativeDirPath,
      dirName,
      SKILL_FILE_NAME,
    );

    return new RulesyncSkill({
      outputRoot,
      relativeDirPath,
      dirName,
      frontmatter: result.data,
      body: content.trim(),
      otherFiles,
      validate: true,
      global,
    });
  }
}
