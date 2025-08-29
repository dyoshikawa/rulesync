import type { AiFile } from "./ai-file.js";

/**
 * Represents an ignore pattern with its type and optional metadata
 */
export interface IgnorePattern {
  /** The actual pattern (e.g., "*.log", "node_modules/") */
  pattern: string;
  /** Whether this is an exclusion or inclusion (negation) pattern */
  type: "exclude" | "include";
  /** Optional comment to describe the pattern's purpose */
  comment?: string;
}

/**
 * Metadata for different ignore file types and their capabilities
 */
export interface IgnoreFileMetadata {
  /** The ignore file name (e.g., ".gitignore", ".aiignore") */
  fileName: string;
  /** Whether the tool supports negation patterns (!) */
  supportsNegation: boolean;
  /** The syntax format the tool uses */
  syntax: "gitignore" | "custom";
  /** Whether the file must be at repository root */
  rootOnly: boolean;
  /** Additional tool-specific configuration */
  customConfig?: Record<string, unknown>;
}

/**
 * Configuration for generating ignore files for a specific tool
 */
export interface IgnoreConfig {
  /** The tool this configuration is for */
  tool: string;
  /** Patterns to include in the ignore file */
  patterns: IgnorePattern[];
  /** Metadata about the ignore file format */
  metadata: IgnoreFileMetadata;
}

/**
 * Represents a generated ignore file
 */
export interface IgnoreFile extends AiFile {
  /** The tool this ignore file is for */
  tool: string;
  /** The patterns included in this file */
  patterns: IgnorePattern[];
}

/**
 * Security-focused patterns that should be included by default
 */
export const DEFAULT_SECURITY_PATTERNS: IgnorePattern[] = [
  { pattern: "*.pem", type: "exclude", comment: "Private key files" },
  { pattern: "*.key", type: "exclude", comment: "Key files" },
  { pattern: "*.crt", type: "exclude", comment: "Certificate files" },
  { pattern: "*.p12", type: "exclude", comment: "PKCS#12 files" },
  { pattern: "*.pfx", type: "exclude", comment: "PFX files" },
  { pattern: ".env*", type: "exclude", comment: "Environment files" },
  { pattern: "!.env.example", type: "include", comment: "Allow example environment files" },
  { pattern: "secrets/", type: "exclude", comment: "Secrets directory" },
  { pattern: "**/apikeys/", type: "exclude", comment: "API keys directories" },
  { pattern: "**/*_token*", type: "exclude", comment: "Files containing 'token'" },
  { pattern: "**/*_secret*", type: "exclude", comment: "Files containing 'secret'" },
  { pattern: "**/*api_key*", type: "exclude", comment: "Files containing 'api_key'" },
];

/**
 * Common build artifacts and dependencies patterns
 */
export const DEFAULT_BUILD_PATTERNS: IgnorePattern[] = [
  { pattern: "node_modules/", type: "exclude", comment: "Node.js dependencies" },
  { pattern: ".pnpm-store/", type: "exclude", comment: "PNPM store" },
  { pattern: ".yarn/", type: "exclude", comment: "Yarn cache" },
  { pattern: "dist/", type: "exclude", comment: "Distribution directory" },
  { pattern: "build/", type: "exclude", comment: "Build output" },
  { pattern: "out/", type: "exclude", comment: "Output directory" },
  { pattern: "target/", type: "exclude", comment: "Target directory" },
  { pattern: "*.log", type: "exclude", comment: "Log files" },
  { pattern: "*.tmp", type: "exclude", comment: "Temporary files" },
  { pattern: ".cache/", type: "exclude", comment: "Cache directory" },
];

/**
 * Tool-specific ignore file configurations
 */
export const TOOL_IGNORE_METADATA: Record<string, IgnoreFileMetadata[]> = {
  git: [
    {
      fileName: ".gitignore",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: false,
    },
  ],
  claudecode: [
    {
      fileName: ".gitignore",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: false,
    },
  ],
  cursor: [
    {
      fileName: ".cursorignore",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: true,
    },
  ],
  cline: [
    {
      fileName: ".clineignore",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: true,
    },
  ],
  copilot: [
    {
      fileName: ".gitignore",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: false,
      customConfig: { useContentExclusion: true },
    },
  ],
  windsurf: [
    {
      fileName: ".codeiumignore",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: true,
    },
  ],
  augmentcode: [
    {
      fileName: ".gitignore",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: false,
    },
    {
      fileName: ".augmentignore",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: true,
    },
  ],
  roo: [
    {
      fileName: ".rooignore",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: true,
    },
  ],
  gemincli: [
    {
      fileName: ".aiexclude",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: false,
    },
  ],
  junie: [
    {
      fileName: ".aiignore",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: true,
    },
  ],
  kiro: [
    {
      fileName: ".gitignore",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: false,
    },
    {
      fileName: ".aiignore",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: true,
    },
    {
      fileName: ".kirodeignore",
      supportsNegation: false,
      syntax: "gitignore",
      rootOnly: true,
      customConfig: { isReinclusionFile: true },
    },
  ],
  opencode: [
    {
      fileName: ".gitignore",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: false,
    },
  ],
  qwencode: [
    {
      fileName: ".gitignore",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: false,
    },
  ],
  codexcli: [
    {
      fileName: ".gitignore",
      supportsNegation: true,
      syntax: "gitignore",
      rootOnly: false,
    },
  ],
};
