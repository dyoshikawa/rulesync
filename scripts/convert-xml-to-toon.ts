/**
 * XML -> JSON -> TOON 変換スクリプト
 *
 * 使用方法:
 *   pnpm tsx scripts/convert-xml-to-toon.ts <input.xml> [output.toon]
 *
 * 例:
 *   pnpm tsx scripts/convert-xml-to-toon.ts repomix-output.xml
 *   pnpm tsx scripts/convert-xml-to-toon.ts repomix-output.xml output.toon
 */

import { encode } from "@toon-format/toon";
import { XMLParser } from "fast-xml-parser";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

type ConversionResult = {
  inputFile: string;
  jsonFile: string;
  toonFile: string;
  xmlSize: number;
  jsonSize: number;
  toonSize: number;
  compressionRatio: number;
};

function parseArgs(): { inputFile: string; outputFile?: string } {
  const args = process.argv.slice(2);
  const inputFile = args[0];

  if (inputFile === undefined) {
    // oxlint-disable-next-line no-console
    console.error("使用方法: pnpm tsx scripts/convert-xml-to-toon.ts <input.xml> [output.toon]");
    process.exit(1);
  }

  return {
    inputFile,
    outputFile: args[1],
  };
}

function convertXmlToJson(xmlContent: string): unknown {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    preserveOrder: false,
    trimValues: true,
  });

  return parser.parse(xmlContent);
}

function convertJsonToToon(jsonData: unknown): string {
  return encode(jsonData);
}

function main(): void {
  const { inputFile, outputFile } = parseArgs();

  // 入力ファイルのパスを解決
  const inputPath = inputFile.startsWith("/") ? inputFile : join(process.cwd(), inputFile);

  // 出力ファイル名を生成
  const baseName = basename(inputFile, ".xml");
  const jsonOutputPath = outputFile
    ? join(process.cwd(), outputFile.replace(/\.toon$/, ".json"))
    : join(process.cwd(), `${baseName}.json`);
  const toonOutputPath = outputFile
    ? join(process.cwd(), outputFile)
    : join(process.cwd(), `${baseName}.toon`);

  // oxlint-disable-next-line no-console
  console.log(`\n📂 入力ファイル: ${inputPath}`);

  // Step 1: XMLファイルを読み込む
  // oxlint-disable-next-line no-console
  console.log("\n🔄 Step 1: XMLファイルを読み込み中...");
  const xmlContent = readFileSync(inputPath, "utf-8");
  const xmlSize = Buffer.byteLength(xmlContent, "utf-8");
  // oxlint-disable-next-line no-console
  console.log(`   XMLサイズ: ${(xmlSize / 1024).toFixed(2)} KB`);

  // Step 2: XML -> JSON 変換
  // oxlint-disable-next-line no-console
  console.log("\n🔄 Step 2: XML -> JSON 変換中...");
  const jsonData = convertXmlToJson(xmlContent);
  const jsonContent = JSON.stringify(jsonData, null, 2);
  const jsonSize = Buffer.byteLength(jsonContent, "utf-8");
  // oxlint-disable-next-line no-console
  console.log(`   JSONサイズ: ${(jsonSize / 1024).toFixed(2)} KB`);

  // JSONファイルを保存
  writeFileSync(jsonOutputPath, jsonContent);
  // oxlint-disable-next-line no-console
  console.log(`   📁 JSON保存先: ${jsonOutputPath}`);

  // Step 3: JSON -> TOON 変換
  // oxlint-disable-next-line no-console
  console.log("\n🔄 Step 3: JSON -> TOON 変換中...");
  const toonContent = convertJsonToToon(jsonData);
  const toonSize = Buffer.byteLength(toonContent, "utf-8");
  // oxlint-disable-next-line no-console
  console.log(`   TOONサイズ: ${(toonSize / 1024).toFixed(2)} KB`);

  // TOONファイルを保存
  writeFileSync(toonOutputPath, toonContent);
  // oxlint-disable-next-line no-console
  console.log(`   📁 TOON保存先: ${toonOutputPath}`);

  // 結果サマリー
  const compressionRatio = ((1 - toonSize / jsonSize) * 100).toFixed(1);

  const result: ConversionResult = {
    inputFile: inputPath,
    jsonFile: jsonOutputPath,
    toonFile: toonOutputPath,
    xmlSize,
    jsonSize,
    toonSize,
    compressionRatio: Number.parseFloat(compressionRatio),
  };

  // oxlint-disable-next-line no-console
  console.log("\n✅ 変換完了!");
  // oxlint-disable-next-line no-console
  console.log("\n📊 サマリー:");
  // oxlint-disable-next-line no-console
  console.log(
    `   XML  → JSON: ${(result.xmlSize / 1024).toFixed(2)} KB → ${(result.jsonSize / 1024).toFixed(2)} KB`,
  );
  // oxlint-disable-next-line no-console
  console.log(
    `   JSON → TOON: ${(result.jsonSize / 1024).toFixed(2)} KB → ${(result.toonSize / 1024).toFixed(2)} KB`,
  );
  // oxlint-disable-next-line no-console
  console.log(`   圧縮率 (JSON → TOON): ${result.compressionRatio}%\n`);
}

main();
