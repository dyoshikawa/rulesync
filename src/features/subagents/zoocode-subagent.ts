import { isRecord, isStringArray } from "../../utils/type-guards.js";
import { RooMode, RooSubagent } from "./roo-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

/**
 * Subagent (custom-mode) generator for **Zoo Code**, the community
 * continuation of Roo Code. Zoo Code keeps the aggregated `.roomodes` file and
 * Roo's mode schema, and the shared mode fields keep riding the `roo:`
 * frontmatter section — one rulesync source must not produce two different
 * spellings of the same field.
 *
 * The post-fork divergence is carried by the `zoocode:` section:
 * `allowedMcpServers` (Zoo Code v3.60.0+) — a per-mode MCP server allowlist.
 * "When omitted, all servers are available. When set, only the listed servers
 * are injected." On import the key is lifted back into `zoocode:` so it
 * round-trips (and never leaks into the `roo:` section, where the archived
 * Roo Code would not understand it).
 *
 * @see https://github.com/Zoo-Code-Org/Zoo-Code
 * @see https://docs.zoocode.dev/features/custom-modes
 */
export class ZoocodeSubagent extends RooSubagent {
  static override isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "zoocode",
    });
  }

  static override toRooMode(rulesyncSubagent: RulesyncSubagent): RooMode {
    const mode = super.toRooMode(rulesyncSubagent);

    const frontmatter = rulesyncSubagent.getFrontmatter() as Record<string, unknown>;
    const zoocodeSection = isRecord(frontmatter.zoocode) ? frontmatter.zoocode : {};
    if (isStringArray(zoocodeSection.allowedMcpServers)) {
      (mode as Record<string, unknown>).allowedMcpServers = zoocodeSection.allowedMcpServers;
    }

    return mode;
  }

  override toRulesyncSubagents(): RulesyncSubagent[] {
    return super.toRulesyncSubagents().map((subagent) => {
      const frontmatter = subagent.getFrontmatter() as Record<string, unknown>;
      const rooSection = isRecord(frontmatter.roo) ? { ...frontmatter.roo } : {};
      const { allowedMcpServers, ...restRooSection } = rooSection;

      const rebuilt: Record<string, unknown> = {
        ...frontmatter,
        targets: ["zoocode"],
        roo: restRooSection,
      };
      if (isStringArray(allowedMcpServers)) {
        rebuilt.zoocode = { allowedMcpServers };
      }

      return new RulesyncSubagent({
        outputRoot: ".",
        frontmatter: rebuilt as never,
        body: subagent.getBody(),
        relativeDirPath: subagent.getRelativeDirPath(),
        relativeFilePath: subagent.getRelativeFilePath(),
        validate: true,
      });
    });
  }
}
