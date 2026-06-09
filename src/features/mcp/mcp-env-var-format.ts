import { McpServers } from "../../types/mcp.js";

/**
 * Canonical rulesync env var reference pattern: `${VAR}` (but not `${env:VAR}`,
 * which is a tool-specific format). Variable names exclude `:` so they match the
 * tool-specific patterns (e.g. OpenCode `{env:VAR}`, Cursor `${env:VAR}`). The
 * `g` flag is required because callers may have multiple references per value.
 */
const CANONICAL_ENV_VAR_PATTERN = /\$\{(?!env:)([^}:]+)\}/g;

function convertRecordValues({
  record,
  pattern,
  replacement,
}: {
  record: Record<string, string>;
  pattern: RegExp;
  replacement: string;
}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([k, v]) => [k, v.replace(pattern, replacement)]),
  );
}

/**
 * Convert tool-specific env var references (e.g. `{env:VAR}`) back to the
 * canonical `${VAR}` format in each server's `env` and `headers` values.
 *
 * `pattern` must carry the `g` flag, otherwise only the first reference in each
 * value would be converted.
 */
export function convertEnvVarRefsFromToolFormat({
  mcpServers,
  pattern,
}: {
  mcpServers: McpServers;
  pattern: RegExp;
}): McpServers {
  if (!pattern.global) {
    throw new Error("convertEnvVarRefsFromToolFormat requires a pattern with the global (g) flag");
  }

  return Object.fromEntries(
    Object.entries(mcpServers).map(([name, config]) => [
      name,
      {
        ...config,
        ...(config.env && {
          env: convertRecordValues({ record: config.env, pattern, replacement: "${$1}" }),
        }),
        ...(config.headers && {
          headers: convertRecordValues({ record: config.headers, pattern, replacement: "${$1}" }),
        }),
      },
    ]),
  );
}

/**
 * Convert canonical `${VAR}` env var references to a tool-specific format in
 * each server's `env` and `headers` values.
 *
 * `replacement` is passed directly to `String.prototype.replace`, so it may use
 * capture-group references (`$1` is the variable name) and is subject to the
 * special replacement patterns (`$$`, `$&`, `` $` ``, `$'`). Callers should pass
 * a static template such as `"${env:$1}"` or `"{env:$1}"` and must not build it
 * from untrusted input.
 */
export function convertEnvVarRefsToToolFormat({
  mcpServers,
  replacement,
}: {
  mcpServers: McpServers;
  replacement: string;
}): McpServers {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([name, config]) => [
      name,
      {
        ...config,
        ...(config.env && {
          env: convertRecordValues({
            record: config.env,
            pattern: CANONICAL_ENV_VAR_PATTERN,
            replacement,
          }),
        }),
        ...(config.headers && {
          headers: convertRecordValues({
            record: config.headers,
            pattern: CANONICAL_ENV_VAR_PATTERN,
            replacement,
          }),
        }),
      },
    ]),
  );
}
