// oxlint-disable no-console

import { query } from "@anthropic-ai/claude-agent-sdk";

import { readFileContent } from "../src/utils/file.js";

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

// Using glob would require adding it as dependency, for now implement simple file listing
const filePaths: string[] = []; // Empty for now - requires glob functionality

const main = async () => {
  for (const filePath of filePaths) {
    const fileContent = await readFileContent(filePath);
    const tasks = fileContent.split("---\n");
    for (const task of tasks) {
      try {
        await runClaudeCode(task);
      } catch (error) {
        console.error(error);
      }
    }
  }
};

main().catch(console.error);
