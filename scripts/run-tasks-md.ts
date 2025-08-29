// oxlint-disable no-console

import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-code";

const runClaudeCode = async (task: string) => {
  console.log("task", task);
  for await (const message of query({
    prompt: task,
    options: {
      abortController: new AbortController(),
      permissionMode: "bypassPermissions",
    },
  })) {
    if (message.type === "assistant") {
      console.log(message.message.content[0].text);
    }
  }
};

const filePaths = globSync(join(process.cwd(), "tmp", "tasks", "*.md"));

for (const filePath of filePaths) {
  const fileContent = readFileSync(filePath, "utf-8");
  const tasks = fileContent.split("---\n");
  for (const task of tasks) {
    try {
      await runClaudeCode(task);
    } catch (error) {
      console.error(error);
    }
  }
}
