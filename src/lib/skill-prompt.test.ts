import { describe, expect, it, vi } from "vitest";

import {
  isInteractiveTerminal,
  promptSkillSelection,
  SkillSelectionCancelledError,
} from "./skill-prompt.js";

const { checkboxMock } = vi.hoisted(() => ({
  checkboxMock: vi.fn(),
}));

vi.mock("@inquirer/checkbox", () => ({
  default: checkboxMock,
}));

describe("promptSkillSelection", () => {
  it("should check all skills when no skills are preselected", async () => {
    checkboxMock.mockResolvedValue(["skill-a", "skill-b"]);

    const selected = await promptSkillSelection({
      availableSkills: ["skill-a", "skill-b"],
      preselectedSkills: [],
    });

    expect(checkboxMock).toHaveBeenCalledWith({
      message: "Select skills to fetch",
      choices: [
        { name: "skill-a", value: "skill-a", checked: true },
        { name: "skill-b", value: "skill-b", checked: true },
      ],
    });
    expect(selected).toEqual(["skill-a", "skill-b"]);
  });

  it("should check only preselected skills when provided", async () => {
    checkboxMock.mockResolvedValue(["skill-b"]);

    const selected = await promptSkillSelection({
      availableSkills: ["skill-a", "skill-b"],
      preselectedSkills: ["skill-b"],
    });

    expect(checkboxMock).toHaveBeenCalledWith({
      message: "Select skills to fetch",
      choices: [
        { name: "skill-a", value: "skill-a", checked: false },
        { name: "skill-b", value: "skill-b", checked: true },
      ],
    });
    expect(selected).toEqual(["skill-b"]);
  });

  it("should convert ExitPromptError (Ctrl+C) into SkillSelectionCancelledError", async () => {
    const exitError = new Error("User force closed the prompt");
    exitError.name = "ExitPromptError";
    checkboxMock.mockRejectedValue(exitError);

    await expect(
      promptSkillSelection({ availableSkills: ["skill-a"], preselectedSkills: [] }),
    ).rejects.toBeInstanceOf(SkillSelectionCancelledError);
  });

  it("should rethrow non-cancel errors from the prompt", async () => {
    checkboxMock.mockRejectedValue(new Error("terminal exploded"));

    await expect(
      promptSkillSelection({ availableSkills: ["skill-a"], preselectedSkills: [] }),
    ).rejects.toThrow("terminal exploded");
  });
});

describe("isInteractiveTerminal", () => {
  it("should reflect the TTY status of stdin and stdout", () => {
    const expected = Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
    expect(isInteractiveTerminal()).toBe(expected);
  });
});
