import { z } from "zod/mini";
import { FeatureProcessor } from "../types/feature-processor.js";
import { RulesyncFile } from "../types/rulesync-file.js";
import { ToolFile } from "../types/tool-file.js";
import { ToolTarget } from "../types/tool-targets.js";
import { AugmentcodeIgnore } from "./augmentcode-ignore.js";
import { ClineIgnore } from "./cline-ignore.js";
import { CodexcliIgnore } from "./codexcli-ignore.js";
import { CursorIgnore } from "./cursor-ignore.js";
import { GeminiCliIgnore } from "./geminicli-ignore.js";
import { JunieIgnore } from "./junie-ignore.js";
import { KiroIgnore } from "./kiro-ignore.js";
import { QwencodeIgnore } from "./qwencode-ignore.js";
import { RooIgnore } from "./roo-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";
import { WindsurfIgnore } from "./windsurf-ignore.js";

const ignoreProcessorToolTargets: ToolTarget[] = [
  "augmentcode",
  "cline",
  "codexcli",
  "cursor",
  "geminicli",
  "junie",
  "kiro",
  "qwencode",
  "roo",
  "windsurf",
];

export const IgnoreProcessorToolTargetSchema = z.enum(ignoreProcessorToolTargets);

export type IgnoreProcessorToolTarget = z.infer<typeof IgnoreProcessorToolTargetSchema>;

export class IgnoreProcessor extends FeatureProcessor {
  private readonly toolTarget: IgnoreProcessorToolTarget;

  constructor({
    baseDir = process.cwd(),
    toolTarget,
  }: { baseDir?: string; toolTarget: IgnoreProcessorToolTarget }) {
    super({ baseDir });
    this.toolTarget = IgnoreProcessorToolTargetSchema.parse(toolTarget);
  }

  async writeToolIgnoresFromRulesyncIgnores(rulesyncIgnores: RulesyncIgnore[]): Promise<void> {
    const toolIgnores = await this.convertRulesyncFilesToToolFiles(rulesyncIgnores);
    await this.writeAiFiles(toolIgnores);
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync ignore files from .rulesync/ignore/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    return [await RulesyncIgnore.fromFile()];
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific ignore configurations and parse them into ToolIgnore instances
   */
  async loadToolFiles(): Promise<ToolFile[]> {
    const toolIgnores = await this.loadToolIgnores();
    return toolIgnores;
  }

  async loadToolIgnores(): Promise<ToolIgnore[]> {
    switch (this.toolTarget) {
      case "augmentcode":
        return [await AugmentcodeIgnore.fromFile()];
      case "cline":
        return [await ClineIgnore.fromFile()];
      case "codexcli":
        return [await CodexcliIgnore.fromFile()];
      case "cursor":
        return [await CursorIgnore.fromFile()];
      case "geminicli":
        return [await GeminiCliIgnore.fromFile()];
      case "junie":
        return [await JunieIgnore.fromFile()];
      case "kiro":
        return [await KiroIgnore.fromFile()];
      case "qwencode":
        return [await QwencodeIgnore.fromFile()];
      case "roo":
        return [await RooIgnore.fromFile()];
      case "windsurf":
        return [await WindsurfIgnore.fromFile()];
      default:
        throw new Error(`Unsupported tool target: ${this.toolTarget}`);
    }
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert RulesyncFile[] to ToolFile[]
   */
  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncIgnore = rulesyncFiles.find(
      (file): file is RulesyncIgnore => file instanceof RulesyncIgnore,
    );

    if (!rulesyncIgnore) {
      throw new Error(`No .rulesyncignore found.`);
    }

    const toolIgnores = [rulesyncIgnore].map((rulesyncIgnore) => {
      switch (this.toolTarget) {
        case "augmentcode":
          return AugmentcodeIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            rulesyncIgnore,
          });
        case "cline":
          return ClineIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            rulesyncIgnore,
          });
        case "codexcli":
          return CodexcliIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            rulesyncIgnore,
          });
        case "cursor":
          return CursorIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            rulesyncIgnore,
          });
        case "geminicli":
          return GeminiCliIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            rulesyncIgnore,
          });
        case "junie":
          return JunieIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            rulesyncIgnore,
          });
        case "kiro":
          return KiroIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            rulesyncIgnore,
          });
        case "qwencode":
          return QwencodeIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            rulesyncIgnore,
          });
        case "roo":
          return RooIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            rulesyncIgnore,
          });
        case "windsurf":
          return WindsurfIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            rulesyncIgnore,
          });
        default:
          throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      }
    });

    return toolIgnores;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert ToolFile[] to RulesyncFile[]
   */
  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolIgnores = toolFiles.filter((file): file is ToolIgnore => file instanceof ToolIgnore);

    const rulesyncIgnores = toolIgnores.map((toolIgnore) => {
      return toolIgnore.toRulesyncIgnore();
    });

    return rulesyncIgnores;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets(): ToolTarget[] {
    return ignoreProcessorToolTargets;
  }
}
