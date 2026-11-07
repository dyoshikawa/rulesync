import { hasDeceptiveHiddenCharacters, stripHiddenCharacters } from "./control-characters.js";

/**
 * Name checks for a directory or file name chosen by a remote source (a
 * fetched repository, an installed git, GitHub or npm source). Shared by
 * `rulesync fetch` and `rulesync install`, so a name one of them turns away is
 * not written, or printed raw, by the other.
 */

/** A name with no character in it that draws anything of its own. */
const NOTHING_DRAWN_PATTERN = /^[\s\p{M}]*$/u;
/**
 * The marks a name begins with. A mark is drawn over the character before it,
 * and a name has nothing before it of its own: a leading one is drawn over
 * whatever the terminal printed last — the checkbox, the quote around a name
 * in a warning — while the name reads as if it began with its first letter.
 */
const LEADING_MARKS_PATTERN = /^\p{M}+/u;

/**
 * A name ending in a dot or an ASCII space, which Win32 strips before it opens
 * the path. Only the plain space (U+0020): Win32 keeps every other trailing
 * blank, so a name ending in a no-break or an ideographic space is written
 * where it says, and is left to the whitespace note of the confusable-name
 * check rather than dropped here with Windows named as the reason.
 */
const TRAILING_DOT_OR_SPACE_PATTERN = /[. ]$/;
/** A name ending in the `NAME~1` shape of a Windows 8.3 short name, extension included. */
const SHORT_NAME_ALIAS_PATTERN = /~\d+(?:\.[^.]*)?$/;
/**
 * A name Win32 reserves for a device — `CON`, `PRN`, `AUX`, `NUL`, `CONIN$`,
 * `CONOUT$`, `COM1`–`COM9`, `LPT1`–`LPT9` — in any case and with any
 * extension: `nul.md` is the null device too, since the reservation is decided
 * on the part before the first dot, with any spaces before that dot dropped
 * first, so `nul .md` is the null device as well. The port digit may also be
 * one of the superscript digits ¹ ² ³, which Win32 reads as 1, 2 and 3
 * (`RtlIsDosDeviceName_U`; CPython's `ntpath.isreserved` follows the same
 * rules).
 */
const RESERVED_DEVICE_NAME_PATTERN =
  /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9\u00B9\u00B2\u00B3]|LPT[1-9\u00B9\u00B2\u00B3]) *(?:\..*)?$/i;

/**
 * Whether Windows resolves a path segment to something other than the entry it
 * reads as.
 *
 * Win32 drops a trailing dot or ASCII space when it resolves a path, so a remote
 * `skills/deploy.` is the existing `skills/deploy` there. A name ending in the
 * `NAME~1` shape is the same class of problem: on a volume that generates
 * short names, it opens whatever long name it stands for. The shape only
 * means that at the end of a name, so `data~2parser` and `v1.0` are ordinary
 * names. A reserved device name is the extreme case: `nul` and `nul.md` are
 * not entries in any directory but the null device itself, so a write to one
 * lands nowhere, and a directory of that name cannot be created at all.
 *
 * The predicate is asked of every segment of a written path — the skill
 * directory, but equally a nested `references/notes. ` or a `scripts/con.sh`
 * — since a folded segment anywhere in a path lands the file beside, or on top
 * of, a sibling the repository never published. The check is not gated on the
 * platform: the same repository is checked out on several of them, and a name
 * that lands somewhere else on any one of them is one this tool would rather
 * turn away everywhere than write differently depending on where it runs.
 */
export function hasWindowsFoldableName(name: string): boolean {
  return (
    TRAILING_DOT_OR_SPACE_PATTERN.test(name) ||
    SHORT_NAME_ALIAS_PATTERN.test(name) ||
    RESERVED_DEVICE_NAME_PATTERN.test(name)
  );
}

/** Why a remote name is turned away: it hides characters, or Windows folds it. */
export type UnsafeRemoteNameReason = "hidden" | "foldable";

export type RemoteNameVerdict =
  | { readonly kind: "safe" }
  | {
      readonly kind: "unsafe";
      /** The name with its hidden characters removed, safe to print. */
      readonly display: string;
      readonly reason: UnsafeRemoteNameReason;
    };

/**
 * Whether a remote name is safe to write and to print as it is.
 *
 * A name of nothing but blank space is shown as the empty string, the same as
 * one that strips down to nothing: both draw as a row with no name on it. So
 * is a name of nothing but combining marks, which have no character of their
 * own to sit on and draw as a smear over whatever the terminal puts beside
 * them. A name that merely begins with a mark is turned away for the same
 * reason, and shown without it: the mark sits on nothing the name owns. A name
 * carrying control characters (an ANSI, C1 or OSC sequence) or deceptive
 * zero-width characters is turned away too, so it can neither rewrite the
 * terminal nor pass for another name. The Windows-folding check comes after
 * the hidden characters, so a name that is both is reported by the reason that
 * keeps its raw form off the terminal.
 */
export function classifyRemoteName(name: string): RemoteNameVerdict {
  const stripped = stripHiddenCharacters(name);
  const beginsWithMark = LEADING_MARKS_PATTERN.test(stripped);
  const display = NOTHING_DRAWN_PATTERN.test(stripped)
    ? ""
    : stripped.replace(LEADING_MARKS_PATTERN, "");
  if (display === "" || beginsWithMark || hasDeceptiveHiddenCharacters(name)) {
    return { kind: "unsafe", display, reason: "hidden" };
  }
  if (hasWindowsFoldableName(name)) {
    return { kind: "unsafe", display, reason: "foldable" };
  }
  return { kind: "safe" };
}
