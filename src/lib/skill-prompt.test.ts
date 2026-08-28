import { describe, expect, it, vi } from "vitest";

import { displayWidthOf } from "../utils/display-width.js";
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
  // The `shortcuts` assertions below are the point of this test as much as the
  // unchecked boxes are: starting from an empty selection is only reasonable
  // because <a> makes "fetch everything" one keystroke away.
  it("should check no skills when none are preselected", async () => {
    checkboxMock.mockResolvedValue([]);

    const selected = await promptSkillSelection({
      availableSkills: ["skill-a", "skill-b"],
      preselectedSkills: [],
    });

    expect(checkboxMock).toHaveBeenCalledWith({
      message: "Select skills to fetch (press <a> to select/deselect all)",
      choices: [
        { name: "skill-a", value: "skill-a", checked: false },
        { name: "skill-b", value: "skill-b", checked: false },
      ],
      shortcuts: { all: "a", invert: "i" },
    });
    expect(selected).toEqual([]);
  });

  it("should check only preselected skills when provided", async () => {
    checkboxMock.mockResolvedValue(["skill-b"]);

    const selected = await promptSkillSelection({
      availableSkills: ["skill-a", "skill-b"],
      preselectedSkills: ["skill-b"],
    });

    expect(checkboxMock).toHaveBeenCalledWith({
      message: "Select skills to fetch (press <a> to select/deselect all)",
      choices: [
        { name: "skill-a", value: "skill-a", checked: false },
        { name: "skill-b", value: "skill-b", checked: true },
      ],
      shortcuts: { all: "a", invert: "i" },
    });
    expect(selected).toEqual(["skill-b"]);
  });

  it("should mark entries that cannot be told apart on sight", async () => {
    checkboxMock.mockResolvedValue([]);
    // "skill" spelled with a Cyrillic U+0455 for the leading s: a different
    // directory that the terminal draws exactly like the Latin one.
    const lookalike = "\u0455kill";

    await promptSkillSelection({
      availableSkills: ["skill", lookalike],
      preselectedSkills: [],
    });

    // The value is still the real name, so a checked box writes the directory
    // it names and not its lookalike; only the label carries the warning.
    expect(checkboxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [
          {
            name: "[!] another entry differs from it only by lookalike letters \u2014 skill",
            value: "skill",
            checked: false,
          },
          {
            // Both reasons apply, and together they are wider than the row, so
            // the tail of the second is cut: the marker and the first reason
            // are the ones a cut never reaches.
            name:
              "[!] another entry differs from it only by lookalike letters; mi\u2026 " +
              `\u2014 ${lookalike}`,
            value: lookalike,
            checked: false,
          },
        ],
      }),
    );
  });

  it("should shorten a name too long to fit on one line", async () => {
    checkboxMock.mockResolvedValue([]);
    // Long enough to wrap on any terminal, and padded so the wrapped part could
    // be drawn to look like a second entry.
    const padded = `pdf${" ".repeat(100)}pdf`;

    await promptSkillSelection({ availableSkills: [padded], preselectedSkills: [] });

    // The value is untouched, so the shortened label still selects the skill it
    // names.
    expect(checkboxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [{ name: `pdf${" ".repeat(68)}\u2026`, value: padded, checked: false }],
      }),
    );
  });

  it("should keep the note and the name together within one line", async () => {
    checkboxMock.mockResolvedValue([]);
    // Two entries that share a display form, so both carry a note, and a name
    // long enough that the note plus the name would wrap without a budget.
    const long = `pdf${"o".repeat(100)}`;
    const notedNames = ["skill", "Skill", long];

    await promptSkillSelection({ availableSkills: notedNames, preselectedSkills: [] });

    const choices = checkboxMock.mock.calls.at(-1)?.[0].choices as Array<{ name: string }>;
    for (const choice of choices) {
      // The budget is on the whole label, not on the name alone, so a long note
      // eats into the name rather than pushing it onto a second line.
      expect(displayWidthOf(choice.name)).toBeLessThanOrEqual(72);
    }
  });

  it("should measure a label in the columns it draws rather than its characters", async () => {
    checkboxMock.mockResolvedValue([]);
    // 60 ideographic spaces (U+3000) are 66 characters with the padding around
    // them and 126 columns on screen: a limit counted in characters would let
    // this one wrap and paint a second row of its own.
    const wide = `pdf${"\u3000".repeat(60)}pdf`;

    await promptSkillSelection({ availableSkills: [wide], preselectedSkills: [] });

    const choices = checkboxMock.mock.calls.at(-1)?.[0].choices as Array<{
      name: string;
      value: string;
    }>;
    expect(displayWidthOf(choices[0]?.name ?? "")).toBeLessThanOrEqual(72);
    expect(choices[0]?.value).toBe(wide);
  });

  it("should number labels that two different names are shortened into", async () => {
    checkboxMock.mockResolvedValue([]);
    // Neither name is confusable in itself: they are only indistinguishable
    // once the prompt cuts them down, which is the prompt's own doing.
    const shared = "a".repeat(71);
    const first = `${shared}-official`;
    const second = `${shared}-not-official`;

    await promptSkillSelection({ availableSkills: [first, second], preselectedSkills: [] });

    // The number leads the row, so it is not left sitting past the untrusted
    // half of the label, and the name is cut to leave room for it.
    const shortened = "a".repeat(67);
    expect(checkboxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [
          { name: `(1) ${shortened}\u2026`, value: first, checked: false },
          { name: `(2) ${shortened}\u2026`, value: second, checked: false },
        ],
      }),
    );
  });

  it("should keep a numbered label within the width the prompt draws", async () => {
    checkboxMock.mockResolvedValue([]);
    const shared = "a".repeat(71);

    await promptSkillSelection({
      availableSkills: [`${shared}-official`, `${shared}-not-official`],
      preselectedSkills: [],
    });

    const choices = checkboxMock.mock.calls.at(-1)?.[0].choices as Array<{ name: string }>;
    for (const choice of choices) {
      expect(displayWidthOf(choice.name)).toBeLessThanOrEqual(72);
    }
  });

  it("should number labels that draw the same though their names differ", async () => {
    checkboxMock.mockResolvedValue([]);
    // A zero-width space is nothing on screen, so both rows read "pdf". Both
    // are already marked as sharing a display form; the numbering is what says
    // which marked row is which.
    const hidden = "pd\u200bf";

    await promptSkillSelection({ availableSkills: ["pdf", hidden], preselectedSkills: [] });

    const choices = checkboxMock.mock.calls.at(-1)?.[0].choices as Array<{
      name: string;
      value: string;
    }>;
    expect(choices[0]?.name).toBe("(1) [!] another entry has the same display form \u2014 pdf");
    expect(choices[1]?.name).toBe(
      "(2) [!] another entry has the same display form \u2014 pd\u200bf",
    );
    expect(choices[1]?.value).toBe(hidden);
  });

  it("should mark a name that begins the way the prompt marks its own rows", async () => {
    checkboxMock.mockResolvedValue([]);
    const impostor = "[!] mixes characters from Cyrillic and Latin \u2014 pdf";

    await promptSkillSelection({ availableSkills: [impostor], preselectedSkills: [] });

    const choices = checkboxMock.mock.calls.at(-1)?.[0].choices as Array<{
      name: string;
      value: string;
    }>;
    expect(choices[0]?.name).toMatch(/^\[!\] begins the way this list marks its own rows \u2014 /u);
    expect(choices[0]?.value).toBe(impostor);
  });

  it("should mark a name that spells the prompt's own marks in lookalikes", async () => {
    checkboxMock.mockResolvedValue([]);
    // The same imitation drawn out of characters the ASCII spelling does not
    // cover: U+01C3 is an exclamation mark in every font, and an l inside the
    // parentheses is the number this list would have printed there.
    const impostor = "(l) [\u01c3] another entry has the same display form \u2014 pdf";

    await promptSkillSelection({ availableSkills: [impostor], preselectedSkills: [] });

    const choices = checkboxMock.mock.calls.at(-1)?.[0].choices as Array<{
      name: string;
      value: string;
    }>;
    expect(choices[0]?.name).toMatch(/^\[!\] begins the way this list marks its own rows \u2014 /u);
    expect(choices[0]?.value).toBe(impostor);
  });

  it("should number rows whose labels read alike without being the same text", async () => {
    checkboxMock.mockResolvedValue([]);
    // `git` and `ɡit` (U+0261) carry the same note as each other, so the two
    // rows are one shape from end to end. Nothing can say which is which, but
    // the numbers say they are two rows.
    const script = "\u0261it";

    await promptSkillSelection({ availableSkills: ["git", script], preselectedSkills: [] });

    const choices = checkboxMock.mock.calls.at(-1)?.[0].choices as Array<{
      name: string;
      value: string;
    }>;
    expect(choices[0]?.name).toMatch(/^\(1\) /u);
    expect(choices[1]?.name).toMatch(/^\(2\) /u);
    expect(choices[1]?.value).toBe(script);
  });

  it("should keep both reasons when a name imitates the markup and reads like another", async () => {
    checkboxMock.mockResolvedValue([]);
    // Cyrillic о in the second name: it reads as the first one, and it also
    // opens with the mark this list puts in front of its own warnings. One
    // reason must not push the other off the row.
    const latin = "[!] a-o";
    const cyrillic = "[!] a-\u043e";

    await promptSkillSelection({ availableSkills: [latin, cyrillic], preselectedSkills: [] });

    const choices = checkboxMock.mock.calls.at(-1)?.[0].choices as Array<{
      name: string;
      value: string;
    }>;
    expect(choices[1]?.name).toMatch(/begins the way this list marks its own rows; another/u);
    expect(choices[1]?.value).toBe(cyrillic);
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
