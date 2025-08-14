import { parseRulesFromDirectory } from "../../core/index.js";
import { fileExists, getDefaultConfig } from "../../utils/index.js";
import { logger } from "../../utils/logger.js";

export async function statusCommand(): Promise<void> {
  const config = getDefaultConfig();

  logger.log("rulesync Status");
  logger.log("===============");

  // Check if .rulesync directory exists
  const rulesyncExists = await fileExists(config.aiRulesDir);
  logger.log(`\n📁 .rulesync directory: ${rulesyncExists ? "✅ Found" : "❌ Not found"}`);

  if (!rulesyncExists) {
    logger.log("\n💡 Run 'rulesync init' to get started");
    return;
  }

  try {
    // Parse and count rules
    const rules = await parseRulesFromDirectory(config.aiRulesDir);
    logger.log(`\n📋 Rules: ${rules.length} total`);

    if (rules.length > 0) {
      // Count by root status
      const rootRules = rules.filter((r) => r.frontmatter.root).length;
      const nonRootRules = rules.length - rootRules;

      logger.log(`   - Root rules: ${rootRules}`);
      logger.log(`   - Non-root rules: ${nonRootRules}`);

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

      logger.log("\n🎯 Target tool coverage:");
      logger.log(`   - Copilot: ${targetCounts.copilot} rules`);
      logger.log(`   - Cursor: ${targetCounts.cursor} rules`);
      logger.log(`   - Cline: ${targetCounts.cline} rules`);
      logger.log(`   - Claude Code: ${targetCounts.claudecode} rules`);
      logger.log(`   - Roo: ${targetCounts.roo} rules`);
    }

    // Check output files
    logger.log("\n📤 Generated files:");
    for (const [tool, outputPath] of Object.entries(config.outputPaths)) {
      const outputExists = await fileExists(outputPath);
      logger.log(`   - ${tool}: ${outputExists ? "✅ Generated" : "❌ Not found"}`);
    }

    if (rules.length > 0) {
      logger.log("\n💡 Run 'rulesync generate' to update configuration files");
    }
  } catch (error) {
    logger.error("\nFailed to get status:", error);
  }
}
