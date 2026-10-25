import { toPosixPath } from "../../utils/file.js";

/**
 * Split a nested rule directory such as `packages/api/<toolDir>/rules/sub` into
 * the subproject (`packages/api`) and the folder inside its rules directory
 * (`sub`), for the tools that read a `<toolDir>/rules/` directory in any
 * subdirectory. Returns `undefined` for the project-root `<toolDir>/rules/`,
 * for a path with no `<toolDir>/rules` segment, and for one under a hidden
 * directory — another tool's output or a worktree, not a subproject.
 */
export function extractRulesDirSubprojectPath({
  relativeDirPath,
  toolDir,
}: {
  relativeDirPath: string;
  toolDir: string;
}): { subprojectPath: string; innerDirPath: string } | undefined {
  const segments = toPosixPath(relativeDirPath).split("/");
  const index = segments.findIndex(
    (segment, i) => segment === toolDir && segments[i + 1] === "rules",
  );
  if (index <= 0) {
    return undefined;
  }
  const subprojectSegments = segments.slice(0, index);
  if (subprojectSegments.some((segment) => segment === "" || segment.startsWith("."))) {
    return undefined;
  }
  return {
    subprojectPath: subprojectSegments.join("/"),
    innerDirPath: segments.slice(index + 2).join("/"),
  };
}
