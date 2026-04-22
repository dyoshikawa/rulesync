import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod/mini";

import {
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
} from "../constants/rulesync-paths.js";
import { fileExists, readFileContent } from "../utils/file.js";
import { rulesyncArgs, rulesyncCmd, useTestDirectory } from "./e2e-helper.js";

/**
 * Spawn the `rulesync mcp` daemon and return a connected MCP SDK client.
 * The caller MUST invoke the returned `close` callback to kill the child
 * process and release the stdio transport, even if the test throws.
 */
async function connectRulesyncMcpServer(
  cwd: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  // Build a clean env map for the child. StdioClientTransport requires
  // Record<string, string>, whereas process.env has `string | undefined`
  // values — filter out `undefined` entries before passing along.
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      childEnv[key] = value;
    }
  }

  const transport = new StdioClientTransport({
    command: rulesyncCmd,
    args: [...rulesyncArgs, "mcp"],
    cwd,
    env: childEnv,
    stderr: "pipe",
  });

  const client = new Client(
    { name: "rulesync-e2e-client", version: "0.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);

  const close = async (): Promise<void> => {
    try {
      await client.close();
    } catch {
      // Ignore close errors — we're tearing down anyway.
    }
  };

  return { client, close };
}

/**
 * Shape of a `tools/call` response. Validated with zod so no type
 * assertions are needed at the call sites.
 */
const toolCallResponseSchema = z.object({
  isError: z.optional(z.boolean()),
  content: z.array(z.looseObject({ type: z.string(), text: z.optional(z.string()) })),
});

/**
 * Extract the concatenated text content from a `tools/call` result.
 */
function resultText(result: unknown): string {
  const parsed = toolCallResponseSchema.parse(result);
  return parsed.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
}

describe("E2E: mcp server (daemon over stdio JSON-RPC)", () => {
  const { getTestDir } = useTestDirectory();

  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  it("should round-trip put/get/delete for permissions feature", { timeout: 30_000 }, async () => {
    const testDir = getTestDir();

    const connection = await connectRulesyncMcpServer(testDir);
    close = connection.close;
    const { client } = connection;

    const permissionsPayload = {
      permission: {
        bash: {
          "*": "ask",
          "git *": "allow",
          "rm -rf *": "deny",
        },
      },
    };
    const permissionsContent = JSON.stringify(permissionsPayload, null, 2);

    // put
    const putResult = await client.callTool({
      name: "rulesyncTool",
      arguments: {
        feature: "permissions",
        operation: "put",
        content: permissionsContent,
      },
    });
    expect(putResult.isError).not.toBe(true);

    // Verify the file exists on disk with the expected content.
    const writtenContent = await readFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
    );
    expect(JSON.parse(writtenContent)).toEqual(permissionsPayload);

    // get
    const getResult = await client.callTool({
      name: "rulesyncTool",
      arguments: {
        feature: "permissions",
        operation: "get",
      },
    });
    expect(getResult.isError).not.toBe(true);
    const getText = resultText(getResult);
    expect(getText).toContain("git *");
    expect(getText).toContain("allow");

    // delete
    const deleteResult = await client.callTool({
      name: "rulesyncTool",
      arguments: {
        feature: "permissions",
        operation: "delete",
      },
    });
    expect(deleteResult.isError).not.toBe(true);

    // Verify the file no longer exists.
    expect(await fileExists(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH))).toBe(false);
  });

  it("should round-trip put/get/delete for hooks feature", { timeout: 30_000 }, async () => {
    const testDir = getTestDir();

    const connection = await connectRulesyncMcpServer(testDir);
    close = connection.close;
    const { client } = connection;

    const hooksPayload = {
      hooks: {
        preToolUse: [
          {
            matcher: "Bash",
            type: "command",
            command: "echo hi",
          },
        ],
      },
    };
    const hooksContent = JSON.stringify(hooksPayload, null, 2);

    // put
    const putResult = await client.callTool({
      name: "rulesyncTool",
      arguments: {
        feature: "hooks",
        operation: "put",
        content: hooksContent,
      },
    });
    expect(putResult.isError).not.toBe(true);

    const writtenContent = await readFileContent(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH));
    expect(JSON.parse(writtenContent)).toEqual(hooksPayload);

    // get
    const getResult = await client.callTool({
      name: "rulesyncTool",
      arguments: {
        feature: "hooks",
        operation: "get",
      },
    });
    expect(getResult.isError).not.toBe(true);
    const getText = resultText(getResult);
    expect(getText).toContain("preToolUse");
    expect(getText).toContain("echo hi");

    // delete
    const deleteResult = await client.callTool({
      name: "rulesyncTool",
      arguments: {
        feature: "hooks",
        operation: "delete",
      },
    });
    expect(deleteResult.isError).not.toBe(true);

    expect(await fileExists(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH))).toBe(false);
  });

  it(
    "should return an error when permissions put is called without content",
    { timeout: 30_000 },
    async () => {
      const testDir = getTestDir();

      const connection = await connectRulesyncMcpServer(testDir);
      close = connection.close;
      const { client } = connection;

      const putResult = await client.callTool({
        name: "rulesyncTool",
        arguments: {
          feature: "permissions",
          operation: "put",
        },
      });

      expect(putResult.isError).toBe(true);
      const errorText = resultText(putResult);
      expect(errorText).toContain("content is required");
    },
  );
});
