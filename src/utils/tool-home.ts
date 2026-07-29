import { getHomeDirectory } from "./file.js";

/**
 * Where the rulesync-side source files of a tool with a home override belong.
 *
 * A home override redirects the tool's OWN output, but the `.rulesync/` sources
 * imported back out of it are not part of the tool's profile — they stay under
 * the rulesync home. When no override is set, the native output root already is
 * that place.
 */
export function getToolRulesyncOutputRoot({
  nativeOutputRoot,
  global,
  toolHome,
}: {
  nativeOutputRoot: string;
  global: boolean;
  toolHome: () => string | undefined;
}): string {
  return global && toolHome() ? getHomeDirectory() : nativeOutputRoot;
}
