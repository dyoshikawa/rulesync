import { basename, join } from "node:path";

import { z } from "zod/mini";

import {
  HERMESAGENT_CHECKS_PLUGIN_DIR_PATH,
  HERMESAGENT_CHECKS_PLUGIN_INIT_PATH,
  HERMESAGENT_CHECKS_PLUGIN_MANIFEST_PATH,
  HERMESAGENT_CHECKS_PLUGIN_OWNERSHIP_PATH,
  HERMESAGENT_CHECKS_PLUGIN_SPECS_DIR_PATH,
} from "../../constants/hermesagent-paths.js";
import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { readFileContent, readFileContentOrNull } from "../../utils/file.js";
import { RulesyncCheck } from "./rulesync-check.js";
import {
  ToolCheck,
  ToolCheckForDeletionParams,
  ToolCheckFromFileParams,
  ToolCheckFromRulesyncCheckParams,
  ToolCheckSettablePaths,
} from "./tool-check.js";

const HermesCheckSpecSchema = z.object({
  slug: z.string(),
  description: z.optional(z.string()),
  severity: z.optional(z.enum(["low", "medium", "high", "critical"])),
  tools: z.optional(z.array(z.string())),
  body: z.string(),
});

type HermesCheckSpec = z.infer<typeof HermesCheckSpecSchema>;

function getPluginManifestContent(): string {
  return [
    "name: rulesync-checks",
    'version: "1.0.0"',
    "description: Applies RuleSync checks at the Hermes verification gate.",
    "",
  ].join("\n");
}

function getPluginInitContent(): string {
  return `"""RuleSync-generated project verification checks for Hermes."""

import json
from pathlib import Path


CHECKS_DIR = Path(__file__).parent / "checks"


def _load_checks():
    if not CHECKS_DIR.exists():
        return []
    checks = []
    for path in sorted(CHECKS_DIR.glob("*.json")):
        try:
            check = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(check, dict):
            checks.append(check)
    return checks


def require_rulesync_checks(coding, attempt, changed_paths, **kwargs):
    del kwargs
    if not coding or attempt or not changed_paths:
        return None
    checks = _load_checks()
    if not checks:
        return None

    sections = ["Run the applicable RuleSync checks before finishing."]
    sections.append("Changed paths: " + ", ".join(changed_paths))
    for check in checks:
        slug = check.get("slug") or "check"
        description = check.get("description") or slug
        severity = check.get("severity")
        tools = check.get("tools") or []
        header = f"[{slug}] {description}"
        if severity:
            header += f" (severity: {severity})"
        sections.append(header)
        if tools:
            sections.append("Suggested tools: " + ", ".join(str(tool) for tool in tools))
        body = check.get("body") or ""
        if body:
            sections.append(body)
    return {"action": "continue", "message": "\\n\\n".join(sections)}


def register(ctx):
    ctx.register_hook("pre_verify", require_rulesync_checks)
`;
}

class HermesagentCheckAuxiliaryFile extends ToolFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }

  getFileContent(): string {
    if (this.getRelativePathFromCwd() === HERMESAGENT_CHECKS_PLUGIN_MANIFEST_PATH) {
      return getPluginManifestContent();
    }
    if (this.getRelativePathFromCwd() === HERMESAGENT_CHECKS_PLUGIN_INIT_PATH) {
      return getPluginInitContent();
    }
    return super.getFileContent();
  }
}

export class HermesagentCheck extends ToolCheck {
  static getSettablePaths(): ToolCheckSettablePaths {
    return { relativeDirPath: HERMESAGENT_CHECKS_PLUGIN_SPECS_DIR_PATH };
  }

  static isTargetedByRulesyncCheck(rulesyncCheck: RulesyncCheck): boolean {
    return this.isTargetedByRulesyncCheckDefault({
      rulesyncCheck,
      toolTarget: "hermesagent",
    });
  }

