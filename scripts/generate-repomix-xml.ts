import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { runCli } from "repomix";

type Variant = {
  name: string;
  include?: string[];
  ignore?: string[];
};

function getSubdirectories(dirPath: string): string[] {
  return readdirSync(dirPath)
    .filter((entry) => statSync(join(dirPath, entry)).isDirectory())
    .toSorted();
}

const baseDir = process.cwd();

function buildVariants(): Variant[] {
  const srcDirs = getSubdirectories(join(baseDir, "src"));
  const featureDirs = getSubdirectories(join(baseDir, "src", "features"));

  const variants: Variant[] = [
    {
      name: "repomix-output-full",
    },
  ];

  for (const dir of srcDirs) {
    if (dir === "features") {
      continue;
    }
    variants.push({
      name: `repomix-output-${dir}`,
      include: [`src/${dir}/**/*.ts`],
    });
  }

  for (const dir of featureDirs) {
    variants.push({
      name: `repomix-output-features-${dir}`,
      include: [`src/features/${dir}/**/*.ts`],
    });
  }

  variants.push({
    name: "repomix-output-configs",
    ignore: ["src/**/*", "repomix-output*"],
  });

  return variants;
}

async function generateVariants(): Promise<void> {
  const variants = buildVariants();

  for (const variant of variants) {
    const xmlPath = join(baseDir, `${variant.name}.xml`);

    // oxlint-disable-next-line no-console
    console.log(`Generating ${variant.name}.xml...`);

    const result = await runCli(["."], baseDir, {
      output: xmlPath,
      style: "xml",
      include: variant.include?.join(","),
      ignore: variant.ignore?.join(","),
    });

    if (result) {
      // oxlint-disable-next-line no-console
      console.log(
        `  Files: ${result.packResult.totalFiles}, Tokens: ${result.packResult.totalTokens}`,
      );
    }

    // oxlint-disable-next-line no-console
    console.log(`  Done: ${xmlPath}\n`);
  }

  // oxlint-disable-next-line no-console
  console.log("All variants generated successfully!");
}

generateVariants().catch((error: unknown) => {
  // oxlint-disable-next-line no-console
  console.error("Error:", error);
  process.exit(1);
});
