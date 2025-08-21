import type { ToolTarget } from "../../types/index.js";

/**
 * CLI引数から解析されたオプション
 */
export interface CliOptions {
  tools?: ToolTarget[];
  verbose?: boolean;
  delete?: boolean;
  baseDirs?: string[];
  config?: string;
  noConfig?: boolean;
}

/**
 * ConfigResolverの入力オプション
 */
export interface ResolveOptions {
  cliOptions: CliOptions;
  workingDirectory?: string;
}

/**
 * 設定ソースの種類
 */
export enum ConfigSource {
  DEFAULT = "default",
  CONFIG_FILE = "config_file",
  CLI_ARGS = "cli_args",
}

/**
 * 設定値のメタデータ
 */
export interface ConfigValueMetadata {
  source: ConfigSource;
  value: unknown;
}

/**
 * 設定解決の結果
 */
export interface ConfigResolutionResult<T> {
  value: T;
  source: ConfigSource;
  metadata?: Record<string, ConfigValueMetadata>;
}
