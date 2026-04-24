/**
 * JSON output types for Rulesync CLI
 * Provides structured JSON output for programmatic consumption
 */

/**
 * Base JSON output structure for all commands
 */
export type JsonOutput = {
  /** Whether the command succeeded */
  success: boolean;
  /** ISO 8601 timestamp of when the output was generated */
  timestamp: string;
  /** The command that was executed */
  command: string;
  /** Rulesync version */
  version: string;
  /** Command-specific data */
  data?: Record<string, unknown>;
  /** Error information if command failed */
  error?: JsonError;
};

/**
 * Error structure for JSON output
 */
export type JsonError = {
  /** Error code for programmatic handling */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Additional error details (only included with --verbose) */
  details?: unknown;
  /** Stack trace (only included with --verbose) */
  stack?: string;
};

/**
 * Error codes for CLI errors
 */
export const ErrorCodes = {
  CONFIG_NOT_FOUND: "CONFIG_NOT_FOUND",
  RULESYNC_DIR_NOT_FOUND: "RULESYNC_DIR_NOT_FOUND",
  INVALID_TARGET: "INVALID_TARGET",
  FETCH_FAILED: "FETCH_FAILED",
  WRITE_FAILED: "WRITE_FAILED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  GENERATION_FAILED: "GENERATION_FAILED",
  IMPORT_FAILED: "IMPORT_FAILED",
  CONVERT_FAILED: "CONVERT_FAILED",
  INSTALL_FAILED: "INSTALL_FAILED",
  UPDATE_FAILED: "UPDATE_FAILED",
  GITIGNORE_FAILED: "GITIGNORE_FAILED",
  INIT_FAILED: "INIT_FAILED",
  MCP_FAILED: "MCP_FAILED",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * CLI Error class with error codes
 */
export class CLIError extends Error {
  constructor(
    message: string,
    public code: ErrorCode = ErrorCodes.UNKNOWN_ERROR,
    public exitCode: number = 1,
  ) {
    super(message);
    this.name = "CLIError";
  }
}
