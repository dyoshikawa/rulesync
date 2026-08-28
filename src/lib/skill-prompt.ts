import checkbox from "@inquirer/checkbox";

import {
  describeConfusableNames,
  displayFormOf,
  readingFormOf,
} from "../utils/confusable-names.js";
import { displayWidthOf, shortenToWidth } from "../utils/display-width.js";

/**
 * Thrown when the user cancels the interactive skill selection (e.g. Ctrl+C).
 * Callers should treat this as a graceful cancel, not a failure.
 */
export class SkillSelectionCancelledError extends Error {
  constructor() {
    super("Skill selection was cancelled.");
    this.name = "SkillSelectionCancelledError";
  }
}

/**
 * Key bindings offered by the checkbox prompt, pinned rather than left to the
 * library default. Nothing is checked when the prompt opens, so `a` is the
 * shortcut that makes "fetch everything" a single keystroke and `i` covers the
 * inverse "everything except these" flow. `a` toggles: it checks everything
 * while anything is unchecked, and clears the list once all of it is checked.
 * Both keys are listed in the prompt's own help line, and spelling them out
 * here keeps the binding visible next to the empty default it exists for.
 */
const SKILL_PROMPT_SHORTCUTS = {
  all: "a",
  invert: "i",
} as const;

/**
 * How wide a label the prompt draws, in terminal columns.
 *
 * A directory name can be 255 bytes long, which wraps across several lines of a
 * terminal and lets a name padded with spaces paint what looks like another
 * entry underneath itself. The limit is on the whole label rather than on the
 * name alone, so a long note cannot push the name onto a second line either.
 * What is cut is only the label: the value stays whole, so a shortened name
 * still stands for the directory it names.
 *
 * Columns rather than characters, because the two part ways precisely where an
 * attacker would want them to: 66 ideographic spaces are 66 characters and 132
 * columns, so a limit counted in characters would wave them through.
 */
const MAX_SKILL_LABEL_WIDTH = 72;

/**
 * How much of a name survives however long the note in front of it is. A name
 * cut to nothing would leave the picker choosing between rows it cannot tell
 * apart at all, which is worse than a label that wraps.
 */
const MIN_SHORTENED_NAME_WIDTH = 16;

/** Marks the label as carrying the tool's own warning rather than a name. */
const NOTE_MARKER = "[!] ";

/** Separates the note from the name; an em dash appears in no directory name. */
const NOTE_SEPARATOR = " \u2014 ";

/**
 * Label one skill in the prompt, leading with the reason it may be mistaken for
 * another entry when there is one.
 *
 * The reason goes first because the name is the untrusted half. A name may
 * itself read `pdf  [!] mixes characters from Cyrillic and Latin`, and trailing
 * it with the real note would leave the two indistinguishable; a name that ends
 * in right-to-left letters would also pull a trailing note out of place. In
 * front, the note is always the tool's own text at the start of the line.
 *
 * The name is measured first and the note takes what is left, so a short name
 * keeps its whole note. Only a name long enough to claim the row cuts into the
 * note, and the reasons are ordered by weight, so a cut takes them from the
 * tail: the marker survives every time, and so does the beginning of the first
 * reason.
 */
function formatSkillChoiceLabel(params: {
  name: string;
  note: string | undefined;
  budget: number;
}): string {
  const { name, note, budget } = params;
  if (note === undefined) {
    return shortenToWidth({ text: name, budget });
  }
  const available = budget - displayWidthOf(NOTE_MARKER) - displayWidthOf(NOTE_SEPARATOR);
  const shownName = shortenToWidth({
    text: name,
    budget: Math.max(available - displayWidthOf(note), MIN_SHORTENED_NAME_WIDTH),
  });
  const shownNote = shortenToWidth({
    text: note,
    budget: available - displayWidthOf(shownName),
  });
  return `${NOTE_MARKER}${shownNote}${NOTE_SEPARATOR}${shownName}`;
}

/**
 * The text a name is given a note of its own for starting with: the mark this
 * module puts in front of a warning, and the row number it puts in front of a
 * repeated label.
 *
 * Both are the prompt's own words, and a name is free to begin with either. A
 * name that does gets a note saying so, which puts the real mark in front of it
 * and leaves the imitation where it can be seen for what it is.
 */
const PROMPT_MARKUP_PATTERN = /^(?:\[!\]|\(\d+\))/u;

const PROMPT_MARKUP_NOTE = "begins the way this list marks its own rows";

/** The row number a repeated label is told apart by. */
function numberPrefixOf(position: number): string {
  return `(${position}) `;
}

