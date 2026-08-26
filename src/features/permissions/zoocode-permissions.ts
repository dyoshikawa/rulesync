import {
  ZOOCODE_ALLOWED_COMMANDS_KEY,
  ZOOCODE_DENIED_COMMANDS_KEY,
} from "../../constants/zoocode-paths.js";
import { RooPermissions } from "./roo-permissions.js";

/**
 * Permissions generator for **Zoo Code**, the community continuation of Roo
 * Code.
 *
 * The command allow/deny lists, the `.vscode/settings.json` location, the
 * prefix-matching semantics and the import direction are all inherited from
 * {@link RooPermissions} verbatim, because the fork changed none of them: its
 * `mergeCommandLists()` and `findLongestPrefixMatch()` are the same code.
 *
 * What did change is the namespace. The `zoo-code.*` spelling arrived with the
 * v3.74.0 rebrand, while the archived Roo lineage reads `roo-cline.*`, so the
 * two targets deliberately write different keys into the same file rather than
 * sharing one pair — emitting `zoo-code.*` for a `--targets roo` generate would
 * write settings Roo itself never reads, and vice versa. A project that enables
 * both targets ends up with all four keys, each adapter leaving the other's
 * pair untouched.
 *
 * @see https://github.com/Zoo-Code-Org/Zoo-Code/blob/main/src/package.json
 * @see https://github.com/Zoo-Code-Org/Zoo-Code/blob/main/src/core/webview/ClineProvider.ts
 */
export class ZoocodePermissions extends RooPermissions {
  protected static override getAllowedCommandsKey(): string {
    return ZOOCODE_ALLOWED_COMMANDS_KEY;
  }

  protected static override getDeniedCommandsKey(): string {
    return ZOOCODE_DENIED_COMMANDS_KEY;
  }

  protected static override getToolLabel(): string {
    return "Zoo Code";
  }
}
