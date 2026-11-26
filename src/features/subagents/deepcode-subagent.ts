import { basename, extname, join } from "node:path";

import { z } from "zod/mini";

import {
  DEEPCODE_GLOBAL_PRESETS_DIR_PATH,
  DEEPCODE_PROJECT_PRESETS_DIR_PATH,
} from "../../constants/deepcode-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  validateFrontmatterSchema,
} from "../../utils/frontmatter.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  parseGeneratedSubagentFrontmatter,
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Front matter of a DeepCode agent preset. Every key is optional: the file
 * name is the preset id, and `name` (shown in the picker) falls back to it.
 * `tools` / `disallowed-tools` are lists or comma-separated strings. Unknown
 * keys are kept (looseObject).
 *
 * @see https://github.com/HKUDS/DeepCode/blob/main/docs/guide/configuration.md#agent-presets
 */
const DeepcodeSubagentFrontmatterSchema = z.looseObject({
  name: z.optional(z.string()),
  description: z.optional(z.string()),
  tools: z.optional(z.union([z.string(), z.array(z.string())])),
  "disallowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
  "prompt-mode": z.optional(z.string()),
  "allow-spawn": z.optional(z.boolean()),
  model: z.optional(z.string()),
  order: z.optional(z.number()),
});

/**
 * DeepCode's preset id rule (`_PRESET_ID_RE`, at most 64 characters): a file
 * whose name breaks it is listed as a broken preset and cannot be picked.
 */
const DEEPCODE_PRESET_ID = /^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type DeepcodeSubagentFrontmatter = z.infer<typeof DeepcodeSubagentFrontmatterSchema>;

export type DeepcodeSubagentParams = {
  frontmatter: DeepcodeSubagentFrontmatter;
  body: string;
} & AiFileParams;

/**
 * Subagent generator for DeepCode agent presets.
 *
 * A preset is Markdown with YAML front matter whose body is added to the
 * system prompt. rulesync writes `<project>/.agents/presets/<name>.md` and,
 * globally, `~/.deepcode/agent-presets/<name>.md` (the DeepCode-named user
 * folder). `name` and `description` come from the rulesync subagent; the
 * `deepcode` section (`tools`, `disallowed-tools`, `prompt-mode`,
 * `allow-spawn`, `model`, `order`, ...) is spread on top, so a value set there
 * wins.
 *
 * @see https://github.com/HKUDS/DeepCode/blob/main/docs/guide/configuration.md#agent-presets
 */
export class DeepcodeSubagent extends ToolSubagent {
  private readonly frontmatter: DeepcodeSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: DeepcodeSubagentParams) {
    if (rest.validate !== false) {
      const result = DeepcodeSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: global
        ? DEEPCODE_GLOBAL_PRESETS_DIR_PATH
        : DEEPCODE_PROJECT_PRESETS_DIR_PATH,
    };
  }

  getFrontmatter(): DeepcodeSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, ...restFields } = this.frontmatter;
    const relativeFilePath = this.getRelativeFilePath();
    // DeepCode falls back to the preset id (the file name) for a missing name.
    const presetId = basename(relativeFilePath, extname(relativeFilePath));

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"],
      name: name ?? presetId,
      ...(description && { description }),
      ...(Object.keys(restFields).length > 0 && { deepcode: restFields }),
    };

    return new RulesyncSubagent({
      outputRoot: ".", // RulesyncSubagent outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath,
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
    logger,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const relativeFilePath = rulesyncSubagent.getRelativeFilePath();
    const presetId = basename(relativeFilePath, extname(relativeFilePath));
    if (!DEEPCODE_PRESET_ID.test(presetId) || presetId.length > 64) {
      logger?.warn(
        `DeepCode subagent ${quoteValueForWarning(relativeFilePath)}: DeepCode uses the file name as the preset id and lists a name that is not kebab-case (lowercase letters, digits and single hyphens, at most 64 characters) as a broken preset; rename the rulesync subagent file.`,
      );
    }
    const deepcodeSection = this.filterToolSpecificSection(rulesyncFrontmatter.deepcode ?? {}, [
      "name",
      "description",
    ]);

    const deepcodeFrontmatter = parseGeneratedSubagentFrontmatter({
      schema: DeepcodeSubagentFrontmatterSchema,
      frontmatter: {
        name: rulesyncFrontmatter.name,
        ...(rulesyncFrontmatter.description !== undefined && {
          description: rulesyncFrontmatter.description,
        }),
        ...deepcodeSection,
      },
      toolTarget: "deepcode",
      rulesyncSubagent,
    });

    const body = rulesyncSubagent.getBody();

    return new DeepcodeSubagent({
      outputRoot,
      frontmatter: deepcodeFrontmatter,
      body,
      relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
      relativeFilePath,
      fileContent: stringifyFrontmatter(body, deepcodeFrontmatter),
      validate,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    return validateFrontmatterSchema({
      schema: DeepcodeSubagentFrontmatterSchema,
      frontmatter: this.frontmatter,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
    });
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "deepcode",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<DeepcodeSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    const result = DeepcodeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new DeepcodeSubagent({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: body.trim(),
      fileContent,
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): DeepcodeSubagent {
    return new DeepcodeSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
