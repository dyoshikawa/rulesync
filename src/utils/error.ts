/**
 * Error handling utilities for consistent error management across the application
 */

import { logger } from "./logger.js";

/**
 * Extract error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Format error message with context prefix
 */
export function formatErrorWithContext(error: unknown, context: string): string {
  const errorMessage = getErrorMessage(error);
  return `${context}: ${errorMessage}`;
}

/**
 * Standardized error result interface
 */
export interface ErrorResult {
  success: false;
  error: string;
}

/**
 * Standardized success result interface
 */
export interface SuccessResult<T> {
  success: true;
  result: T;
}

export type Result<T> = SuccessResult<T> | ErrorResult;

/**
 * Create an error result
 */
export function createErrorResult(error: unknown, context?: string): ErrorResult {
  const errorMessage = context ? formatErrorWithContext(error, context) : getErrorMessage(error);

  return {
    success: false,
    error: errorMessage,
  };
}

/**
 * Create a success result
 */
export function createSuccessResult<T>(result: T): SuccessResult<T> {
  return {
    success: true,
    result,
  };
}

/**
 * Generic safe operation wrapper with proper error handling
 */
export async function safeAsyncOperation<T>(
  operation: () => Promise<T>,
  errorContext?: string,
): Promise<Result<T>> {
  try {
    const result = await operation();
    return createSuccessResult(result);
  } catch (error) {
    return createErrorResult(error, errorContext);
  }
}

/**
 * Synchronous safe operation wrapper
 */
export function safeSyncOperation<T>(operation: () => T, errorContext?: string): Result<T> {
  try {
    const result = operation();
    return createSuccessResult(result);
  } catch (error) {
    return createErrorResult(error, errorContext);
  }
}

/**
 * CLI-specific error formatting with emoji and colors
 */
export interface CliErrorOptions {
  prefix?: string;
  emoji?: string;
}

export function formatCliError(
  error: unknown,
  context?: string,
  options: CliErrorOptions = {},
): string {
  const { prefix = "❌", emoji } = options;
  const errorMessage = context ? formatErrorWithContext(error, context) : getErrorMessage(error);

  return `${emoji || prefix} ${errorMessage}`;
}

/**
 * Format CLI success message
 */
export function formatCliSuccess(message: string, emoji: string = "✅"): string {
  return `${emoji} ${message}`;
}

/**
 * Handle multiple errors and combine them into a single message
 */
export function combineErrors(errors: string[], separator: string = "; "): string {
  return errors.filter(Boolean).join(separator);
}

/**
 * Log error with consistent formatting
 */
export function logError(error: unknown, context?: string): void {
  logger.error(formatCliError(error, context));
}

/**
 * Log success message with consistent formatting
 */
export function logSuccess(message: string): void {
  logger.success(formatCliSuccess(message));
}

/**
 * Type guard to check if a result is an error
 */
export function isErrorResult<T>(result: Result<T>): result is ErrorResult {
  return !result.success;
}

/**
 * Type guard to check if a result is successful
 */
export function isSuccessResult<T>(result: Result<T>): result is SuccessResult<T> {
  return result.success;
}
