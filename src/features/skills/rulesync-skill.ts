import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiDir, AiDirFile, ValidationResult } from "../../types/ai-dir.js";
import { RulesyncTargetsSchema } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";

const RulesyncSkillFrontmatterSchemaInternal = z.looseObject({
  name: z.string(),
  description: z.string(),
  targets: z._default(RulesyncTargetsSchema, ["*"]),
  claudecode: z.optional(
    z.looseObject({
      "allowed-tools": z.optional(z.array(z.string())),
      "disallowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
      model: z.optional(z.string()),
      "disable-model-invocation": z.optional(z.boolean()),
      "scheduled-task": z.optional(z.boolean()),
      paths: z.optional(z.union([z.string(), z.array(z.string())])),
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
    }),
  ),
  kilo: z.optional(
    z.looseObject({
      "allowed-tools": z.optional(z.array(z.string())),
    }),
  ),
  deepagents: z.optional(
    z.looseObject({
      "allowed-tools": z.optional(z.array(z.string())),
    }),
  ),
  copilot: z.optional(
    z.looseObject({
      license: z.optional(z.string()),
      "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
    }),
  ),
  pi: z.optional(
    z.looseObject({
      "allowed-tools": z.optional(z.array(z.string())),
      "disable-model-invocation": z.optional(z.boolean()),
      license: z.optional(z.string()),
      compatibility: z.optional(z.looseObject({})),
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
      "allowed-tools": z.optional(z.array(z.string())),
      license: z.optional(z.string()),
      compatibility: z.optional(z.looseObject({})),
      metadata: z.optional(z.looseObject({})),
    }),
  ),
  cline: z.optional(z.looseObject({})),
  roo: z.optional(z.looseObject({})),
  rovodev: z.optional(
    z.looseObject({
      "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
      license: z.optional(z.string()),
      metadata: z.optional(z.looseObject({})),
    }),
  ),
  cursor: z.optional(
    z.looseObject({
      paths: z.optional(z.union([z.string(), z.array(z.string())])),
      "disable-model-invocation": z.optional(z.boolean()),
      metadata: z.optional(z.looseObject({})),
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
  claudecode?: {
    "allowed-tools"?: string[];
    "disallowed-tools"?: string | string[];
    model?: string;
    "disable-model-invocation"?: boolean;
    "scheduled-task"?: boolean;
    paths?: string | string[];
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
  };
  kilo?: {
    "allowed-tools"?: string[];
  };
  deepagents?: {
    "allowed-tools"?: string[];
  };
  copilot?: {
    license?: string;
    "allowed-tools"?: string | string[];
  };
  pi?: {
    "allowed-tools"?: string[];
    "disable-model-invocation"?: boolean;
    license?: string;
    compatibility?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  zed?: {
    "disable-model-invocation"?: boolean;
  };
  replit?: {
    "allowed-tools"?: string[];
    license?: string;
    compatibility?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  roo?: Record<string, unknown>;
  cline?: Record<string, unknown>;
  rovodev?: {
    "allowed-tools"?: string | string[];
    license?: string;
    metadata?: Record<string, unknown>;
  };
  cursor?: {
    paths?: string | string[];
    "disable-model-invocation"?: boolean;
    metadata?: Record<string, unknown>;
  };
  agentsskills?: {
    license?: string;
    compatibility?: string | Record<string, unknown>;
    metadata?: Record<string, unknown>;
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
    const { frontmatter, body: content } = parseFrontmatter(fileContent, skillFilePath);

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
