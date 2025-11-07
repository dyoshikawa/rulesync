// oxlint-disable no-console

import { query } from "@anthropic-ai/claude-agent-sdk";
import PQueue from "p-queue";
// @ts-expect-error
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

const concurrency = process.env.CONCURRENCY
  ? Number.parseInt(process.env.CONCURRENCY, 10)
  : 4;

const queue = new PQueue({ concurrency });

const promises = tasks.map((task) =>
  queue.add(async () => {
    try {
      await runClaudeCode(task);
    } catch (error) {
      console.error(error);
    }
  }),
);

await Promise.all(promises);
