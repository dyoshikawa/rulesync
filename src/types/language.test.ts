import { describe, expect, it } from "vitest";

import {
  appendLanguageBlock,
  buildLanguageInstruction,
  getClaudecodeLanguageValue,
  getLanguageName,
  LANGUAGE_CODES,
  LanguageSchema,
  stripLanguageBlock,
} from "./language.js";

describe("LanguageSchema", () => {
  it("accepts every supported code", () => {
    for (const code of LANGUAGE_CODES) {
      expect(LanguageSchema.safeParse(code).success).toBe(true);
    }
  });

  it("rejects unknown and mis-cased codes", () => {
    expect(LanguageSchema.safeParse("jp").success).toBe(false);
    expect(LanguageSchema.safeParse("JA").success).toBe(false);
    expect(LanguageSchema.safeParse("zh-cn").success).toBe(false);
    expect(LanguageSchema.safeParse("").success).toBe(false);
  });
});

describe("language display data", () => {
  it("maps codes to English names and Claude Code setting values", () => {
    expect(getLanguageName("ja")).toBe("Japanese");
    expect(getLanguageName("zh-CN")).toBe("Simplified Chinese");
    expect(getLanguageName("zh-TW")).toBe("Traditional Chinese");
    expect(getLanguageName("pt-BR")).toBe("Brazilian Portuguese");
    expect(getClaudecodeLanguageValue("ja")).toBe("japanese");
    expect(getClaudecodeLanguageValue("zh-CN")).toBe("simplified chinese");
    expect(getClaudecodeLanguageValue("pt-BR")).toBe("brazilian portuguese");
  });

  it("emits an instruction for English too, since `en` is not a no-op", () => {
    expect(buildLanguageInstruction("en")).toBe(
      "You must always answer in English. On the other hand, reasoning (thinking) should be in English to improve token efficiency.",
    );
  });
});

describe("appendLanguageBlock", () => {
  it("appends a thematic break and the instruction after a blank line", () => {
    expect(appendLanguageBlock({ content: "# Rules\n\nBe kind.\n", language: "ja" })).toBe(
      "# Rules\n\nBe kind.\n\n---\n\nYou must always answer in Japanese. On the other hand, reasoning (thinking) should be in English to improve token efficiency.",
    );
  });

  it("emits the instruction alone for an empty body so the file never opens with ---", () => {
    expect(appendLanguageBlock({ content: "", language: "fr" })).toBe(
      buildLanguageInstruction("fr"),
    );
    expect(appendLanguageBlock({ content: "  \n\n", language: "fr" })).toBe(
      buildLanguageInstruction("fr"),
    );
  });
});

describe("stripLanguageBlock", () => {
  it.each(LANGUAGE_CODES)("round-trips a block appended for %s", (language) => {
    const body = "# Rules\n\nBe kind.";
    const appended = appendLanguageBlock({ content: body, language });
    expect(stripLanguageBlock(appended)).toBe(body);
    expect(stripLanguageBlock(`${appended}\n`)).toBe(body);
  });

  it("strips a bare instruction left from an empty body", () => {
    expect(stripLanguageBlock(buildLanguageInstruction("de"))).toBe("");
    expect(stripLanguageBlock(`${buildLanguageInstruction("de")}\n`)).toBe("");
  });

  it("tolerates CRLF line endings and trailing whitespace", () => {
    const body = "# Rules\r\n\r\nBe kind.";
    const appended = `${body}\r\n\r\n---\r\n\r\n${buildLanguageInstruction("ko")}  \r\n`;
    expect(stripLanguageBlock(appended)).toBe(body);
  });

  it("leaves a body without a block untouched", () => {
    const body = "# Rules\n\n---\n\nSome other closing note.";
    expect(stripLanguageBlock(body)).toBe(body);
  });

  it("leaves the instruction alone when it is not the trailing block", () => {
    const body = `${buildLanguageInstruction("ja")}\n\nMore rules follow.`;
    expect(stripLanguageBlock(body)).toBe(body);
    const quoted = `# Rules\n\n---\n\n${buildLanguageInstruction("ja")}\n\nAnd one more section.`;
    expect(stripLanguageBlock(quoted)).toBe(quoted);
  });

  it("does not strip an instruction that lacks the separator", () => {
    const body = `# Rules\n\n${buildLanguageInstruction("ja")}`;
    expect(stripLanguageBlock(body)).toBe(body);
  });

  it("does not match a different language name", () => {
    const body =
      "# Rules\n\n---\n\nYou must always answer in Klingon. On the other hand, reasoning (thinking) should be in English to improve token efficiency.";
    expect(stripLanguageBlock(body)).toBe(body);
  });

  it("requires the separator to open its line", () => {
    const body = `# Rules\n\nSee ---\n\n${buildLanguageInstruction("ja")}`;
    expect(stripLanguageBlock(body)).toBe(body);
    const longerRule = `# Rules\n\n-----\n\n${buildLanguageInstruction("ja")}`;
    expect(stripLanguageBlock(longerRule)).toBe(longerRule);
  });

  it("strips a block whose separator line is indented", () => {
    const body = `# Rules\n\n  ---  \n\n  ${buildLanguageInstruction("ja")}`;
    expect(stripLanguageBlock(body)).toBe("# Rules");
  });

  it("strips two stacked blocks, not just the last one", () => {
    const body = "# Rules\n\nBe kind.";
    const once = appendLanguageBlock({ content: body, language: "ja" });
    const twice = appendLanguageBlock({ content: once, language: "fr" });
    expect(stripLanguageBlock(twice)).toBe(body);
    expect(stripLanguageBlock(`${twice}\n\n---\n\n${buildLanguageInstruction("de")}\n`)).toBe(body);
  });

  it("strips a stacked block down to an empty body", () => {
    const stacked = appendLanguageBlock({
      content: buildLanguageInstruction("ja"),
      language: "en",
    });
    expect(stripLanguageBlock(stacked)).toBe("");
  });

  it("handles a body padded with 200,000 trailing blank lines in linear time", () => {
    const padding = "\n".repeat(200_000);
    const body = "# Rules\n\nBe kind.";
    const appended = appendLanguageBlock({ content: body, language: "ja" });
    const startedAt = performance.now();
    expect(stripLanguageBlock(`${body}${padding}`)).toBe(`${body}${padding}`);
    expect(stripLanguageBlock(`${appended}${padding}`)).toBe(body);
    expect(stripLanguageBlock(`${body}\n\n---${padding}${buildLanguageInstruction("ja")}`)).toBe(
      body,
    );
    expect(stripLanguageBlock(`${body}${padding}---\n\nNot the instruction.`)).toBe(
      `${body}${padding}---\n\nNot the instruction.`,
    );
    expect(performance.now() - startedAt).toBeLessThan(1000);
  });
});
