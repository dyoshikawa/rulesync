import { refine, z } from "zod/mini";

const EnvVarNameSchema = z
  .string()
  .check(
    refine(
      (value) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value),
      "envVars entries must be valid environment variable names",
    ),
  );

/**
 * One `envVars` entry. A bare name reads the variable from Codex's own
 * environment; the object form names the environment to read it from, where
 * `source = "remote"` reads from the remote executor environment.
 * @see https://learn.chatgpt.com/docs/extend/mcp
 */
export const EnvVarEntrySchema = z.union([
  EnvVarNameSchema,
  // Strict, unlike the loose objects elsewhere in this file: upstream's
  // `McpServerEnvVar` denies unknown fields, so one stray key here
  // makes Codex reject the whole `config.toml` — every MCP server with it, not
  // just this entry. Failing on the rulesync side names the offending file.
  z.strictObject({
    name: EnvVarNameSchema,
    source: z.optional(z.enum(["local", "remote"])),
  }),
]);

/**
 * Whether a value is usable as `envVars`. Applied in both directions by the
 * codex adapter, so an entry read out of somebody's `config.toml` can never be
 * imported into a `.rulesync/mcp.jsonc` that the next generate would refuse to
 * parse.
 */
export function isEnvVarEntryArray(value: unknown): value is (string | { name: string })[] {
  return Array.isArray(value) && value.every((entry) => EnvVarEntrySchema.safeParse(entry).success);
}

export const McpServerSchema = z.looseObject({
  // `streamable-http` is the MCP spec's transport name and an accepted alias for
  // `http` (Claude Code), so configs copied from server docs work unchanged.
  // `ws` is Claude Code's WebSocket transport (same url/headers/timeout fields as http).
  type: z.optional(z.enum(["local", "stdio", "sse", "http", "ws", "streamable-http"])),
  command: z.optional(z.union([z.string(), z.array(z.string())])),
  args: z.optional(z.array(z.string())),
  url: z.optional(z.string()),
  httpUrl: z.optional(z.string()),
  env: z.optional(z.record(z.string(), z.string())),
  // Codex CLI-specific: list of shell env var names that codex should pass
  // through from the user's environment to the MCP server process.
  // Distinct from `env` (a literal name→value map): `envVars` is a list of
  // variable NAMES whose values come from the user's shell at runtime.
  // Only honoured by the codex generator (renamed to `env_vars` in codex
  // TOML output, matching codex's native field name — see the
  // `enabledTools`→`enabled_tools` precedent in `codexcli-mcp.ts`).
  // Stripped by `RulesyncMcp.getMcpServers()` so it does not leak into
  // other tools' configs.
  envVars: z.optional(z.array(EnvVarEntrySchema)),
  // Codex CLI-specific (stdio servers): set to `remote` to start the server
  // through a remote executor environment when one is available. Kept as a
  // plain string rather than an enum so a value Codex adds later is not
  // rejected outright. Written as `experimental_environment` in codex TOML and
  // stripped by `RulesyncMcp.getMcpServers()`, like `envVars`.
  // https://learn.chatgpt.com/docs/extend/mcp
  experimentalEnvironment: z.optional(z.string()),
  disabled: z.optional(z.boolean()),
  networkTimeout: z.optional(z.number()),
  timeout: z.optional(z.number()),
  trust: z.optional(z.boolean()),
  cwd: z.optional(z.string()),
  transport: z.optional(z.enum(["local", "stdio", "sse", "http", "ws", "streamable-http"])),
  alwaysAllow: z.optional(z.array(z.string())),
  tools: z.optional(z.array(z.string())),
  // Kiro authoring keys, translated by `kiro-mcp.ts` onto the fields Kiro reads
  // (`autoApprove` / `disabledTools`). https://kiro.dev/docs/mcp/configuration/
  kiroAutoApprove: z.optional(z.array(z.string())),
  // Prefer the canonical `disabledTools` below. `disabledTools` is the only
  // block list Kiro reads, so `kiroAutoBlock` is a redundant spelling of it with
  // no import counterpart: a Kiro config imported after a generate comes back as
  // canonical `disabledTools`, which then also reaches the other targets that
  // support it. Authoring `disabledTools` directly makes that scope explicit.
  kiroAutoBlock: z.optional(z.array(z.string())),
  // Muse Code-specific: `required` (Muse Code's default) aborts the whole run
  // when the server fails to start, `optional` makes Muse Code skip it with a
  // warning. Emitted as `mode` by `musecode-mcp.ts` and stripped by
  // `RulesyncMcp.getMcpServers()` so it does not leak into other tools' output,
  // like `envVars`. The two documented values are spelled out instead of being
  // kept a loose string (the `experimentalEnvironment` treatment): `mode` is what
  // decides abort-vs-skip, so a value Muse Code does not recognize is the one
  // case where naming the file that holds the typo beats passing it along.
  // https://dev.meta.ai/docs/muse-code/extending.md
  musecodeMode: z.optional(z.enum(["required", "optional"])),
  // Rovo Dev-specific: opts this server's initialization-response instructions
  // into the agent's system prompt. Absent or `false` means Rovo Dev ignores
  // them as untrusted; Atlassian's own built-in servers are enabled without it.
  // Written as `enable_instructions` by `rovodev-mcp.ts` and stripped by
  // `RulesyncMcp.getMcpServers()`, like `envVars` — and here the strip is the
  // point rather than tidiness: the key decides whether a third-party server's
  // text joins the model's prompt, so it must not reach a tool the author was
  // not writing about.
  // https://support.atlassian.com/rovo/docs/connect-to-an-mcp-server-in-rovo-dev-cli/
  rovodevEnableInstructions: z.optional(z.boolean()),
  headers: z.optional(z.record(z.string(), z.string())),
  /**
   * The canonical per-server tool allowlist.
   *
   * **Collision rule for adapters.** Several tools spell an allowlist natively
   * under a name that also exists here, so a single server entry can carry both
   * a canonical field and its native counterpart. What the *native* key means
   * decides the resolution — not which one was written first:
   *
   * - Native key is a redundant spelling of the same concept, and both lists are
   *   additive → **merge** them, so a config that already spells the field
   *   natively keeps working (`kiroAutoApprove`/`kiroAutoBlock` in
   *   `kiro-mcp.ts`).
   * - Native key is the same concept but rulesync owns the generated value, so
   *   keeping both would be ambiguous → the **canonical value wins** and the
   *   native one is dropped with a warning (`tools` in `copilotcli-mcp.ts`).
   * - Native key of the same name means something else entirely → **refuse the
   *   canonical value** rather than write a shape the tool misreads (`tools` in
   *   `codexcli-mcp.ts`, where Codex reads it as a per-tool approval table).
   */
  enabledTools: z.optional(z.array(z.string())),
  disabledTools: z.optional(z.array(z.string())),
});

const McpServersSchema = z.record(z.string(), McpServerSchema);
export type McpServers = z.infer<typeof McpServersSchema>;
export type McpServer = z.infer<typeof McpServerSchema>;

/**
 * Loose guard for `mcpServers` values from parsed JSON: a non-null plain object.
 * Excludes arrays (`typeof [] === "object"`). Tool MCP layers use this before structural transforms;
 * stricter validation may follow elsewhere.
 */
export function isMcpServers(value: unknown): value is McpServers {
  return (
    value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)
  );
}
