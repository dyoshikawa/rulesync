// oxlint-disable no-console

import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-code";

const runClaudeCode = async (task: string) => {
  for await (const message of query({
    prompt: task,
    options: {
      abortController: new AbortController(),
    },
  })) {
    if (message.type === "assistant") {
      console.log(message.message.content[0].text);
    }
  }
};

const filePaths = globSync(join(process.cwd(), "tasks", "*.md"));

for (const filePath of filePaths) {
  const fileContent = readFileSync(filePath, "utf-8");
  const tasks = fileContent.split("---\n");
  console.log(tasks);
  for (const task of tasks) {
    try {
      runClaudeCode(task);
    } catch (error) {
      console.error(error);
    }
  }
}