/**
 * Label every skill on the list, keeping the labels distinct.
 *
 * Shortening is what makes this necessary: two names that share a long enough
 * beginning are cut down to the same label, and a repository can pick them so
 * that they are. Names that collide only after shortening carry no note of
 * their own — nothing about them is confusable until the prompt truncates them
 * — so the numbering is added here, where the truncation happens, rather than
 * being asked of `describeConfusableNames`.
 *
 * The number goes in front, for the reason the note does: at the end it would
 * sit past the untrusted half of the label, where a name ending in right-to-left
 * letters can pull it out of place, and it would push the row past the width the
 * label was cut to fit. The number is the row's own position in the list rather
 * than a counter per collision, so no two rows can be given the same one.
 *
 * Labels are counted in the form they are read in rather than the form they are
 * written in, so two rows are numbered whenever a reader cannot tell them
 * apart: one differing only by a character that draws as nothing, and equally
 * `git` beside `ɡit`, whose notes say the same thing about each other and
 * whose names are one shape. Numbering them does not say which is which — no
 * note can — but it does say they are two rows and not one printed twice.
 */
function formatSkillChoiceLabels(params: {
  names: string[];
  notes: ReadonlyMap<string, string>;
}): string[] {
  const { names, notes } = params;
  // Both notes when both apply: a name can read like another entry and open
  // with the tool's own markup at once, and dropping either reason would leave
  // the row explained by half of what is wrong with it.
  const noteFor = (name: string): string | undefined => {
    const reasons = [
      PROMPT_MARKUP_PATTERN.test(displayFormOf(name)) ? PROMPT_MARKUP_NOTE : undefined,
      notes.get(name),
    ].filter((reason) => reason !== undefined);
    return reasons.length > 0 ? reasons.join("; ") : undefined;
  };
  const labels = names.map((name) =>
    formatSkillChoiceLabel({ name, note: noteFor(name), budget: MAX_SKILL_LABEL_WIDTH }),
  );
  const counts = new Map<string, number>();
  for (const label of labels) {
    const drawn = readingFormOf(label);
    counts.set(drawn, (counts.get(drawn) ?? 0) + 1);
  }
  return labels.map((label, index) => {
    if ((counts.get(readingFormOf(label)) ?? 0) < 2) {
      return label;
    }
    const prefix = numberPrefixOf(index + 1);
    const name = names[index] ?? label;
    return `${prefix}${formatSkillChoiceLabel({
      name,
      note: noteFor(name),
      budget: MAX_SKILL_LABEL_WIDTH - displayWidthOf(prefix),
    })}`;
  });
}

/**
 * Prompt the user to select skills via an interactive checkbox prompt.
 *
 * Extracted into its own module so tests can mock the prompt without
 * touching the terminal.
 *
 * @param availableSkills - Skill names discovered in the source repository
 * @param preselectedSkills - Skill names to pre-check (from --skills); when
 *   empty, every skill starts unchecked and the user opts in
 * @returns The skill names the user selected
 */
export async function promptSkillSelection(params: {
  availableSkills: string[];
  preselectedSkills: string[];
}): Promise<string[]> {
  const { availableSkills, preselectedSkills } = params;
  const confusableNotes = describeConfusableNames(availableSkills);
  // The label is the only thing the user judges a skill by, and two names can
  // be drawn identically. The labels carry the note that says so, and are made
  // distinct from each other; `value` stays the real name, so what is written
  // is still exactly what was checked.
  const labels = formatSkillChoiceLabels({ names: availableSkills, notes: confusableNotes });

  try {
    return await checkbox({
      message: `Select skills to fetch (press <${SKILL_PROMPT_SHORTCUTS.all}> to select/deselect all)`,
      choices: availableSkills.map((name, index) => ({
        name: labels[index] ?? name,
        value: name,
        // Start from nothing selected. Fetching writes files into the user's
        // project, so an unattended <enter> should fetch nothing rather than
        // every skill the source repository happens to publish.
        checked: preselectedSkills.includes(name),
      })),
      shortcuts: SKILL_PROMPT_SHORTCUTS,
    });
  } catch (error) {
    // @inquirer prompts reject with ExitPromptError when the user presses
    // Ctrl+C; surface that as a graceful cancel instead of a failure.
    if (error instanceof Error && error.name === "ExitPromptError") {
      throw new SkillSelectionCancelledError();
    }
    throw error;
  }
}

/**
 * Check whether the current process can run an interactive prompt.
 */
export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}
