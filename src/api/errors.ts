/**
 * Base class for all rulesync API errors
 */
export abstract class RulesyncError extends Error {
  abstract readonly code: string;
  abstract readonly category: "config" | "validation" | "generation" | "io" | "parse";

  constructor(
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;

    // Ensure proper stack trace for V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON-serializable format
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      details: this.details,
    };
  }
}

/**
 * Configuration-related errors
 */
export class ConfigError extends RulesyncError {
  readonly code = "CONFIG_ERROR";
  readonly category = "config";
}

/**
 * Validation errors
 */
export class ValidationError extends RulesyncError {
  readonly code = "VALIDATION_ERROR";
  readonly category = "validation";
}

/**
 * File generation errors
 */
export class GenerationError extends RulesyncError {
  readonly code = "GENERATION_ERROR";
  readonly category = "generation";
}

/**
 * File parsing errors
 */
export class ParseError extends RulesyncError {
  readonly code = "PARSE_ERROR";
  readonly category = "parse";
}

/**
 * File I/O errors
 */
export class IOError extends RulesyncError {
  readonly code = "IO_ERROR";
  readonly category = "io";
}

/**
 * Factory function to create appropriate error types
 */
export function createError(
  category: "config" | "validation" | "generation" | "io" | "parse",
  message: string,
  details?: Record<string, unknown>,
): RulesyncError {
  switch (category) {
    case "config":
      return new ConfigError(message, details);
    case "validation":
      return new ValidationError(message, details);
    case "generation":
      return new GenerationError(message, details);
    case "io":
      return new IOError(message, details);
    case "parse":
      return new ParseError(message, details);
    default:
      throw new Error(`Unknown error category: ${category}`);
  }
}