  static fromRulesyncCheck({
    outputRoot = process.cwd(),
    rulesyncCheck,
  }: ToolCheckFromRulesyncCheckParams): HermesagentCheck {
    const frontmatter = rulesyncCheck.getFrontmatter();
    const slug = basename(rulesyncCheck.getRelativeFilePath(), ".md");
    const hermesSection = this.filterToolSpecificSection(frontmatter.hermesagent ?? {}, ["slug"]);
    const specResult = HermesCheckSpecSchema.safeParse({
      slug,
      description: frontmatter.description,
      severity: frontmatter.severity,
      tools: frontmatter.tools,
      body: rulesyncCheck.getBody(),
      ...hermesSection,
    });
    if (!specResult.success) {
      throw specResult.error;
    }
    return new HermesagentCheck({
      outputRoot,
      relativeDirPath: HERMESAGENT_CHECKS_PLUGIN_SPECS_DIR_PATH,
      relativeFilePath: `${slug}.json`,
      fileContent: `${JSON.stringify(specResult.data, null, 2)}\n`,
    });
  }

  static async getAuxiliaryFiles({
    toolChecks,
    outputRoot,
  }: {
    toolChecks: ToolCheck[];
    outputRoot?: string;
    global?: boolean;
  }): Promise<ToolFile[]> {
    if (toolChecks.length === 0) return [];
    return [
      new HermesagentCheckAuxiliaryFile({
        outputRoot,
        relativeDirPath: HERMESAGENT_CHECKS_PLUGIN_DIR_PATH,
        relativeFilePath: basename(HERMESAGENT_CHECKS_PLUGIN_MANIFEST_PATH),
        fileContent: "",
      }),
      new HermesagentCheckAuxiliaryFile({
        outputRoot,
        relativeDirPath: HERMESAGENT_CHECKS_PLUGIN_DIR_PATH,
        relativeFilePath: basename(HERMESAGENT_CHECKS_PLUGIN_OWNERSHIP_PATH),
        fileContent: "Generated and owned by RuleSync.\n",
      }),
      new HermesagentCheckAuxiliaryFile({
        outputRoot,
        relativeDirPath: HERMESAGENT_CHECKS_PLUGIN_DIR_PATH,
        relativeFilePath: basename(HERMESAGENT_CHECKS_PLUGIN_INIT_PATH),
        fileContent: "",
      }),
    ];
  }

  static async canDeleteAuxiliaryFiles({ outputRoot }: { outputRoot: string }): Promise<boolean> {
    const marker = await readFileContentOrNull(
      join(outputRoot, HERMESAGENT_CHECKS_PLUGIN_OWNERSHIP_PATH),
    );
    return marker === "Generated and owned by RuleSync.\n";
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
  }: ToolCheckFromFileParams): Promise<HermesagentCheck> {
    return new HermesagentCheck({
      outputRoot,
      relativeDirPath: HERMESAGENT_CHECKS_PLUGIN_SPECS_DIR_PATH,
      relativeFilePath,
      fileContent: await readFileContent(
        join(outputRoot, HERMESAGENT_CHECKS_PLUGIN_SPECS_DIR_PATH, relativeFilePath),
      ),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCheckForDeletionParams): HermesagentCheck {
    return new HermesagentCheck({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
    });
  }

  validate(): ValidationResult {
    try {
      const result = HermesCheckSpecSchema.safeParse(JSON.parse(this.fileContent));
      return result.success
        ? { success: true, error: null }
        : { success: false, error: result.error };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  toRulesyncCheck(): RulesyncCheck {
    const spec: HermesCheckSpec = HermesCheckSpecSchema.parse(JSON.parse(this.fileContent));
    return new RulesyncCheck({
      outputRoot: ".",
      relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
      relativeFilePath: `${spec.slug}.md`,
      frontmatter: {
        targets: ["*"],
        description: spec.description,
        severity: spec.severity,
        tools: spec.tools,
      },
      body: spec.body,
    });
  }
}
