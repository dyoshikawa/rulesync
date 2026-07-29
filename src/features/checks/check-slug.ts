/**
 * Turn a name that came out of a tool's own config file into one safe to use as
 * a `.rulesync/checks/<name>.md` file name. Shared by the adapters whose checks
 * collapse into a single file, since the name they read back is whatever the
 * user wrote there.
 */
export function slugifyCheckName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      // Again after the slice, so a cut landing on a separator does not leave a
      // name like `foo--1.md`.
      .replace(/-+$/, "")
  );
}
