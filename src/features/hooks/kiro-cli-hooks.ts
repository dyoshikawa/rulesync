import { KiroIdeHooks } from "./kiro-ide-hooks.js";

/**
 * Hooks generator for the **Kiro CLI**.
 *
 * Kiro CLI 3.0 reads the same standalone `.kiro/hooks/*.json` v1 format the
 * Kiro IDE reads — the same directory, and in rulesync the same
 * `.kiro/hooks/rulesync.json` file — so this is {@link KiroIdeHooks} under a
 * second target name, down to the shared `kiro` override block both resolve
 * their tool-specific hooks from. A per-target override block would make that
 * one file's content depend on which target was generated last, which is
 * exactly what the shared block avoids (the Kiro MCP and permissions wiring
 * resolve their shared files the same way).
 *
 * The embedded `.kiro/agents/default.json` agent-hook format this target used
 * to emit is documented as not working in 3.0, so it is left to the deprecated
 * `kiro` alias ({@link import("./kiro-hooks.js").KiroHooks}).
 *
 * @see https://kiro.dev/docs/cli/v3/hooks-migration/
 * @see https://kiro.dev/docs/hooks/
 */
export class KiroCliHooks extends KiroIdeHooks {}
