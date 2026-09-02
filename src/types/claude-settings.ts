/**
 * Shared type representing the structure of `.claude/settings.json`.
 * Used by both the ignore and permissions features which read/write this file.
 */
export type ClaudeSettingsJson = {
  /**
   * Editor pointer to the settings JSON Schema. Ensured (never overwritten) by
   * the shared config gateway on every settings file rulesync writes; see
   * `CLAUDECODE_SETTINGS_SCHEMA_URL`.
   */
  $schema?: string;
  permissions?: {
    allow?: string[] | null;
    ask?: string[] | null;
    deny?: string[] | null;
  } | null;
  /**
   * The sandbox commands run in (`network`, `filesystem`, `credentials`, ...).
   * Authorable through the `claudecode.sandbox` permissions override.
   * @see https://code.claude.com/docs/en/sandboxing
   */
  sandbox?: Record<string, unknown> | null;
  [key: string]: unknown;
};
