import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await stat(dirPath);
  } catch {
    await mkdir(dirPath, { recursive: true });
  }
}

export async function readFileContent(filepath: string): Promise<string> {
  return readFile(filepath, "utf-8");
}

export async function writeFileContent(filepath: string, content: string): Promise<void> {
  await ensureDir(dirname(filepath));
  await writeFile(filepath, content, "utf-8");
}

export async function fileExists(filepath: string): Promise<boolean> {
  try {
    await stat(filepath);
    return true;
  } catch {
    return false;
  }
}
