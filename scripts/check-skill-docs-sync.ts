import { execSync } from "node:child_process";

import { formatError } from "../src/utils/error.js";
import { syncSkillDocs } from "./sync-skill-docs.js";

function main(): void {
  syncSkillDocs();

  try {
    execSync("git diff --exit-code -- skills/rulesync", { stdio: "inherit" });
  } catch (error) {
    // oxlint-disable-next-line no-console
    console.error(
      `skills/rulesync/ is out of sync with docs/. Run "pnpm tsx scripts/sync-skill-docs.ts" and commit the result.\n${formatError(error)}`,
    );
    process.exit(1);
  }
}

main();
