import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_IGNORE_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import { ignoreTools } from "./ignore.js";

describe("MCP Ignore Tools", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getIgnoreFile", () => {
    it("should get the content of .rulesyncignore file", async () => {
      const ignoreFilePath = join(testDir, RULESYNC_IGNORE_RELATIVE_FILE_PATH);
      const content = `# Ignore patterns
node_modules/
*.log
.env
`;

      await writeFileContent(ignoreFilePath, content);

      const result = await ignoreTools.getIgnoreFile.execute();
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_IGNORE_RELATIVE_FILE_PATH);
      expect(parsed.content).toBe(content);
    });

    it("should throw error for non-existent .rulesyncignore file", async () => {
      await expect(ignoreTools.getIgnoreFile.execute()).rejects.toThrow();
    });

    it("should handle empty .rulesyncignore file", async () => {
      const ignoreFilePath = join(testDir, RULESYNC_IGNORE_RELATIVE_FILE_PATH);
      await writeFileContent(ignoreFilePath, "");

      const result = await ignoreTools.getIgnoreFile.execute();
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_IGNORE_RELATIVE_FILE_PATH);
      expect(parsed.content).toBe("");
    });

    it("should handle .rulesyncignore with various patterns", async () => {
      const ignoreFilePath = join(testDir, RULESYNC_IGNORE_RELATIVE_FILE_PATH);
      const content = `# Comments are supported
*.md
!README.md
/dist
**/temp
**/*.test.ts
`;

      await writeFileContent(ignoreFilePath, content);

      const result = await ignoreTools.getIgnoreFile.execute();
      const parsed = JSON.parse(result);

      expect(parsed.content).toContain("*.md");
      expect(parsed.content).toContain("!README.md");
      expect(parsed.content).toContain("/dist");
      expect(parsed.content).toContain("**/temp");
    });
  });

  describe("putIgnoreFile", () => {
    it("should create a new .rulesyncignore file", async () => {
      const content = `# New ignore file
node_modules/
dist/
`;

      const result = await ignoreTools.putIgnoreFile.execute({ content });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_IGNORE_RELATIVE_FILE_PATH);
      expect(parsed.content).toBe(content);

      // Verify file was created
      const ignoreFilePath = join(testDir, RULESYNC_IGNORE_RELATIVE_FILE_PATH);
      const savedContent = await readFileContent(ignoreFilePath);
      expect(savedContent).toBe(content);
    });

    it("should update an existing .rulesyncignore file", async () => {
      const ignoreFilePath = join(testDir, RULESYNC_IGNORE_RELATIVE_FILE_PATH);
      const originalContent = `# Original
node_modules/
`;
      await writeFileContent(ignoreFilePath, originalContent);

      const updatedContent = `# Updated
node_modules/
dist/
.env
`;

      const result = await ignoreTools.putIgnoreFile.execute({ content: updatedContent });
      const parsed = JSON.parse(result);

      expect(parsed.content).toBe(updatedContent);

      // Verify file was updated
      const savedContent = await readFileContent(ignoreFilePath);
      expect(savedContent).toBe(updatedContent);
    });

    it("should handle empty content", async () => {
      const result = await ignoreTools.putIgnoreFile.execute({ content: "" });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_IGNORE_RELATIVE_FILE_PATH);
      expect(parsed.content).toBe("");
    });

    it("should reject oversized ignore file", async () => {
      const largeContent = "a".repeat(100 * 1024 + 1); // > 100KB

      await expect(ignoreTools.putIgnoreFile.execute({ content: largeContent })).rejects.toThrow(
        /exceeds maximum/i,
      );
    });

    it("should handle content with various line endings", async () => {
      const contentWithCRLF = `node_modules/\r\ndist/\r\n*.log\r\n`;

      const result = await ignoreTools.putIgnoreFile.execute({ content: contentWithCRLF });
      const parsed = JSON.parse(result);

      expect(parsed.content).toBe(contentWithCRLF);
    });

    it("should handle content with unicode characters", async () => {
      const contentWithUnicode = `# 日本語のコメント
# Русский комментарий
node_modules/
`;

      const result = await ignoreTools.putIgnoreFile.execute({ content: contentWithUnicode });
      const parsed = JSON.parse(result);

      expect(parsed.content).toBe(contentWithUnicode);
    });

    it("should handle complex gitignore patterns", async () => {
      const complexContent = `# Dependencies
node_modules/
bower_components/

# Build outputs
/dist
/build
*.js.map

# Environment files
.env
.env.local
.env.*.local

# IDE files
.vscode/
.idea/
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db

# Logs
logs/
*.log
npm-debug.log*

# Negation patterns
!important.log
!dist/keep-me.js
`;

      const result = await ignoreTools.putIgnoreFile.execute({ content: complexContent });
      const parsed = JSON.parse(result);

      expect(parsed.content).toBe(complexContent);

      // Verify file was created with correct content
      const ignoreFilePath = join(testDir, RULESYNC_IGNORE_RELATIVE_FILE_PATH);
      const savedContent = await readFileContent(ignoreFilePath);
      expect(savedContent).toBe(complexContent);
    });
  });

  describe("deleteIgnoreFile", () => {
    it("should delete an existing .rulesyncignore file", async () => {
      const ignoreFilePath = join(testDir, RULESYNC_IGNORE_RELATIVE_FILE_PATH);
      await writeFileContent(ignoreFilePath, "node_modules/\n");

      // Verify it exists
      await expect(ignoreTools.getIgnoreFile.execute()).resolves.toBeDefined();

      // Delete it
      const result = await ignoreTools.deleteIgnoreFile.execute();
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_IGNORE_RELATIVE_FILE_PATH);

      // Verify it's deleted
      await expect(ignoreTools.getIgnoreFile.execute()).rejects.toThrow();
    });

    it("should succeed when deleting non-existent .rulesyncignore (idempotent)", async () => {
      // Deleting a non-existent file should succeed (idempotent operation)
      const result = await ignoreTools.deleteIgnoreFile.execute();
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_IGNORE_RELATIVE_FILE_PATH);
    });
  });

  describe("integration scenarios", () => {
    it("should handle full CRUD lifecycle", async () => {
      const initialContent = `# Initial content
node_modules/
`;

      // Create
      await ignoreTools.putIgnoreFile.execute({ content: initialContent });

      // Read
      let result = await ignoreTools.getIgnoreFile.execute();
      let parsed = JSON.parse(result);
      expect(parsed.content).toBe(initialContent);

      // Update
      const updatedContent = `# Updated content
node_modules/
dist/
.env
`;
      await ignoreTools.putIgnoreFile.execute({ content: updatedContent });

      result = await ignoreTools.getIgnoreFile.execute();
      parsed = JSON.parse(result);
      expect(parsed.content).toBe(updatedContent);

      // Delete
      await ignoreTools.deleteIgnoreFile.execute();

      await expect(ignoreTools.getIgnoreFile.execute()).rejects.toThrow();
    });

    it("should handle multiple updates in sequence", async () => {
      const contents = [
        "# Version 1\nnode_modules/\n",
        "# Version 2\nnode_modules/\ndist/\n",
        "# Version 3\nnode_modules/\ndist/\n.env\n",
      ];

      for (const content of contents) {
        await ignoreTools.putIgnoreFile.execute({ content });

        const result = await ignoreTools.getIgnoreFile.execute();
        const parsed = JSON.parse(result);
        expect(parsed.content).toBe(content);
      }
    });

    it("should handle delete and recreate", async () => {
      const content1 = "# First version\nnode_modules/\n";
      const content2 = "# Second version\ndist/\n";

      // Create
      await ignoreTools.putIgnoreFile.execute({ content: content1 });

      // Delete
      await ignoreTools.deleteIgnoreFile.execute();

      // Recreate with different content
      await ignoreTools.putIgnoreFile.execute({ content: content2 });

      // Verify new content
      const result = await ignoreTools.getIgnoreFile.execute();
      const parsed = JSON.parse(result);
      expect(parsed.content).toBe(content2);
    });
  });

  describe("edge cases", () => {
    it("should handle content with only whitespace", async () => {
      const whitespaceContent = "   \n\n   \n";

      const result = await ignoreTools.putIgnoreFile.execute({ content: whitespaceContent });
      const parsed = JSON.parse(result);

      expect(parsed.content).toBe(whitespaceContent);
    });

    it("should handle content with special characters", async () => {
      const specialContent = `# Special chars: !@#$%^&*()
*.log
[abc].txt
{foo,bar}.js
`;

      const result = await ignoreTools.putIgnoreFile.execute({ content: specialContent });
      const parsed = JSON.parse(result);

      expect(parsed.content).toBe(specialContent);
    });

    it("should handle very long lines", async () => {
      const longPattern = "a".repeat(1000);
      const content = `${longPattern}\n`;

      const result = await ignoreTools.putIgnoreFile.execute({ content });
      const parsed = JSON.parse(result);

      expect(parsed.content).toBe(content);
    });

    it("should handle content near size limit", async () => {
      const nearLimitContent = "a".repeat(100 * 1024 - 100); // Just under 100KB

      const result = await ignoreTools.putIgnoreFile.execute({ content: nearLimitContent });
      const parsed = JSON.parse(result);

      expect(parsed.content).toBe(nearLimitContent);
    });
  });
});
