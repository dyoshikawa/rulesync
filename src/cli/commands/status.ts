import { parseRulesFromDirectory } from "../../core/index.js";
import { fileExists, getDefaultConfig } from "../../utils/index.js";

export async function statusCommand(): Promise<void> {
  const config = getDefaultConfig();

  console.log("rulesync Status");
  console.log("===============");

  // Check if .rulesync directory exists
  const rulesyncExists = await fileExists(config.aiRulesDir);
  console.log(`\n📁 .rulesync directory: ${rulesyncExists ? "✅ Found" : "❌ Not found"}`);

  if (!rulesyncExists) {
    console.log("\n💡 Run 'rulesync init' to get started");
    return;
  }

  try {
    // Parse and count rules
    const rules = await parseRulesFromDirectory(config.aiRulesDir);
    console.log(`\n📋 Rules: ${rules.length} total`);

    if (rules.length > 0) {
      // Count by root status
      const rootRules = rules.filter((r) => r.frontmatter.root).length;
      const nonRootRules = rules.length - rootRules;

      console.log(`   - Root rules: ${rootRules}`);
      console.log(`   - Non-root rules: ${nonRootRules}`);

      // Count by target tools
      const targetCounts = { copilot: 0, cursor: 0, cline: 0, claudecode: 0, roo: 0 };

      for (const rule of rules) {
        const targets =
          rule.frontmatter.targets[0] === "*" ? config.defaultTargets : rule.frontmatter.targets;

        for (const target of targets) {
          if (target === "copilot") targetCounts.copilot++;
          else if (target === "cursor") targetCounts.cursor++;
          else if (target === "cline") targetCounts.cline++;
          else if (target === "claudecode") targetCounts.claudecode++;
          else if (target === "roo") targetCounts.roo++;
        }
      }

      console.log("\n🎯 Target tool coverage:");
      console.log(`   - Copilot: ${targetCounts.copilot} rules`);
      console.log(`   - Cursor: ${targetCounts.cursor} rules`);
      console.log(`   - Cline: ${targetCounts.cline} rules`);
      console.log(`   - Claude Code: ${targetCounts.claudecode} rules`);
      console.log(`   - Roo: ${targetCounts.roo} rules`);
    }

    // Check output files
    console.log("\n📤 Generated files:");
    for (const [tool, outputPath] of Object.entries(config.outputPaths)) {
      const outputExists = await fileExists(outputPath);
      console.log(`   - ${tool}: ${outputExists ? "✅ Generated" : "❌ Not found"}`);
    }

    if (rules.length > 0) {
      console.log("\n💡 Run 'rulesync generate' to update configuration files");
    }
  } catch (error) {
    console.error("\n❌ Failed to get status:", error);
  }
}
