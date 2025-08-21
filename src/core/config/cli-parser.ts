import type { CliOptions } from "./types.js";

/**
 * CLI引数を解析してCliOptionsに変換する
 */
export class CliParser {
  /**
   * CLI引数を解析する
   * @param cliOptions - 生のCLIオプション
   * @returns 解析されたCliOptions
   */
  parse(cliOptions: Partial<CliOptions>): CliOptions {
    const parsed: CliOptions = {};

    // tools (ToolTarget[])
    if (cliOptions.tools && Array.isArray(cliOptions.tools) && cliOptions.tools.length > 0) {
      parsed.tools = cliOptions.tools;
    }

    // verbose (boolean)
    if (typeof cliOptions.verbose === "boolean") {
      parsed.verbose = cliOptions.verbose;
    }

    // delete (boolean)
    if (typeof cliOptions.delete === "boolean") {
      parsed.delete = cliOptions.delete;
    }

    // baseDirs (string[])
    if (
      cliOptions.baseDirs &&
      Array.isArray(cliOptions.baseDirs) &&
      cliOptions.baseDirs.length > 0
    ) {
      parsed.baseDirs = cliOptions.baseDirs;
    }

    // config (string)
    if (typeof cliOptions.config === "string") {
      parsed.config = cliOptions.config;
    }

    // noConfig (boolean)
    if (typeof cliOptions.noConfig === "boolean") {
      parsed.noConfig = cliOptions.noConfig;
    }

    return parsed;
  }

  /**
   * CLI引数が有効かどうかを検証する
   * @param cliOptions - 検証するCLIオプション
   * @returns 検証結果
   */
  validate(cliOptions: CliOptions): { valid: boolean; errors: string[] } {
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

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
