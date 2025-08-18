/**
 * Schema URLs for various AI development tools
 */
export const SCHEMA_URLS = {
  OPENCODE: "https://opencode.ai/config.json",
} as const;

export type SchemaUrl = (typeof SCHEMA_URLS)[keyof typeof SCHEMA_URLS];
