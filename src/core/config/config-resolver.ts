import type { MergedConfig } from "../../types/index.js";
import type { ConfigLoaderOptions, ConfigLoadResult } from "../../utils/config-loader.js";
import { CliParser } from "./cli-parser.js";
import { ConfigFileLoader } from "./config-file-loader.js";
import { ConfigMerger } from "./config-merger.js";
import type { CliOptions, ConfigResolutionResult, ResolveOptions } from "./types.js";
import { ConfigSource } from "./types.js";
import { ConfigValidationError, ConfigValidator } from "./validators.js";

/**
 * 設定の統合処理を一元化するメインクラス
 */
export class ConfigResolver {
  private readonly cliParser: CliParser;
  private readonly configLoader: ConfigFileLoader;
  private readonly merger: ConfigMerger;
  private readonly validator: ConfigValidator;

  constructor(
    cliParser?: CliParser,
    configLoader?: ConfigFileLoader,
    merger?: ConfigMerger,
    validator?: ConfigValidator,
  ) {
    this.cliParser = cliParser || new CliParser();
    this.configLoader = configLoader || new ConfigFileLoader();
    this.merger = merger || new ConfigMerger();
    this.validator = validator || new ConfigValidator();
  }

  /**
   * 設定を解決してマージされた設定を返す
   * @param options - 設定解決のオプション
   * @returns 解決された設定と詳細情報
   */
  async resolve(options: ResolveOptions): Promise<ConfigResolutionResult<MergedConfig>> {
    try {
      // 入力の検証
      this.validator.validateWorkingDirectory(options.workingDirectory);

      // CLI引数の解析と検証
      const parsedCliOptions = this.cliParser.parse(options.cliOptions);
      this.validator.validateCliOptions(parsedCliOptions);

      // 設定ファイルの読み込み
      const configLoaderOptions: ConfigLoaderOptions = {
        cwd: options.workingDirectory || process.cwd(),
        ...(parsedCliOptions.config && { configPath: parsedCliOptions.config }),
        ...(parsedCliOptions.noConfig && { noConfig: parsedCliOptions.noConfig }),
      };

      this.validator.validateConfigPath(configLoaderOptions.configPath);

      const configResult = await this.configLoader.load(configLoaderOptions);

      // 設定のマージ
      const mergedConfig = this.merger.merge(configResult.config, parsedCliOptions);

      // マージされた設定の検証
      this.validator.validateMergedConfig(mergedConfig);

      // メタデータの生成
      const metadata = this.merger.generateMetadata(
        configResult.config,
        parsedCliOptions,
        mergedConfig,
      );

      // 設定ソースの判定
      const configSource = this.determineConfigSource(configResult.isEmpty, parsedCliOptions);

      return {
        value: mergedConfig,
        source: configSource,
        metadata,
      };
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        throw error;
      }

      throw new Error(
        `Failed to resolve configuration: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 設定の主要なソースを判定する
   * @param configFileEmpty - 設定ファイルが空かどうか
   * @param cliOptions - CLI引数
   * @returns 主要な設定ソース
   */
  private determineConfigSource(configFileEmpty: boolean, cliOptions: CliOptions): ConfigSource {
    // CLI引数で重要な設定が指定されている場合
    if (cliOptions.tools || cliOptions.verbose !== undefined || cliOptions.delete !== undefined) {
      return ConfigSource.CLI_ARGS;
    }

    // 設定ファイルが存在し、内容がある場合
    if (!configFileEmpty) {
      return ConfigSource.CONFIG_FILE;
    }

    // どちらも設定されていない場合はデフォルト
    return ConfigSource.DEFAULT;
  }

  /**
   * 設定解決の詳細情報を取得する（デバッグ用）
   * @param options - 設定解決のオプション
   * @returns 詳細な解決情報
   */
  async resolveWithDetails(options: ResolveOptions): Promise<{
    result: ConfigResolutionResult<MergedConfig>;
    details: {
      parsedCliOptions: CliOptions;
      configFileResult: ConfigLoadResult;
      validationErrors?: string[];
    };
  }> {
    const parsedCliOptions = this.cliParser.parse(options.cliOptions);

    const configLoaderOptions: ConfigLoaderOptions = {
      cwd: options.workingDirectory || process.cwd(),
      ...(parsedCliOptions.config && { configPath: parsedCliOptions.config }),
      ...(parsedCliOptions.noConfig && { noConfig: parsedCliOptions.noConfig }),
    };

    const configFileResult = await this.configLoader.load(configLoaderOptions);

    try {
      const result = await this.resolve(options);

      return {
        result,
        details: {
          parsedCliOptions,
          configFileResult,
        },
      };
    } catch (error) {
      const validationErrors =
        error instanceof ConfigValidationError
          ? error.errors
          : [error instanceof Error ? error.message : String(error)];

      // 部分的な結果を返す（エラーが発生してもデバッグ情報は提供）
      const partialConfig = this.merger.merge(configFileResult.config, parsedCliOptions);

      return {
        result: {
          value: partialConfig,
          source: this.determineConfigSource(configFileResult.isEmpty, parsedCliOptions),
        },
        details: {
          parsedCliOptions,
          configFileResult,
          validationErrors,
        },
      };
    }
  }
}
