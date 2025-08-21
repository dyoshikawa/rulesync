import { isAbsolute, resolve } from "node:path";
import type { ConfigLoaderOptions, ConfigLoadResult } from "../../utils/config-loader.js";
import { loadConfig } from "../../utils/config-loader.js";

/**
 * 設定ファイルの読み込みを担当するクラス
 */
export class ConfigFileLoader {
  /**
   * 設定ファイルを読み込む
   * @param options - 設定ファイルの読み込みオプション
   * @returns 設定ファイルの読み込み結果
   */
  async load(options: ConfigLoaderOptions = {}): Promise<ConfigLoadResult> {
    try {
      return await loadConfig(options);
    } catch (error) {
      throw new Error(
        `Failed to load configuration file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 設定ファイルが存在するかどうかを確認する
   * @param configPath - 設定ファイルのパス
   * @returns ファイルが存在するかどうか
   */
  async exists(configPath: string): Promise<boolean> {
    try {
      const { access } = await import("node:fs/promises");
      await access(configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 設定ファイルのパスを解決する
   * @param configPath - 指定された設定ファイルのパス
   * @param workingDirectory - 作業ディレクトリ
   * @returns 解決された設定ファイルのパス
   */
  resolvePath(configPath?: string, workingDirectory?: string): string | undefined {
    if (!configPath) {
      return undefined;
    }

    if (isAbsolute(configPath)) {
      return configPath;
    }

    const baseDir = workingDirectory || process.cwd();
    return resolve(baseDir, configPath);
  }
}
