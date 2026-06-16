import { KiroHooks } from "./kiro-hooks.js";

/**
 * Hooks generator for the **Kiro CLI**.
 *
 * The Kiro CLI uses the same `.kiro/agents/default.json` agent-hook format as
 * the legacy `kiro` alias, so this reuses {@link KiroHooks} and only redirects
 * the tool-specific override key to `kiro-cli` (so `kiro-cli.hooks` overrides in
 * the rulesync hooks config are honored, rather than the legacy `kiro.hooks`).
 *
 * (The Kiro IDE uses multi-file `.kiro/hooks/*.kiro.hook` hooks, which the
 * single-file hooks pipeline does not emit yet, so `kiro-ide` has no hooks
 * adapter.)
 */
export class KiroCliHooks extends KiroHooks {
  protected static getOverrideKey(): "kiro" | "kiro-cli" {
    return "kiro-cli";
  }
}
