// Rulesync Programmatic API
// Main entry point for programmatic access

// Re-export core types
export type {
  Config as RulesyncConfig,
  ConfigOptions,
  MergedConfig,
  ToolTarget,
} from "../types/index.js";
// Core API functions
export {
  generate,
  getStatus,
  importConfig,
  initialize,
  validate,
} from "./core.js";

// Error classes
export {
  ConfigError,
  GenerationError,
  IOError,
  ParseError,
  RulesyncError,
  ValidationError,
} from "./errors.js";
// API-specific types
export type * from "./types.js";
// Utility API functions
export {
  getSupportedTools,
  loadConfig,
  parseRules,
} from "./utils.js";
