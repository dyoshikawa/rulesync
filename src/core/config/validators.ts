import type { MergedConfig } from "../../types/index.js";
import type { CliOptions } from "./types.js";

/**
 * 設定値のバリデーションエラー
 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: string[],
  ) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

/**
 * 設定値のバリデーションを担当するクラス
 */
export class ConfigValidator {
  /**
   * CLI引数を検証する
   * @param cliOptions - 検証するCLI引数
   * @throws {ConfigValidationError} バリデーションエラーが発生した場合
   */
  validateCliOptions(cliOptions: CliOptions): void {
    const errors: string[] = [];

    // config と noConfig が同時に指定されている場合はエラー
    if (cliOptions.config && cliOptions.noConfig) {
      errors.push("--config and --no-config cannot be used together");
    }

    // baseDirs が空の配列の場合はエラー
    if (cliOptions.baseDirs && cliOptions.baseDirs.length === 0) {
      errors.push("--base-dirs cannot be empty");
    }

    // tools が空の配列の場合はエラー
    if (cliOptions.tools && cliOptions.tools.length === 0) {
      errors.push("--tools cannot be empty");
    }

    // baseDirs の各パスが文字列であることを確認
    if (cliOptions.baseDirs) {
      for (const [index, dir] of cliOptions.baseDirs.entries()) {
        if (typeof dir !== "string" || dir.trim() === "") {
          errors.push(`Base directory at index ${index} must be a non-empty string`);
        }
      }
    }

    if (errors.length > 0) {
      throw new ConfigValidationError("CLI options validation failed", errors);
    }
  }

  /**
   * マージされた設定を検証する
   * @param config - 検証する設定
   * @throws {ConfigValidationError} バリデーションエラーが発生した場合
   */
  validateMergedConfig(config: MergedConfig): void {
    const errors: string[] = [];

    // 必須フィールドの検証
    if (!config.aiRulesDir || config.aiRulesDir.trim() === "") {
      errors.push("aiRulesDir must be specified and non-empty");
    }

    if (!config.outputPaths) {
      errors.push("outputPaths must be specified");
    }

    if (!config.defaultTargets || config.defaultTargets.length === 0) {
      errors.push("At least one tool must be specified in defaultTargets");
    }

    // watchEnabled のデフォルト値設定
    if (config.watchEnabled === undefined) {
      errors.push("watchEnabled must be specified");
    }

    // baseDir の検証
    if (config.baseDir !== undefined) {
      const dirs = Array.isArray(config.baseDir) ? config.baseDir : [config.baseDir];
      for (const [index, dir] of dirs.entries()) {
        if (typeof dir !== "string" || dir.trim() === "") {
          errors.push(`Base directory at index ${index} must be a non-empty string`);
        }
      }
    }

    // exclude の検証（excludeはdefaultTargetsのサブセットである必要がある）
    if (config.exclude && config.defaultTargets) {
      const invalidExcludes = config.exclude.filter(
        (excludeTool) => !config.defaultTargets.includes(excludeTool),
      );
      if (invalidExcludes.length > 0) {
        errors.push(`Exclude contains tools not in defaultTargets: ${invalidExcludes.join(", ")}`);
      }
    }

    if (errors.length > 0) {
      throw new ConfigValidationError("Merged configuration validation failed", errors);
    }
  }

  /**
   * 設定ファイルのパスが有効かどうかを検証する
   * @param configPath - 設定ファイルのパス
   * @throws {ConfigValidationError} パスが無効な場合
   */
  validateConfigPath(configPath?: string): void {
    if (configPath !== undefined && typeof configPath !== "string") {
      throw new ConfigValidationError("Configuration validation failed", [
        "Config path must be a string",
      ]);
    }

    if (typeof configPath === "string" && configPath.trim() === "") {
      throw new ConfigValidationError("Configuration validation failed", [
        "Config path cannot be empty",
      ]);
    }
  }

  /**
   * 作業ディレクトリが有効かどうかを検証する
   * @param workingDirectory - 作業ディレクトリのパス
   * @throws {ConfigValidationError} パスが無効な場合
   */
  validateWorkingDirectory(workingDirectory?: string): void {
    if (workingDirectory !== undefined && typeof workingDirectory !== "string") {
      throw new ConfigValidationError("Configuration validation failed", [
        "Working directory must be a string",
      ]);
    }

    if (typeof workingDirectory === "string" && workingDirectory.trim() === "") {
      throw new ConfigValidationError("Configuration validation failed", [
        "Working directory cannot be empty",
      ]);
    }
  }
}
