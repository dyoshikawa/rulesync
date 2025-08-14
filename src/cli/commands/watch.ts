import { watch } from "chokidar";
import { getDefaultConfig } from "../../utils/index.js";
import { logger } from "../../utils/logger.js";
import { generateCommand } from "./generate.js";

export async function watchCommand(): Promise<void> {
  const config = getDefaultConfig();

  logger.log("👀 Watching for changes in .rulesync directory...");
  logger.log("Press Ctrl+C to stop watching");

  // Initial generation
  await generateCommand({ verbose: false });

  // Watch for changes
  const watcher = watch(`${config.aiRulesDir}/**/*.md`, {
    ignoreInitial: true,
    persistent: true,
  });

  let isGenerating = false;

  const handleChange = async (path: string) => {
    if (isGenerating) return;

    isGenerating = true;
    logger.log(`\n📝 Detected change in ${path}`);

    try {
      await generateCommand({ verbose: false });
      logger.success("Regenerated configuration files");
    } catch (error) {
      logger.error("Failed to regenerate:", error);
    } finally {
      isGenerating = false;
    }
  };

  watcher
    .on("change", handleChange)
    .on("add", handleChange)
    .on("unlink", (path) => {
      logger.log(`\n🗑️  Removed ${path}`);
      handleChange(path);
    })
    .on("error", (error) => {
      logger.error("Watcher error:", error);
    });

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    logger.log("\n\n👋 Stopping watcher...");
    watcher.close();
    process.exit(0);
  });
}
