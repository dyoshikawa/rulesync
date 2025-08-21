import type { MergedConfig } from "../../types/index.js";
import type { CliOptions, ConfigValueMetadata } from "./types.js";
import { ConfigSource } from "./types.js";

/**
 * 設定値のマージを担当するクラス
 */
export class ConfigMerger {
  /**
   * 設定ファイルとCLI引数をマージする
   * @param fileConfig - 設定ファイルから読み込まれた設定
   * @param cliOptions - CLI引数から解析された設定
   * @returns マージされた設定
   */
  merge(fileConfig: MergedConfig, cliOptions: CliOptions): MergedConfig {
    const merged: MergedConfig = { ...fileConfig };

    // CLI引数の値で上書き（優先度が高い）
    if (cliOptions.verbose !== undefined) {
      merged.verbose = cliOptions.verbose;
    }

    if (cliOptions.delete !== undefined) {
      merged.delete = cliOptions.delete;
    }

    if (cliOptions.baseDirs && cliOptions.baseDirs.length > 0) {
      merged.baseDir = cliOptions.baseDirs;
    }

    // tools が指定されている場合は defaultTargets を置き換え、exclude をクリア
    if (cliOptions.tools && cliOptions.tools.length > 0) {
      merged.defaultTargets = cliOptions.tools;
      merged.exclude = undefined;
    }

    return merged;
  }

  /**
   * 設定値のマージメタデータを生成する
   * @param fileConfig - 設定ファイルの設定
   * @param cliOptions - CLI引数の設定
   * @param merged - マージされた設定
   * @returns マージメタデータ
   */
  generateMetadata(
    fileConfig: MergedConfig,
    cliOptions: CliOptions,
    merged: MergedConfig,
  ): Record<string, ConfigValueMetadata> {
    const metadata: Record<string, ConfigValueMetadata> = {};

    // verbose
    if (merged.verbose !== undefined) {
      metadata.verbose = {
        source: cliOptions.verbose !== undefined ? ConfigSource.CLI_ARGS : ConfigSource.CONFIG_FILE,
        value: merged.verbose,
      };
    }

    // delete
    if (merged.delete !== undefined) {
      metadata.delete = {
        source: cliOptions.delete !== undefined ? ConfigSource.CLI_ARGS : ConfigSource.CONFIG_FILE,
        value: merged.delete,
      };
    }

    // baseDir
    if (merged.baseDir !== undefined) {
      metadata.baseDir = {
        source: cliOptions.baseDirs ? ConfigSource.CLI_ARGS : ConfigSource.CONFIG_FILE,
        value: merged.baseDir,
      };
    }

    // defaultTargets (tools)
    metadata.defaultTargets = {
      source: cliOptions.tools ? ConfigSource.CLI_ARGS : ConfigSource.CONFIG_FILE,
      value: merged.defaultTargets,
    };

    // exclude
    if (merged.exclude !== undefined) {
      metadata.exclude = {
        source: ConfigSource.CONFIG_FILE, // excludeはCLIから直接指定されない
        value: merged.exclude,
      };
    }

    return metadata;
  }

  /**
   * マージされた設定を検証する
   * @param config - マージされた設定
   * @returns 検証結果
   */
  validate(config: MergedConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // defaultTargets が空でないことを確認
    if (!config.defaultTargets || config.defaultTargets.length === 0) {
      errors.push("At least one tool must be specified in targets or CLI arguments");
    }

    // aiRulesDir が指定されていることを確認
    if (!config.aiRulesDir) {
      errors.push("aiRulesDir must be specified");
    }

    // outputPaths が存在することを確認
    if (!config.outputPaths) {
      errors.push("outputPaths must be specified");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
