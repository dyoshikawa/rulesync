import { join } from "node:path";

import { dump, load } from "js-yaml";
import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { toPosixPath } from "../../utils/file.js";
import {
  RulesyncSkill,
  RulesyncSkillFrontmatter,
  RulesyncSkillFrontmatterInput,
  SkillFile,
} from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

export const CodexCliSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  metadata: z.optional(
    z.looseObject({
      "short-description": z.optional(z.string()),
    }),
  ),
});

export type CodexCliSkillFrontmatter = z.infer<typeof CodexCliSkillFrontmatterSchema>;

/**
 * Relative path (within a skill directory) of the Codex `agents/openai.yaml` sidecar.
 * Codex CLI reads UI metadata, invocation policy, and tool dependencies from this file;
 * `SKILL.md` frontmatter only carries `name` and `description`.
 * @see https://developers.openai.com/codex/skills.md
 */
const CODEX_OPENAI_YAML_RELATIVE_PATH = join("agents", "openai.yaml");

type CodexcliRulesyncSection = NonNullable<RulesyncSkillFrontmatter["codexcli"]>;

/**
 * Build the `agents/openai.yaml` object from a rulesync `codexcli` section.
 * Only produced when the user opts in via `interface`, `policy`, or `dependencies`;
 * a lone legacy `short-description` keeps mapping to `SKILL.md` `metadata` only.
 * When the sidecar is produced and `interface.short_description` is absent, the
 * legacy `short-description` is routed there (its canonical home per Codex docs).
 */
function buildOpenaiYamlObject(
  codexcli: CodexcliRulesyncSection | undefined,
): Record<string, unknown> | undefined {
  if (!codexcli) {
    return undefined;
  }
  const hasSidecarFields = Boolean(codexcli.interface || codexcli.policy || codexcli.dependencies);
  if (!hasSidecarFields) {
    return undefined;
  }

  const interfaceSection: Record<string, unknown> = { ...codexcli.interface };
  if (
    interfaceSection.short_description === undefined &&
    codexcli["short-description"] !== undefined
  ) {
    interfaceSection.short_description = codexcli["short-description"];
  }

  const result: Record<string, unknown> = {};
  if (Object.keys(interfaceSection).length > 0) {
    result.interface = interfaceSection;
  }
  if (codexcli.policy && Object.keys(codexcli.policy).length > 0) {
    result.policy = codexcli.policy;
  }
  if (codexcli.dependencies && Object.keys(codexcli.dependencies).length > 0) {
    result.dependencies = codexcli.dependencies;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Split out the `agents/openai.yaml` sidecar (if any) from a skill's other files.
 * Returns the parsed sidecar object plus the remaining passthrough files. A malformed
 * sidecar is left in `rest` (preserved as a passthrough file) rather than dropped.
 */
function extractOpenaiYamlFile(otherFiles: SkillFile[]): {
  parsed: Record<string, unknown> | undefined;
  rest: SkillFile[];
} {
  const target = toPosixPath(CODEX_OPENAI_YAML_RELATIVE_PATH);
  let parsed: Record<string, unknown> | undefined;
  const rest: SkillFile[] = [];
  for (const file of otherFiles) {
    if (toPosixPath(file.relativeFilePathToDirPath) === target) {
      try {
        const loaded = load(file.fileBuffer.toString("utf-8"));
        if (loaded !== null && typeof loaded === "object" && !Array.isArray(loaded)) {
          parsed = loaded as Record<string, unknown>;
          continue;
        }
      } catch {
        // fall through: keep the malformed sidecar as a passthrough file
      }
    }
    rest.push(file);
  }
  return { parsed, rest };
}

/**
 * Map a parsed `agents/openai.yaml` object back into a rulesync `codexcli` section.
 */
function openaiYamlToCodexcliSection(
  parsed: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!parsed) {
    return undefined;
  }
  const section: Record<string, unknown> = {};
  for (const key of ["interface", "policy", "dependencies"] as const) {
    const value = parsed[key];
    if (value !== null && typeof value === "object") {
      section[key] = value;
    }
  }
  return Object.keys(section).length > 0 ? section : undefined;
}

export type CodexCliSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: CodexCliSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Codex CLI skill directory.
 * Codex CLI supports skills in both project mode (under $CWD/.codex/skills)
 * and global mode (under $CODEX_HOME/skills, typically ~/.codex/skills).
 */
export class CodexCliSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = join(".codex", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: CodexCliSkillParams) {
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

  static getSettablePaths({
    global: _global = false,
  }: { global?: boolean } = {}): ToolSkillSettablePaths {
    // Codex CLI skills use the same relative path for both project and global modes
    // The actual location differs based on outputRoot:
    // - Project mode: {process.cwd()}/.codex/skills/
    // - Global mode: {$CODEX_HOME}/skills/ (typically ~/.codex/skills/)
    return {
      relativeDirPath: join(".codex", "skills"),
    };
  }

  getFrontmatter(): CodexCliSkillFrontmatter {
    const result = CodexCliSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
    return result;
  }

  getBody(): string {
    return this.mainFile?.body ?? "";
  }

  validate(): ValidationResult {
    if (!this.mainFile) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`),
      };
    }

    const result = CodexCliSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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

  toRulesyncSkill(): RulesyncSkill {
    const frontmatter = this.getFrontmatter();
    const { parsed, rest } = extractOpenaiYamlFile(this.getOtherFiles());
    const openaiSection = openaiYamlToCodexcliSection(parsed);

    const codexcliSection: Record<string, unknown> = {
      ...(frontmatter.metadata?.["short-description"] && {
        "short-description": frontmatter.metadata["short-description"],
      }),
      ...openaiSection,
    };

    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(codexcliSection).length > 0 && {
        codexcli: codexcliSection as RulesyncSkillFrontmatterInput["codexcli"],
      }),
    };

    return new RulesyncSkill({
      outputRoot: this.outputRoot,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: rest,
      validate: true,
      global: this.global,
    });
  }

  static fromRulesyncSkill({
    outputRoot = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): CodexCliSkill {
    const settablePaths = CodexCliSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const codexFrontmatter: CodexCliSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(rulesyncFrontmatter.codexcli?.["short-description"] && {
        metadata: {
          "short-description": rulesyncFrontmatter.codexcli["short-description"],
        },
      }),
    };

    // Emit the Codex `agents/openai.yaml` sidecar when interface/policy/dependencies
    // are configured, replacing any stale copy carried through as a passthrough file.
    const target = toPosixPath(CODEX_OPENAI_YAML_RELATIVE_PATH);
    const baseOtherFiles = rulesyncSkill
      .getOtherFiles()
      .filter((file) => toPosixPath(file.relativeFilePathToDirPath) !== target);
    const openaiObject = buildOpenaiYamlObject(rulesyncFrontmatter.codexcli);
    const otherFiles: SkillFile[] = openaiObject
      ? [
          ...baseOtherFiles,
          {
            relativeFilePathToDirPath: CODEX_OPENAI_YAML_RELATIVE_PATH,
            fileBuffer: Buffer.from(dump(openaiObject, { lineWidth: -1, noRefs: true })),
          },
        ]
      : baseOtherFiles;

    return new CodexCliSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: codexFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles,
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("codexcli");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<CodexCliSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: CodexCliSkill.getSettablePaths,
    });

    const result = CodexCliSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new CodexCliSkill({
      outputRoot: loaded.outputRoot,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
  }: ToolSkillForDeletionParams): CodexCliSkill {
    return new CodexCliSkill({
      outputRoot,
      relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global,
    });
  }
}
