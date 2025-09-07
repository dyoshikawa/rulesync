// oxlint-disable no-console

import { query } from "@anthropic-ai/claude-code";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { model, tasks } from "../tmp/tasks/tasks.ts";

const runClaudeCode = async (task: string) => {
  console.log("task", task);
  for await (const message of query({
    prompt: task,
    options: {
      abortController: new AbortController(),
      permissionMode: "bypassPermissions",
      model: model ?? "sonnet",
    },
  })) {
    if (message.type === "assistant") {
      console.log(message.message.content[0].text);
    }
  }
};

for (const task of tasks) {
  try {
    await runClaudeCode(task);
  } catch (error) {
    console.error(error);
  }
}
