import { basename, extname, join } from "node:path";

import { z } from "zod/mini";

import {
  KIMI_CODE_AGENTS_DIR_NAME,
  KIMI_CODE_SHARED_AGENTS_DIR_PATH,
} from "../../constants/kimi-code-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { getHomeDirectory, readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import {
  getKimiCodeHome,
  getKimiCodeRelativeDirPath,
  getKimiCodeRulesyncOutputRoot,
} from "../../utils/kimi-code.js";
import { RulesyncSubagent, type RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  type ToolSubagentForDeletionParams,
  type ToolSubagentFromFileParams,
  type ToolSubagentFromRulesyncSubagentParams,
  type ToolSubagentSettablePaths,
} from "./tool-subagent.js";

const KimiCodeAgentNameSchema = z.pipe(
  z.string(),
  z.custom<string>(
    (value) => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
    "must be a kebab-case name",
  ),
);

const KimiCodeSubagentFrontmatterSchema = z.looseObject({
  name: z.optional(KimiCodeAgentNameSchema),
  description: z.string(),
  whenToUse: z.optional(z.string()),
  override: z.optional(z.boolean()),
  tools: z.optional(z.union([z.string(), z.array(z.string())])),
  disallowedTools: z.optional(z.union([z.string(), z.array(z.string())])),
  subagents: z.optional(z.union([z.string(), z.array(z.string())])),
});

type KimiCodeSubagentFrontmatter = z.infer<typeof KimiCodeSubagentFrontmatterSchema>;

type KimiCodeSubagentParams = AiFileParams & {
  frontmatter: KimiCodeSubagentFrontmatter;
  body: string;
};

/**
 * Kimi Code custom agent.
 *
 * @see https://moonshotai.github.io/kimi-code/en/customization/agents.html
 */
export class KimiCodeSubagent extends ToolSubagent {
  private readonly frontmatter: KimiCodeSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, fileContent, ...rest }: KimiCodeSubagentParams) {
    if (rest.validate !== false) {
      const result = KimiCodeSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }
    super({
      ...rest,
      fileContent: fileContent ?? stringifyFrontmatter(body, frontmatter),
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    const customHome = global ? getKimiCodeHome() : undefined;
    return {
      relativeDirPath: getKimiCodeRelativeDirPath({
        global,
        relativeDirPath: KIMI_CODE_AGENTS_DIR_NAME,
      }),
      importDirPaths: [
        customHome
          ? {
              outputRoot: getHomeDirectory(),
              relativeDirPath: KIMI_CODE_SHARED_AGENTS_DIR_PATH,
            }
          : KIMI_CODE_SHARED_AGENTS_DIR_PATH,
      ],
    };
  }

  getFrontmatter(): KimiCodeSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  override getImportIdentity(): string {
    const fileName = basename(this.getRelativeFilePath(), extname(this.getRelativeFilePath()));
    return KimiCodeAgentNameSchema.parse(this.frontmatter.name ?? fileName).toLowerCase();
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name: _name, description, ...rest } = this.frontmatter;
    const resolvedName = this.getImportIdentity();
    const frontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"],
      name: resolvedName,
      description,
      ...(Object.keys(rest).length > 0 && { "kimi-code": rest }),
    };

    return new RulesyncSubagent({
      outputRoot: getKimiCodeRulesyncOutputRoot({
        nativeOutputRoot: this.outputRoot,
        global: this.global,
      }),
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: `${resolvedName}.md`,
      frontmatter,
      body: this.body,
      validate: true,
      global: this.global,
    });
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): KimiCodeSubagent {
    const frontmatter = rulesyncSubagent.getFrontmatter();
    const toolSection = frontmatter["kimi-code"] ?? {};
    const kimiCodeFrontmatter = KimiCodeSubagentFrontmatterSchema.parse({
      name: frontmatter.name,
      description: frontmatter.description,
      ...toolSection,
    });
    const body = rulesyncSubagent.getBody();

    return new KimiCodeSubagent({
      outputRoot,
      relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      frontmatter: kimiCodeFrontmatter,
      body,
      fileContent: stringifyFrontmatter(body, kimiCodeFrontmatter, {
        avoidBlockScalars: true,
      }),
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    const result = KimiCodeSubagentFrontmatterSchema.safeParse(this.frontmatter);
    return result.success
      ? { success: true, error: null }
      : {
          success: false,
          error: new Error(
            `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
          ),
        };
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "kimi-code",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<KimiCodeSubagent> {
    const actualRelativeDirPath =
      relativeDirPath ?? this.getSettablePaths({ global }).relativeDirPath;
    const filePath = join(outputRoot, actualRelativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);
    const result = KimiCodeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    return new KimiCodeSubagent({
      outputRoot,
      relativeDirPath: actualRelativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: body.trim(),
      fileContent,
      validate,
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolSubagentForDeletionParams): KimiCodeSubagent {
    return new KimiCodeSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      fileContent: "",
      validate: false,
      global,
    });
  }
}
