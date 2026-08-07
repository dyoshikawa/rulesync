import { KiroIdeHooks, type KiroStandaloneHooksOverrideKey } from "./kiro-ide-hooks.js";

/**
 * Hooks generator for the **Kiro CLI**.
 *
 * Kiro CLI 3.0 reads the same standalone `.kiro/hooks/*.json` v1 format the
 * Kiro IDE reads, so this reuses {@link KiroIdeHooks} and only redirects the
 * tool-specific override key to `kiro-cli` (so `kiro-cli.hooks` overrides in
 * the rulesync hooks config are honored, rather than `kiro-ide.hooks`).
 *
 * The embedded `.kiro/agents/default.json` agent-hook format this target used
 * to emit is documented as not working in 3.0, so it is left to the deprecated
 * `kiro` alias ({@link import("./kiro-hooks.js").KiroHooks}).
 *
 * @see https://kiro.dev/docs/cli/v3/hooks-migration/
 * @see https://kiro.dev/docs/hooks/
 */
export class KiroCliHooks extends KiroIdeHooks {
  protected static override getOverrideKey(): KiroStandaloneHooksOverrideKey {
    return "kiro-cli";
  }
}
