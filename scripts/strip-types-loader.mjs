import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { URL, fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const JS_EXTENSION = ".js";
const TS_EXTENSION = ".ts";

function isRelativeOrAbsoluteFileSpecifier(specifier) {
  return (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("/") ||
    specifier.startsWith("file:")
  );
}

async function fileExists(url) {
  try {
    await access(fileURLToPath(url), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (isRelativeOrAbsoluteFileSpecifier(specifier) && specifier.endsWith(JS_EXTENSION)) {
    const tsSpecifier = `${specifier.slice(0, -JS_EXTENSION.length)}${TS_EXTENSION}`;
    try {
      const resolvedTs = await nextResolve(tsSpecifier, context);
      if (await fileExists(resolvedTs.url)) {
        return resolvedTs;
      }
    } catch {
      // Fall through to default resolution.
    }
  }

  if (specifier.startsWith("file:") && specifier.endsWith(JS_EXTENSION)) {
    const tsUrl = new URL(`${specifier.slice(0, -JS_EXTENSION.length)}${TS_EXTENSION}`);
    if (await fileExists(tsUrl.href)) {
      return nextResolve(tsUrl.href, context);
    }
  }

  if (specifier.startsWith("/") && specifier.endsWith(JS_EXTENSION)) {
    const tsUrl = pathToFileURL(`${specifier.slice(0, -JS_EXTENSION.length)}${TS_EXTENSION}`);
    if (await fileExists(tsUrl.href)) {
      return nextResolve(tsUrl.href, context);
    }
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(TS_EXTENSION)) {
    return nextLoad(url, context);
  }

  const source = await readFile(fileURLToPath(url), "utf8");

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      preserveValueImports: false,
    },
    fileName: fileURLToPath(url),
  });

  return {
    format: "module",
    shortCircuit: true,
    source: transpiled.outputText,
  };
}
