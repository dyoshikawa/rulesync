import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/**
 * What `process.stdout.columns` was before a test pinned it. A pipe has no such
 * property at all, which is why the descriptor is kept rather than the value.
 */
const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns");

/**
 * Pin the width the labels are budgeted against, so what the assertions expect
 * does not depend on the window the test run happens to sit in. `undefined`
 * stands for the terminal that does not say how wide it is, which is what the
 * prompt sees when its output is a pipe.
 */
function setTerminalWidth(columns: number | undefined): void {
  Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true });
}

describe("promptSkillSelection", () => {
  beforeEach(() => {
    // 80 columns leaves 77 for the label, so the 72-column ceiling is what the
    // tests below are measuring against.
    setTerminalWidth(80);
  });

  afterEach(() => {
    if (originalColumns === undefined) {
      delete (process.stdout as { columns?: number }).columns;
      return;
    }
    Object.defineProperty(process.stdout, "columns", originalColumns);
  });

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
    // Long enough to wrap on any terminal, and nothing else the matter with it,
    // so the whole row is the name.
    const long = `pdf${"o".repeat(100)}`;

    await promptSkillSelection({ availableSkills: [long], preselectedSkills: [] });

    // The value is untouched, so the shortened label still selects the skill it
    // names.
    expect(checkboxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [{ name: `pdf${"o".repeat(68)}\u2026`, value: long, checked: false }],
      }),
    );
  });

  it("should mark a name padded with the whitespace that hides the padding", async () => {
    checkboxMock.mockResolvedValue([]);
    // Padded so the wrapped part could be drawn to look like a second entry.
    // The run of spaces is drawn as one gap however long it is, so the note is
    // the only thing that says the row reaches past what can be seen of it.
    const padded = `pdf${" ".repeat(100)}pdf`;

    await promptSkillSelection({ availableSkills: [padded], preselectedSkills: [] });

    expect(checkboxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [
          {
            name: `[!] carries more whitespace than the row shows \u2014 pdf${" ".repeat(19)}\u2026`,
            value: padded,
            checked: false,
          },
        ],
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

  it("should mark a name that draws the prompt's brackets with other brackets", async () => {
    checkboxMock.mockResolvedValue([]);
    // U+2045 and U+2046 are square brackets with a quill on them, and are the
    // shape a reader takes for the plain pair this list opens a warning with.
    const impostor = "\u2045!\u2046 another entry has the same display form \u2014 pdf";

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

  it("should fit the label to a terminal narrower than the widest one it draws", async () => {
    checkboxMock.mockResolvedValue([]);
    // A 120-column window split down the middle. The prompt draws a pointer, a
    // checkbox and a space in front of the label and nothing at all in front of
    // the line a label wraps onto, so 57 columns is what a row has to spare.
    setTerminalWidth(60);
    const padded = `pdf${" ".repeat(100)}pdf`;

    await promptSkillSelection({ availableSkills: [padded], preselectedSkills: [] });

    const choices = checkboxMock.mock.calls.at(-1)?.[0].choices as Array<{
      name: string;
      value: string;
    }>;
    expect(displayWidthOf(choices[0]?.name ?? "")).toBeLessThanOrEqual(57);
    expect(choices[0]?.value).toBe(padded);
  });

  it("should fit a numbered label to the narrow terminal too", async () => {
    checkboxMock.mockResolvedValue([]);
    // The number is drawn in front of a label that was already cut to fit, so
    // it has to come out of the same width rather than be added to it.
    setTerminalWidth(60);
    const shared = "a".repeat(71);

    await promptSkillSelection({
      availableSkills: [`${shared}-official`, `${shared}-not-official`],
      preselectedSkills: [],
    });

    const choices = checkboxMock.mock.calls.at(-1)?.[0].choices as Array<{ name: string }>;
    for (const choice of choices) {
      expect(displayWidthOf(choice.name)).toBeLessThanOrEqual(57);
    }
  });

  it("should assume the width its own renderer assumes when the terminal is silent", async () => {
    checkboxMock.mockResolvedValue([]);
    // A pipe carries no width, and the renderer wraps at 80 when asked one it
    // cannot answer, so the label is budgeted against the same 80.
    setTerminalWidth(undefined);
    const long = `pdf${"o".repeat(100)}`;

    await promptSkillSelection({ availableSkills: [long], preselectedSkills: [] });

    const choices = checkboxMock.mock.calls.at(-1)?.[0].choices as Array<{ name: string }>;
    expect(choices[0]?.name).toBe(`pdf${"o".repeat(68)}\u2026`);
  });

  it("should keep a name readable in a terminal too narrow for any label", async () => {
    checkboxMock.mockResolvedValue([]);
    // Nothing fits in ten columns, and a row cut to an ellipsis is worse than a
    // row that wraps: the floor is the width a name keeps however little room
    // the terminal gives it.
    setTerminalWidth(10);
    const long = `pdf${"o".repeat(100)}`;

    await promptSkillSelection({ availableSkills: [long], preselectedSkills: [] });

    const choices = checkboxMock.mock.calls.at(-1)?.[0].choices as Array<{ name: string }>;
    expect(choices[0]?.name).toBe(`pdf${"o".repeat(12)}\u2026`);
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
