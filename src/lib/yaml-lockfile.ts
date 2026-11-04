import { dump } from "js-yaml";
import { refine, z } from "zod/mini";

import {
  assertWritablePathInsideRoot,
  fileExists,
  readFileContent,
  writeFileContent,
} from "../utils/file.js";
import { loadYaml } from "../utils/yaml.js";

/**
 * The 40-char hex commit SHA a YAML lockfile pins an entry to (`resolved_commit`
 * in both the apm and gh lockfiles).
 */
export const ResolvedCommitShaSchema = z
  .string()
  .check(refine((v) => /^[0-9a-f]{40}$/.test(v), "resolved_commit must be a 40-char hex SHA"));

/**
 * Parse YAML lockfile content against `schema`. Returns `null` when the
 * content is absent / empty / non-YAML-object so callers can treat the lock
 * as missing. A *structurally* present lockfile that fails schema validation
 * throws a descriptive error naming `fileName` rather than being silently
 * dropped — silently discarding a corrupt lockfile would erase previously
 * pinned commits.
 */
export function parseYamlLockfile<T extends z.ZodMiniType>(params: {
  content: string;
  schema: T;
  fileName: string;
}): z.infer<T> | null {
  const { content, schema, fileName } = params;
  if (!content.trim()) {
    return null;
  }
  let loaded: unknown;
  try {
    loaded = loadYaml(content);
  } catch {
    return null;
  }
  if (!loaded || typeof loaded !== "object") {
    return null;
  }
  const parsed = schema.safeParse(loaded);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid ${fileName}:\n${issues}`);
  }
  return parsed.data;
}

/**
 * Read and parse the lockfile at `path`, or return `null` when it does not exist.
 */
export async function readYamlLockfile<T>(params: {
  path: string;
  parse: (content: string) => T | null;
}): Promise<T | null> {
  if (!(await fileExists(params.path))) {
    return null;
  }
  const content = await readFileContent(params.path);
  return params.parse(content);
}

export async function writeYamlLockfile(params: {
  projectRoot: string;
  path: string;
  content: string;
}): Promise<void> {
  // The lockfile is committed with the project; refuse to follow a link that
  // would make this write overwrite a file elsewhere.
  await assertWritablePathInsideRoot({ rootPath: params.projectRoot, targetPath: params.path });
  await writeFileContent(params.path, params.content);
}

export function serializeYamlLockfile(lock: unknown): string {
  // `noRefs: true` avoids YAML anchors/aliases; `lineWidth: -1` keeps long
  // URLs and sha values on a single line so the file stays diff-friendly.
  return dump(lock, { noRefs: true, lineWidth: -1, sortKeys: false });
}
