import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_MCP_SCHEMA_URL } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { fileContentIsEmptyPayload } from "../../utils/content-equivalence.js";
import { writeFileContent } from "../../utils/file.js";
import { CrushMcp } from "./crush-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const serversOf = (mcp: CrushMcp): unknown => mcp.getJson().mcp;

describe("CrushMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  const projectConfigPath = () => join(testDir, "crush.json");
  const hiddenConfigPath = () => join(testDir, ".crush.json");

  const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: ".mcp.json",
      fileContent: JSON.stringify({ mcpServers }),
    });

  describe("getSettablePaths", () => {
    it("should point to crush.json in project mode", () => {
      expect(CrushMcp.getSettablePaths({ global: false })).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
      });
    });

    it("should point to .config/crush/crush.json in global mode", () => {
      expect(CrushMcp.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "crush"),
        relativeFilePath: "crush.json",
      });
    });
  });

  describe("isDeletable", () => {
    it("should never be deletable (the user's primary Crush config)", () => {
      const mcp = new CrushMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: "{}",
      });
      expect(mcp.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert stdio servers to type/command/args/env", async () => {
      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          fs: { command: "fs-server", args: ["--root", "."], env: { TOKEN: "x" } },
        }),
      });

      expect(serversOf(mcp)).toEqual({
        fs: { type: "stdio", command: "fs-server", args: ["--root", "."], env: { TOKEN: "x" } },
      });
    });

    it("should convert remote servers to http/sse with url and headers", async () => {
      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          plain: { url: "https://example.com/mcp" },
          streamable: { type: "streamable-http", url: "https://example.com/mcp" },
          events: { type: "sse", url: "https://example.com/sse", headers: { A: "b" } },
        }),
      });

      expect(serversOf(mcp)).toEqual({
        plain: { type: "http", url: "https://example.com/mcp" },
        streamable: { type: "http", url: "https://example.com/mcp" },
        events: { type: "sse", url: "https://example.com/sse", headers: { A: "b" } },
      });
    });

    it("should carry disabled, tool filters, timeout and the Crush-only keys", async () => {
      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          fs: {
            command: "fs",
            disabled: true,
            disabledTools: ["rm"],
            enabledTools: ["ls"],
            timeout: 20,
            crushSessionless: true,
            crushOauth: true,
            crushOauthClientId: "id",
            crushOauthClientSecret: "client-secret-value",
            crushOauthCallbackPort: 8765,
            crushChannelEnabled: true,
            crushChannelReply: {
              user: { tool: "send_message_to_user", target_param: "user_id" },
              message_param: "text",
            },
            // Claude Code's OAuth object is not Crush's boolean and is ignored.
            oauth: { clientId: "claude" },
          },
        }),
      });

      expect(serversOf(mcp)).toEqual({
        fs: {
          type: "stdio",
          command: "fs",
          disabled: true,
          disabled_tools: ["rm"],
          enabled_tools: ["ls"],
          timeout: 20,
          sessionless: true,
          oauth: true,
          oauth_client_id: "id",
          oauth_client_secret: "client-secret-value",
          oauth_callback_port: 8765,
          channel_enabled: true,
          channel_reply: {
            user: { tool: "send_message_to_user", target_param: "user_id" },
            message_param: "text",
          },
        },
      });
    });

    it("should honour the raw Crush spelling of the Crush-only keys as a fallback", async () => {
      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          gh: {
            url: "https://example.com/mcp",
            // A raw `oauth` is the one spelling other tools would also see,
            // so only `crushOauth` switches the flow on.
            oauth: true,
            oauth_client_id: "id",
            oauth_callback_port: 8765,
            sessionless: true,
            channel_enabled: true,
            channel_reply: { group: { tool: "send", target_param: "chat_id" } },
          },
          typed: { url: "https://example.com/mcp", crushOauth: false, oauth: true },
          // A non-object reply route is refused rather than written.
          bad: { command: "fs", crushChannelReply: "send", channel_enabled: "yes" },
        }),
      });

      expect(serversOf(mcp)).toEqual({
        gh: {
          type: "http",
          url: "https://example.com/mcp",
          oauth_client_id: "id",
          oauth_callback_port: 8765,
          sessionless: true,
          channel_enabled: true,
          channel_reply: { group: { tool: "send", target_param: "chat_id" } },
        },
        typed: { type: "http", url: "https://example.com/mcp", oauth: false },
        bad: { type: "stdio", command: "fs" },
      });
    });

    it("should drop a channel_reply Crush could not decode, with a warning", async () => {
      const logger = createMockLogger();
      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          // A route without `tool` and a route that is not an object.
          noTool: { command: "fs", crushChannelReply: { user: { target_param: "user_id" } } },
          rawString: { command: "fs", channel_reply: { group: "send" } },
          ok: {
            command: "fs",
            crushChannelReply: { user: { tool: "reply" }, suppress_tools: ["send"] },
          },
        }),
        logger,
      });

      expect(serversOf(mcp)).toEqual({
        noTool: { type: "stdio", command: "fs" },
        rawString: { type: "stdio", command: "fs" },
        ok: {
          type: "stdio",
          command: "fs",
          channel_reply: { user: { tool: "reply" }, suppress_tools: ["send"] },
        },
      });
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"crushChannelReply"'));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"channel_reply"'));
    });

    it("should round a fractional timeout up and drop a fractional callback port", async () => {
      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          fs: { command: "fs", timeout: 2.5, oauth_callback_port: 80.5 },
        }),
      });

      expect(serversOf(mcp)).toEqual({ fs: { type: "stdio", command: "fs", timeout: 3 } });
    });

    it("should warn-and-skip servers Crush cannot run", async () => {
      const logger = createMockLogger();
      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          noTransport: { env: { A: "b" } },
          ws: { url: "ws://example.com/mcp" },
          ok: { command: "fs" },
        }),
        logger,
      });

      expect(serversOf(mcp)).toEqual({ ok: { type: "stdio", command: "fs" } });
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it("should preserve unrelated top-level keys and rebuild the mcp block", async () => {
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({
          $schema: "https://charm.land/crush.json",
          providers: { anthropic: { api_key: "$ANTHROPIC_API_KEY" } },
          mcp: { stale: { type: "stdio", command: "old" } },
        }),
      );

      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
      });

      expect(mcp.getJson()).toEqual({
        $schema: "https://charm.land/crush.json",
        providers: { anthropic: { api_key: "$ANTHROPIC_API_KEY" } },
        mcp: { fs: { type: "stdio", command: "fs" } },
      });
    });

    it("should write into an existing .crush.json instead of crush.json", async () => {
      await writeFileContent(hiddenConfigPath(), JSON.stringify({ options: { debug: true } }));

      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
      });

      expect(mcp.getRelativeFilePath()).toBe(".crush.json");
      expect(mcp.getJson()).toEqual({
        options: { debug: true },
        mcp: { fs: { type: "stdio", command: "fs" } },
      });
    });

    it("should warn when the crush.json twin still carries mcp entries", async () => {
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({ mcp: { stale: { type: "stdio", command: "stale" } } }),
      );
      await writeFileContent(hiddenConfigPath(), JSON.stringify({ options: { debug: true } }));
      const logger = createMockLogger();

      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
        logger,
      });

      // Only .crush.json is written; the stale server in crush.json is reported
      // because Crush keeps reading it.
      expect(mcp.getRelativeFilePath()).toBe(".crush.json");
      expect(serversOf(mcp)).toEqual({ fs: { type: "stdio", command: "fs" } });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"mcp"'));
    });

    it("should target ~/.config/crush/crush.json in global mode", async () => {
      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
        global: true,
      });

      expect(mcp.getRelativeDirPath()).toBe(join(".config", "crush"));
      expect(mcp.getRelativeFilePath()).toBe("crush.json");
    });

    it("should not create the config file for an empty payload at either scope", async () => {
      for (const global of [false, true]) {
        const mcp = await CrushMcp.fromRulesyncMcp({
          outputRoot: testDir,
          rulesyncMcp: buildRulesyncMcp({}),
          global,
        });
        expect(
          fileContentIsEmptyPayload({ filePath: mcp.getFilePath(), content: mcp.getFileContent() }),
        ).toBe(true);
        expect(mcp.shouldSkipCreationWhenPayloadEmpty()).toBe(true);
      }
    });

    it("should fail closed on an unparseable existing config", async () => {
      await writeFileContent(projectConfigPath(), "{ not json");

      await expect(
        CrushMcp.fromRulesyncMcp({
          outputRoot: testDir,
          rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromFile", () => {
    it("should read an existing config", async () => {
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({ mcp: { fs: { type: "stdio", command: "fs" } } }),
      );

      const mcp = await CrushMcp.fromFile({ outputRoot: testDir });
      expect(serversOf(mcp)).toEqual({ fs: { type: "stdio", command: "fs" } });
    });

    it("should merge both twins the way Crush does, .crush.json on top", async () => {
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({ mcp: { a: { command: "a" }, shared: { command: "old", timeout: 5 } } }),
      );
      await writeFileContent(
        hiddenConfigPath(),
        JSON.stringify({ mcp: { b: { command: "b" }, shared: { command: "new" } } }),
      );

      const mcp = await CrushMcp.fromFile({ outputRoot: testDir });
      expect(mcp.getRelativeFilePath()).toBe(".crush.json");
      // Crush reads every server of both files, so an import does too.
      expect(serversOf(mcp)).toEqual({
        a: { command: "a" },
        b: { command: "b" },
        shared: { command: "new", timeout: 5 },
      });
    });

    it("should default to an empty document when the file is missing", async () => {
      const mcp = await CrushMcp.fromFile({ outputRoot: testDir });
      expect(mcp.getJson()).toEqual({});
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert back to canonical servers without leaking Crush's own keys", () => {
      const mcp = new CrushMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: JSON.stringify({
          providers: { anthropic: {} },
          mcp: {
            fs: { type: "stdio", command: "fs", args: ["--root", "."], disabled_tools: ["rm"] },
            remote: {
              type: "http",
              url: "https://example.com/mcp",
              enabled_tools: ["a"],
              oauth_token: "secret",
              sessionless: true,
              oauth: true,
              oauth_client_secret: "client-secret-value",
              oauth_callback_port: "not-a-port",
              channel_enabled: true,
              channel_reply: { user: { tool: "reply", target_param: "user_id" } },
            },
          },
        }),
      });

      expect(JSON.parse(mcp.toRulesyncMcp().getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {
          fs: { command: "fs", args: ["--root", "."], disabledTools: ["rm"] },
          remote: {
            type: "http",
            url: "https://example.com/mcp",
            enabledTools: ["a"],
            crushSessionless: true,
            crushOauth: true,
            crushOauthClientSecret: "client-secret-value",
            crushChannelEnabled: true,
            crushChannelReply: { user: { tool: "reply", target_param: "user_id" } },
          },
        },
      });
    });

    it("should yield empty servers when the config has no mcp block", () => {
      const mcp = new CrushMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: "{}",
      });
      expect(JSON.parse(mcp.toRulesyncMcp().getFileContent()).mcpServers).toEqual({});
    });
  });

  describe("forDeletion", () => {
    it("should return a well-formed instance", () => {
      const mcp = CrushMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
      });
      expect(mcp.getJson()).toEqual({ mcp: {} });
      expect(mcp.isDeletable()).toBe(false);
    });
  });
});

describe("CrushMcp retraction (issue #2562)", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("retracts mcp when no server is left, keeping unrelated keys", async () => {
    const paths = CrushMcp.getSettablePaths({ global: false });
    await writeFileContent(
      join(testDir, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ other: 1, mcp: { old: { command: "old" } } }),
    );
    const mcp = await CrushMcp.fromRulesyncMcp({
      outputRoot: testDir,
      global: false,
      rulesyncMcp: new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      }),
    });

    expect(JSON.parse(mcp.getFileContent())).toEqual({ other: 1 });
  });
});
