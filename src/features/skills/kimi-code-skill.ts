import { basename, extname, join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  KIMI_CODE_SKILLS_DIR_NAME,
  KIMI_CODE_SHARED_SKILLS_DIR_PATH,
  KIMI_CODE_SKILLS_DIR_PATH,
} from "../../constants/kimi-code-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import type { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { getHomeDirectory, readFileContent } from "../../utils/file.js";
import { parseFrontmatterWithYamlRepair } from "../../utils/frontmatter.js";
import {
  getKimiCodeHome,
  getKimiCodeRelativeDirPath,
  getKimiCodeRulesyncOutputRoot,
} from "../../utils/kimi-code.js";
import {
  RulesyncSkill,
  type RulesyncSkillFrontmatterInput,
  type SkillFile,
} from "./rulesync-skill.js";
import {
  ToolSkill,
  type ToolSkillForDeletionParams,
  type ToolSkillFromDirParams,
  type ToolSkillFromFlatFileParams,
  type ToolSkillFromRulesyncSkillParams,
  type ToolSkillSettablePaths,
} from "./tool-skill.js";

const KimiCodeSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  type: z.optional(z.enum(["prompt", "inline", "flow"])),
  whenToUse: z.optional(z.string()),
  disableModelInvocation: z.optional(z.boolean()),
  arguments: z.optional(z.union([z.string(), z.array(z.string())])),
});

const KimiCodeFlatSkillFrontmatterSchema = z.looseObject({
  name: z.optional(z.string()),
  description: z.optional(z.string()),
  type: z.optional(z.enum(["prompt", "inline", "flow"])),
  whenToUse: z.optional(z.string()),
  disableModelInvocation: z.optional(z.boolean()),
  arguments: z.optional(z.union([z.string(), z.array(z.string())])),
});

type KimiCodeSkillFrontmatter = z.infer<typeof KimiCodeSkillFrontmatterSchema>;

type KimiCodeSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: KimiCodeSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

function logicalSkillDirName(name: string): string {
  const normalized = name.toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)
    ? normalized
    : `kimi-${encodeURIComponent(normalized)}`;
}

/**
 * Kimi Code Agent Skill.
 *
 * @see https://moonshotai.github.io/kimi-code/en/customization/skills.html
 */
export class KimiCodeSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = KIMI_CODE_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: KimiCodeSkillParams) {
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

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolSkillSettablePaths {
    const customHome = global ? getKimiCodeHome() : undefined;
    return {
      relativeDirPath: getKimiCodeRelativeDirPath({
        global,
        relativeDirPath: KIMI_CODE_SKILLS_DIR_NAME,
      }),
      importOnlySkillRoots: [
        customHome
          ? {
              outputRoot: getHomeDirectory(),
              relativeDirPath: KIMI_CODE_SHARED_SKILLS_DIR_PATH,
            }
          : KIMI_CODE_SHARED_SKILLS_DIR_PATH,
      ],
    };
  }

  getFrontmatter(): KimiCodeSkillFrontmatter {
    return KimiCodeSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
  }

  getBody(): string {
    return this.mainFile?.body ?? "";
  }

  override getImportIdentity(): string {
    return this.getFrontmatter().name.toLowerCase();
  }

  validate(): ValidationResult {
    if (!this.mainFile) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`),
      };
    }
    const result = KimiCodeSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    return result.success
      ? { success: true, error: null }
      : {
          success: false,
          error: new Error(
            `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`,
          ),
        };
  }

  toRulesyncSkill(): RulesyncSkill {
    const { name, description, disableModelInvocation, ...kimiCodeFrontmatter } =
      this.getFrontmatter();
    const toolSection = {
      ...kimiCodeFrontmatter,
      ...(disableModelInvocation !== undefined && { disableModelInvocation }),
    };

    const frontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(disableModelInvocation !== undefined && {
        "disable-model-invocation": disableModelInvocation,
      }),
      ...(Object.keys(toolSection).length > 0 && { "kimi-code": toolSection }),
    };

    return new RulesyncSkill({
      outputRoot: getKimiCodeRulesyncOutputRoot({
        nativeOutputRoot: this.outputRoot,
        global: this.global,
      }),
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: logicalSkillDirName(name),
      frontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global,
    });
  }

  static fromRulesyncSkill({
    outputRoot = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): KimiCodeSkill {
    const frontmatter = rulesyncSkill.getFrontmatter();
    const kimiCodeSection = frontmatter["kimi-code"] ?? {};
    const kimiCodeFrontmatter: KimiCodeSkillFrontmatter = {
      name: frontmatter.name,
      description: frontmatter.description,
      ...(frontmatter["disable-model-invocation"] !== undefined && {
        disableModelInvocation: frontmatter["disable-model-invocation"],
      }),
      ...kimiCodeSection,
    };

    return new KimiCodeSkill({
      outputRoot,
      relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: kimiCodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("kimi-code");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<KimiCodeSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: KimiCodeSkill.getSettablePaths,
    });
    const result = KimiCodeSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid frontmatter in ${join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }
    return new KimiCodeSkill({
      ...loaded,
      frontmatter: result.data,
      validate: true,
    });
  }

  static async fromFlatFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolSkillFromFlatFileParams): Promise<KimiCodeSkill> {
    const filePath = join(outputRoot, relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatterWithYamlRepair(fileContent, filePath);
    const result = KimiCodeFlatSkillFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    const fileName = basename(relativeFilePath, extname(relativeFilePath));
    const firstBodyLine = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== "");
    const normalizedFrontmatter: KimiCodeSkillFrontmatter = {
      ...result.data,
      name: result.data.name ?? fileName,
      description:
        result.data.description ?? firstBodyLine?.slice(0, 240) ?? "No description provided.",
    };
    return new KimiCodeSkill({
      outputRoot,
      relativeDirPath,
      dirName: fileName,
      frontmatter: normalizedFrontmatter,
      body: body.trim(),
      validate: true,
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
  }: ToolSkillForDeletionParams): KimiCodeSkill {
    return new KimiCodeSkill({
      outputRoot,
      relativeDirPath: relativeDirPath ?? this.getSettablePaths({ global }).relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      validate: false,
      global,
    });
  }
}
