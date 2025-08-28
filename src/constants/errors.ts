/**
 * Common error messages and constants for RulesProcessor
 */
export const ERROR_MESSAGES = {
  DIRECTORY_NOT_FOUND: (dirPath: string) => `Rules directory not found: ${dirPath}`,
  NO_MARKDOWN_FILES: (dirPath: string) => `No markdown files found in directory: ${dirPath}`,
  NO_VALID_RULES: (dirPath: string) => `No valid rules found in ${dirPath}`,
  FILE_NOT_FOUND: (filePath: string) => `File not found: ${filePath}`,
  UNSUPPORTED_TOOL_TARGET: (target: string) => `Unsupported tool target: ${target}`,
} as const;

/**
 * Default timeout and configuration values
 */
export const DEFAULT_CONFIG = {
  REQUEST_TIMEOUT: 30000, // 30 seconds
  MAX_PARALLEL_REQUESTS: 10,
  MAX_FILE_SIZE: 1024 * 1024, // 1MB
} as const;
