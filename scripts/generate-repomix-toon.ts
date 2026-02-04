import { encode } from "@toon-format/toon";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "repomix";

type Variant = {
  name: string;
  include?: string[];
  ignore?: string[];
};

const variants: Variant[] = [
  {
    name: "repomix-output",
  },
  {
    name: "repomix-output-src",
    include: ["src/**/*.ts"],
    ignore: ["src/**/*.test.ts", "src/**/*.spec.ts"],
  },
  {
    name: "repomix-output-tests",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
  },
  {
    name: "repomix-output-configs",
    ignore: ["src/**/*", "repomix-output*"],
  },
];

const baseDir = process.cwd();

async function generateVariants(): Promise<void> {
  for (const variant of variants) {
    const jsonPath = join(baseDir, `${variant.name}.json`);
    const toonPath = join(baseDir, `${variant.name}.toon`);

    // oxlint-disable-next-line no-console
    console.log(`Generating ${variant.name}.json...`);

    const result = await runCli(["."], baseDir, {
      output: jsonPath,
      style: "json",
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
    console.log(`Converting to ${variant.name}.toon...`);
    const jsonContent = readFileSync(jsonPath, "utf-8");
    const jsonData: unknown = JSON.parse(jsonContent);
    const toonContent = encode(jsonData);
    writeFileSync(toonPath, toonContent);

    // oxlint-disable-next-line no-console
    console.log(`  Done: ${toonPath}\n`);
  }

  // oxlint-disable-next-line no-console
  console.log("All variants generated successfully!");
}

generateVariants().catch((error: unknown) => {
  // oxlint-disable-next-line no-console
  console.error("Error:", error);
  process.exit(1);
});
