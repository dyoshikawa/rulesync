/**
 * Shared type representing the structure of `.claude/settings.json`.
 * Used by both the ignore and permissions features which read/write this file.
 */
export type ClaudeSettingsJson = {
  permissions?: {
    allow?: string[] | null;
    ask?: string[] | null;
    deny?: string[] | null;
  } | null;
  [key: string]: unknown;
};
