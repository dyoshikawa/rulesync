import { OPENCODEV1_LAYOUT } from "../../constants/opencode-paths.js";
import { OpencodeMcp } from "./opencode-mcp.js";

/**
 * MCP generator for **OpenCode V1** (OpenCode 1.x). It writes the flat V1
 * `mcp` map by default (`configShape: "v2"` opts into the `mcp.servers`
 * envelope, which OpenCode 1.18.24+ also reads), reusing {@link OpencodeMcp}
 * with the V1 layout.
 *
 * @see https://opencode.ai/docs/mcp-servers/
 */
export class Opencodev1Mcp extends OpencodeMcp {
  protected static override readonly layout = OPENCODEV1_LAYOUT;
}
