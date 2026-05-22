import { McpServers } from "../../types/mcp.js";

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

export function convertEnvVarRefsFromToolFormat({
  mcpServers,
  pattern,
}: {
  mcpServers: McpServers;
  pattern: RegExp;
}): McpServers {
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
