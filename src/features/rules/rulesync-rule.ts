import { join } from "node:path";

import { z } from "zod/mini";

import {
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { type ValidationResult } from "../../types/ai-file.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  type RulesyncFileParams,
} from "../../types/rulesync-file.js";
import { RulesyncTargetsSchema } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";

export const RulesyncRuleFrontmatterSchema = z.object({
  root: z.optional(z.boolean()),
  localRoot: z.optional(z.boolean()),
  targets: z._default(RulesyncTargetsSchema, ["*"]),
  description: z.optional(z.string()),
  globs: z.optional(z.array(z.string())),
  agentsmd: z.optional(
    z.looseObject({
      // @example "path/to/subproject"
      subprojectPath: z.optional(z.string()),
    }),
  ),
  claudecode: z.optional(
    z.looseObject({
      // Glob patterns for conditional rules (takes precedence over globs)
      // @example ["src/**/*.ts", "tests/**/*.test.ts"]
      paths: z.optional(z.array(z.string())),
    }),
  ),
  cursor: z.optional(
    z.looseObject({
      alwaysApply: z.optional(z.boolean()),
      description: z.optional(z.string()),
      globs: z.optional(z.array(z.string())),
    }),
  ),
  copilot: z.optional(
    z.looseObject({
      // `cloud-agent` is the current documented value; `coding-agent` is a deprecated alias.
      excludeAgent: z.optional(
        z.union([z.literal("code-review"), z.literal("cloud-agent"), z.literal("coding-agent")]),
      ),
    }),
  ),
  antigravity: z.optional(
    z.looseObject({
      trigger: z.optional(z.string()),
      globs: z.optional(z.array(z.string())),
    }),
  ),
  devin: z.optional(
    z.looseObject({
      // Activation mode: always_on | glob | manual | model_decision
      trigger: z.optional(z.string()),
      globs: z.optional(z.array(z.string())),
      description: z.optional(z.string()),
    }),
  ),
  augmentcode: z.optional(
    z.looseObject({
      type: z.optional(z.string()),
      description: z.optional(z.string()),
    }),
  ),
  kiro: z.optional(
    z.looseObject({
      // Steering inclusion mode: always | fileMatch | manual (string for forward compat).
      inclusion: z.optional(z.string()),
      // Glob(s) used when `inclusion: fileMatch`. Kiro accepts a single string or
      // a YAML array of globs.
      fileMatchPattern: z.optional(z.union([z.string(), z.array(z.string())])),
    }),
  ),
  takt: z.optional(
    z.looseObject({
      // Rename the emitted file stem (e.g. "coder.md" → "{name}.md").
      name: z.optional(z.string()),
      // Facet inheritance: emit a leading `{extends:<parent>}` directive (Takt 0.39.0+).
      // Rules map to the `policies` facet, which supports inheritance.
      extends: z.optional(z.string()),
      // Redirect the rule to a different writable Takt facet. Rules default to the
      // `policies` facet; set `facet: "output-contracts"` to author an output-contract
      // facet (output structure / report templates) instead. Both facets support
      // `{extends:...}` inheritance. See docs/reference/file-formats.md.
      facet: z.optional(z.enum(["policies", "output-contracts"])),
    }),
  ),
});

// Input type allows targets to be omitted (will use default value)
export type RulesyncRuleFrontmatterInput = z.input<typeof RulesyncRuleFrontmatterSchema>;
// Output type has targets always present after parsing
export type RulesyncRuleFrontmatter = z.infer<typeof RulesyncRuleFrontmatterSchema>;

export type RulesyncRuleParams = Omit<RulesyncFileParams, "fileContent"> & {
  frontmatter: RulesyncRuleFrontmatterInput;
  body: string;
};

export type RulesyncRuleSettablePaths = {
  recommended: {
    relativeDirPath: string;
  };
  legacy: {
    relativeDirPath: string;
  };
};

export class RulesyncRule extends RulesyncFile {
  private readonly frontmatter: RulesyncRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: RulesyncRuleParams) {
    // Parse frontmatter to apply defaults and validate
    const parseResult = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
    if (!parseResult.success && rest.validate !== false) {
      throw new Error(
        `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(parseResult.error)}`,
      );
    }
    // Apply defaults manually when validation is disabled but parsing failed
    const parsedFrontmatter: RulesyncRuleFrontmatter = parseResult.success
      ? parseResult.data
      : { ...frontmatter, targets: frontmatter.targets ?? ["*"] };

    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, parsedFrontmatter),
    });

    this.frontmatter = parsedFrontmatter;
    this.body = body;
  }

  static getSettablePaths(): RulesyncRuleSettablePaths {
    return {
      recommended: {
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      },
      legacy: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      },
    };
  }

  getFrontmatter(): RulesyncRuleFrontmatter {
    return this.frontmatter;
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = RulesyncRuleFrontmatterSchema.safeParse(this.frontmatter);

    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
        ),
      };
    }
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: RulesyncFileFromFileParams): Promise<RulesyncRule> {
    const filePath = join(
      outputRoot,
      this.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath,
    );

    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content, hasFrontmatter } = parseFrontmatter(fileContent, filePath);

    // Check that the file actually contains a YAML frontmatter block.
    // Without this check, a file without frontmatter would be silently accepted
    // with default values (targets: ["*"], root: false, etc.), which is almost
    // certainly not what the user intended. See issue #316.
    if (!hasFrontmatter) {
      throw new Error(
        `Missing frontmatter in ${filePath}. Rulesync files must begin with a YAML frontmatter block delimited by '---'.`,
      );
    }

    // Validate frontmatter using RuleFrontmatterSchema
    const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    const validatedFrontmatter: RulesyncRuleFrontmatter = {
      ...result.data,
      root: result.data.root ?? false,
      localRoot: result.data.localRoot ?? false,
      globs: result.data.globs ?? [],
    };

    return new RulesyncRule({
      outputRoot,
      relativeDirPath: this.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath,
      frontmatter: validatedFrontmatter,
      body: content.trim(),
      validate,
    });
  }

  getBody(): string {
    return this.body;
  }
}
