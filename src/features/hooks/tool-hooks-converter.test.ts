import { describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { ClaudecodeHooks } from "./claudecode-hooks.js";
import { type ToolHooksConverterConfig, toolHooksToCanonical } from "./tool-hooks-converter.js";

const BASE_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: ["preToolUse"],
  canonicalToToolEventNames: { preToolUse: "PreToolUse" },
  toolToCanonicalEventNames: { PreToolUse: "preToolUse" },
  projectDirVar: "",
};

function importHook({
  hook,
  converterConfig,
}: {
  hook: Record<string, unknown>;
  converterConfig: ToolHooksConverterConfig;
}) {
  const logger = createMockLogger();
  const canonical = toolHooksToCanonical({
    hooks: { PreToolUse: [{ hooks: [hook] }] },
    converterConfig,
    logger,
  });
  return { definition: canonical.preToolUse?.[0], logger };
}

/**
 * Each per-hook passthrough kind, with a value its predicate accepts. Both
 * directions must agree on `commandOnly`: a value imported into a canonical
 * field the exporter would then drop is silently deleted on the next generate.
 */
const COMMAND_ONLY_KINDS = [
  {
    kind: "boolean",
    converterConfig: {
      ...BASE_CONFIG,
      booleanPassthroughFields: [{ canonical: "async", tool: "async", commandOnly: true }] as const,
    },
    tool: "async",
    canonical: "async",
    value: true,
  },
  {
    kind: "number",
    converterConfig: {
      ...BASE_CONFIG,
      numberPassthroughFields: [
        { canonical: "additionalContextLimit", tool: "limit", commandOnly: true },
      ] as const,
    },
    tool: "limit",
    canonical: "additionalContextLimit",
    value: 42,
  },
  {
    kind: "string",
    converterConfig: {
      ...BASE_CONFIG,
      stringPassthroughFields: [{ canonical: "shell", tool: "shell", commandOnly: true }] as const,
    },
    tool: "shell",
    canonical: "shell",
    value: "bash",
  },
  {
    kind: "array",
    converterConfig: {
      ...BASE_CONFIG,
      arrayPassthroughFields: [{ canonical: "args", tool: "args", commandOnly: true }] as const,
    },
    tool: "args",
    canonical: "args",
    value: ["--check"],
  },
  {
    kind: "record",
    converterConfig: {
      ...BASE_CONFIG,
      recordPassthroughFields: [{ canonical: "env", tool: "env", commandOnly: true }] as const,
    },
    tool: "env",
    canonical: "env",
    value: { API_URL: "https://example.com" },
  },
] as const;

describe("toolHooksToCanonical", () => {
  describe.each(COMMAND_ONLY_KINDS)(
    "$kind passthrough fields registered as commandOnly",
    ({ converterConfig, tool, canonical, value }) => {
      it("imports the value on a command hook", () => {
        const { definition, logger } = importHook({
          hook: { type: "command", command: "./run.sh", [tool]: value },
          converterConfig,
        });

        expect(definition).toMatchObject({ [canonical]: value });
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it("drops the value on a non-command hook and warns", () => {
        const { definition, logger } = importHook({
          hook: { type: "prompt", prompt: "Review this", [tool]: value },
          converterConfig,
        });

        expect(definition).not.toHaveProperty(canonical);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`Dropping "${tool}" from an imported "prompt" hook`),
        );
      });

      it("imports the value on a hook record without a type, which defaults to command", () => {
        const { definition, logger } = importHook({
          hook: { command: "./run.sh", [tool]: value },
          converterConfig,
        });

        expect(definition).toMatchObject({ [canonical]: value });
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it("stays silent on a non-command hook that does not carry the field", () => {
        const { definition, logger } = importHook({
          hook: { type: "prompt", prompt: "Review this" },
          converterConfig,
        });

        expect(definition).not.toHaveProperty(canonical);
        expect(logger.warn).not.toHaveBeenCalled();
      });
    },
  );

  it("keeps a field that is not registered as commandOnly on a non-command hook", () => {
    const { definition, logger } = importHook({
      hook: { type: "prompt", prompt: "Review this", once: true },
      converterConfig: {
        ...BASE_CONFIG,
        booleanPassthroughFields: [{ canonical: "once", tool: "once" }],
      },
    });

    expect(definition).toMatchObject({ once: true });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns about an array value the tool could not express", () => {
    const { definition, logger } = importHook({
      hook: { type: "command", command: "./run.sh", args: ["--flag\n--injected"] },
      converterConfig: {
        ...BASE_CONFIG,
        arrayPassthroughFields: [{ canonical: "args", tool: "args", commandOnly: true }],
      },
    });

    expect(definition).not.toHaveProperty("args");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`it must be a list of strings`),
    );
  });

  it("warns about a record value the tool could not express", () => {
    const { definition, logger } = importHook({
      hook: { type: "command", command: "./run.sh", env: { "PATH=/tmp/evil": "x" } },
      converterConfig: {
        ...BASE_CONFIG,
        recordPassthroughFields: [{ canonical: "env", tool: "env", commandOnly: true }],
      },
    });

    expect(definition).not.toHaveProperty("env");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`it must be a map of strings`),
    );
  });
});

/** The fields Claude Code documents on `command` hooks only. */
const CLAUDE_COMMAND_ONLY_FIELDS = {
  args: ["--verbose"],
  shell: "bash",
  async: true,
  asyncRewake: true,
};

function importClaudeHook(hook: Record<string, unknown>) {
  const logger = createMockLogger();
  const hooks = new ClaudecodeHooks({
    relativeDirPath: ".claude",
    relativeFilePath: "settings.json",
    fileContent: JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [hook] }] } }),
  });
  const imported = JSON.parse(hooks.toRulesyncHooks({ logger }).getFileContent());
  return { definition: imported.hooks.preToolUse[0], logger };
}

describe("ClaudecodeHooks.toRulesyncHooks", () => {
  it("threads the logger into the converter so import warnings reach the user", () => {
    const { definition, logger } = importClaudeHook({
      type: "prompt",
      prompt: "Check",
      ...CLAUDE_COMMAND_ONLY_FIELDS,
    });

    for (const field of Object.keys(CLAUDE_COMMAND_ONLY_FIELDS)) {
      expect(definition).not.toHaveProperty(field);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Dropping "${field}" from an imported "prompt" hook`),
      );
    }
  });

  it("keeps the same fields on a command hook", () => {
    const { definition, logger } = importClaudeHook({
      type: "command",
      command: "./run.sh",
      ...CLAUDE_COMMAND_ONLY_FIELDS,
    });

    expect(definition).toMatchObject(CLAUDE_COMMAND_ONLY_FIELDS);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
