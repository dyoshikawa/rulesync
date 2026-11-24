/**
 * Minimal typings for js-yaml 4, installed under the `js-yaml-v4` npm alias
 * next to js-yaml 5. Frontmatter is read and written with v4 so that it parses
 * exactly as it did in this repository and the release binaries, where
 * gray-matter ran on js-yaml 4 through a pnpm override; see
 * `src/utils/frontmatter.ts`. js-yaml 4 ships no typings of its own.
 */
declare module "js-yaml-v4" {
  export function load(input: string, options?: { filename?: string }): unknown;
  export function dump(input: unknown, options?: { lineWidth?: number }): string;
}
