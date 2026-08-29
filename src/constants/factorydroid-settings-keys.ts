/**
 * Keys of Factory Droid's `settings.json` that rulesync reads and writes without
 * a canonical equivalent. They live here rather than beside the permissions
 * adapter so the settings reader in `src/utils/` can name the same list without
 * importing a feature.
 *
 * @see https://docs.factory.ai/cli/configuration/settings
 */
// Factory Droid-specific security keys that the `factorydroid` override authors
// and that round-trip back into it on import. `commandBlocklist` is the
// hard-block tier (distinct from an approvable canonical `deny`); the rest are
// autonomy/sandbox/network/MCP controls with no canonical slot. rulesync still
// fully owns `commandAllowlist`/`commandDenylist` via the shared block.
// `subagentAutonomyLevel` scopes the autonomy granted to spawned subagents and
// `mcpAutonomyOverrides` configures autonomy levels for individual MCP tools;
// both are Factory-specific autonomy controls with no canonical slot.
export const FACTORYDROID_OVERRIDE_KEYS = [
  "commandBlocklist",
  "networkPolicy",
  "sandbox",
  "mcpPolicy",
  "mcpAutonomyOverrides",
  "enableDroidShield",
  "sessionDefaultSettings",
  "maxAutonomyLevel",
  "subagentAutonomyLevel",
  "interactionMode",
  // Plugin bootstrap: Droid auto-registers these marketplaces and installs
  // these plugins on start — the upstream distribution path for the same
  // artifacts rulesync generates (commands, skills, droids, hooks, mcp).
  // https://docs.factory.ai/cli/configuration/plugins
  "extraKnownMarketplaces",
  "enabledPlugins",
  // Global hooks kill-switch. https://docs.factory.ai/cli/configuration/settings
  "hooksDisabled",
  // Per-skill kill-switch: an array of skill names Droid must not load. Same
  // shape and settings file as `hooksDisabled`.
  // https://docs.factory.ai/cli/configuration/settings
  "disabledSkills",
  // Which models Droid may use and how a mission is allowed to run. Both are
  // organization-level controls with no canonical slot, so they round-trip
  // through the override like the other security keys above.
  // https://docs.factory.ai/droid-cli/settings
  "modelPolicy",
  "missionPolicy",
] as const;
