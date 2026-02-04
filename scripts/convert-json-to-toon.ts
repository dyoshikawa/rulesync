import { encode } from "@toon-format/toon";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const inputPath = process.argv[2] ?? join(process.cwd(), "repomix-output.json");
const outputPath = process.argv[3] ?? inputPath.replace(/\.json$/, ".toon");

const jsonContent = readFileSync(inputPath, "utf-8");
const jsonData: unknown = JSON.parse(jsonContent);

const toonContent = encode(jsonData);

writeFileSync(outputPath, toonContent);

// oxlint-disable-next-line no-console
console.log(`Converted: ${inputPath} -> ${outputPath}`);
