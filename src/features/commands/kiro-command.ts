import { join } from "node:path";
import { z } from "zod/mini";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

// Kiro IDE hook JSON schema
export const KiroCommandJsonSchema = z.looseObject({
  enabled: z._default(z.boolean(), true),
  name: z.string(),
  description: z.string(),
  version: z._default(z.string(), "1"),
  when: z.looseObject({
    type: z.literal("userTriggered"),
  }),
  then: z.looseObject({
    type: z.literal("askAgent"),
    prompt: z.string(),
  }),
});

export type KiroCommandJson = z.infer<typeof KiroCommandJsonSchema>;

export type KiroCommandParams = {
  json: KiroCommandJson;
} & Omit<AiFileParams, "fileContent">;

/**
 * Command generator for Kiro IDE
 *
 * Generates hook files for Kiro IDE's agent hooks system.
 * Outputs to .kiro/hooks/ directory as .kiro.hook JSON files.
 * Only supports manual trigger (userTriggered) hooks.
 */
export class KiroCommand extends ToolCommand {
  private readonly json: KiroCommandJson;

  constructor({ json, ...rest }: KiroCommandParams) {
    if (rest.validate) {
      const result = KiroCommandJsonSchema.safeParse(json);
      if (!result.success) {
        throw new Error(
          `Invalid hook JSON in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: JSON.stringify(json, null, 2),
    });

    this.json = json;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: join(".kiro", "hooks"),
    };
  }

  getJson(): KiroCommandJson {
    return this.json;
  }

  toRulesyncCommand(): RulesyncCommand {
    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["kiro"],
      description: this.json.description,
    };

    const body = this.json.then.prompt;
    const relativeFilePath = this.relativeFilePath.replace(/\.kiro\.hook$/, ".md");

    return new RulesyncCommand({
      baseDir: ".",
      frontmatter: rulesyncFrontmatter,
      body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: true,
    });
  }

  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): KiroCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const kiroFields = rulesyncFrontmatter.kiro;

    const name = kiroFields?.name ?? rulesyncFrontmatter.description;

    const json: KiroCommandJson = {
      enabled: true,
      name: String(name),
      description: rulesyncFrontmatter.description,
      version: "1",
      when: { type: "userTriggered" },
      then: {
        type: "askAgent",
        prompt: rulesyncCommand.getBody(),
      },
    };

    const paths = this.getSettablePaths();
    const relativeFilePath = rulesyncCommand.getRelativeFilePath().replace(/\.md$/, ".kiro.hook");

    return new KiroCommand({
      baseDir,
      json,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      validate,
    });
  }

  validate(): ValidationResult {
    const result = KiroCommandJsonSchema.safeParse(this.json);
    if (result.success) {
      return { success: true, error: null };
    }
    return {
      success: false,
      error: new Error(
        `Invalid hook JSON in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
      ),
    };
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "kiro",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<KiroCommand> {
    const paths = this.getSettablePaths();
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);

    const json = JSON.parse(fileContent);
    const result = KiroCommandJsonSchema.safeParse(json);
    if (!result.success) {
      throw new Error(`Invalid hook JSON in ${filePath}: ${formatError(result.error)}`);
    }

    return new KiroCommand({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      json: result.data,
      validate,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): KiroCommand {
    return new KiroCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      json: {
        enabled: true,
        name: "",
        description: "",
        version: "1",
        when: { type: "userTriggered" },
        then: { type: "askAgent", prompt: "" },
      },
      validate: false,
    });
  }
}
