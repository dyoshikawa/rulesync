import type { Config as RulesyncConfig, ToolTarget } from "../types/index.js";

// ============================================================================
// Initialize API Types
// ============================================================================

export interface InitializeOptions {
  /** Base directory to initialize (default: process.cwd()) */
  baseDir?: string;
  /** Use legacy file locations */
  legacy?: boolean;
  /** Configuration options */
  config?: Partial<RulesyncConfig>;
}

export interface InitializeResult {
  /** Created file paths */
  createdFiles: string[];
  /** Initialized base directory */
  baseDir: string;
  /** Configuration used */
  config: RulesyncConfig;
}

// ============================================================================
// Generate API Types
// ============================================================================

export interface GenerateOptions {
  /** Base directories */
  baseDirs?: string[];
  /** Target tools to generate for */
  tools?: ToolTarget[];
  /** Generate for all supported tools */
  all?: boolean;
  /** Delete existing files before generating */
  delete?: boolean;
  /** Configuration file path */
  config?: string;
  /** Disable configuration file loading */
  noConfig?: boolean;
  /** Verbose output */
  verbose?: boolean;
}

export interface GeneratedFile {
  /** File path */
  path: string;
  /** Target tool */
  tool: ToolTarget;
  /** File type */
  type: "rules" | "mcp" | "ignore" | "commands";
  /** Generation status */
  status: "success" | "error" | "skipped";
  /** Error message if status is error */
  error?: string;
  /** File size in bytes */
  size?: number;
  /** Last modified timestamp */
  lastModified?: Date;
}

export interface GenerateResult {
  /** Generated files information */
  generatedFiles: GeneratedFile[];
  /** Configuration used */
  config: RulesyncConfig;
  /** Summary of results */
  summary: {
    totalFiles: number;
    successCount: number;
    errorCount: number;
    skippedCount: number;
  };
}

// ============================================================================
// Import API Types
// ============================================================================

export interface ImportOptions {
  /** Base directory */
  baseDir?: string;
  /** Source tools to import from */
  sources: ToolTarget[];
  /** Verbose output */
  verbose?: boolean;
  /** Use legacy file locations */
  legacy?: boolean;
}

export interface ImportedFile {
  /** Source file path */
  sourcePath: string;
  /** Source tool */
  tool: ToolTarget;
  /** Target rulesync file path */
  targetPath: string;
  /** Import status */
  status: "success" | "error" | "skipped";
  /** Error message if status is error */
  error?: string;
}

export interface ImportResult {
  /** Imported files information */
  importedFiles: ImportedFile[];
  /** Created rulesync files */
  createdFiles: string[];
  /** Summary of import results */
  summary: {
    totalSources: number;
    successCount: number;
    errorCount: number;
  };
}

// ============================================================================
// Validate API Types
// ============================================================================

export interface ValidateOptions {
  /** Base directory */
  baseDir?: string;
  /** Configuration file path */
  config?: string;
}

export interface ValidationErrorDetail {
  /** File path */
  filePath: string;
  /** Error message */
  message: string;
  /** Error type */
  type: "syntax" | "schema" | "reference" | "config";
  /** Line number if applicable */
  line?: number;
  /** Column number if applicable */
  column?: number;
}

export interface ValidationWarning {
  /** File path */
  filePath: string;
  /** Warning message */
  message: string;
  /** Warning type */
  type: "deprecated" | "performance" | "best-practice";
}

export interface ValidateResult {
  /** Validation result */
  isValid: boolean;
  /** Validation errors */
  errors: ValidationErrorDetail[];
  /** Warnings */
  warnings: ValidationWarning[];
  /** Validated files */
  validatedFiles: string[];
}

// ============================================================================
// Status API Types
// ============================================================================

export interface StatusOptions {
  /** Base directory */
  baseDir?: string;
}

export interface ConfigStatus {
  /** Configuration file exists */
  exists: boolean;
  /** Configuration file path */
  path?: string;
  /** Configuration is valid */
  isValid: boolean;
  /** Configuration content */
  config?: RulesyncConfig;
}

export interface RulesStatus {
  /** Total rule files count */
  totalFiles: number;
  /** Rule file paths */
  filePaths: string[];
  /** Uses legacy format */
  usesLegacyFormat: boolean;
}

export interface GeneratedFilesStatus {
  /** Target tool */
  tool: ToolTarget;
  /** Generated files */
  files: {
    path: string;
    type: "rules" | "mcp" | "ignore" | "commands";
    exists: boolean;
    lastModified?: Date;
  }[];
}

export interface StatusResult {
  /** Rulesync is initialized */
  isInitialized: boolean;
  /** Configuration file status */
  configStatus: ConfigStatus;
  /** Rules files status */
  rulesStatus: RulesStatus;
  /** Generated files status */
  generatedFilesStatus: GeneratedFilesStatus[];
}

// ============================================================================
// Utility API Types
// ============================================================================

export interface ParseRulesOptions {
  /** Base directory */
  baseDir?: string;
  /** Specific file paths to parse */
  filePaths?: string[];
}

export interface ParsedRule {
  /** File path */
  filePath: string;
  /** Rule content */
  content: string;
  /** Frontmatter data */
  frontmatter?: Record<string, unknown>;
  /** Rule metadata */
  metadata: {
    title?: string;
    description?: string;
    targets?: ToolTarget[];
    globs?: string[];
  };
}

export interface ParseError {
  /** File path where error occurred */
  filePath: string;
  /** Error message */
  message: string;
  /** Line number if applicable */
  line?: number;
  /** Column number if applicable */
  column?: number;
}

export interface ParsedRules {
  /** Successfully parsed rules */
  rules: ParsedRule[];
  /** Parse errors */
  errors: ParseError[];
}

export interface LoadConfigOptions {
  /** Configuration file path */
  configPath?: string;
  /** Base directory */
  baseDir?: string;
  /** Merge with defaults */
  mergeDefaults?: boolean;
}

export interface ToolInfo {
  /** Tool name */
  name: ToolTarget;
  /** Display name */
  displayName: string;
  /** Description */
  description: string;
  /** Supported features */
  features: {
    rules: boolean;
    mcp: boolean;
    ignore: boolean;
    commands: boolean;
  };
  /** Configuration file paths */
  configPaths: {
    rules?: string[];
    mcp?: string[];
    ignore?: string[];
    commands?: string[];
  };
}
