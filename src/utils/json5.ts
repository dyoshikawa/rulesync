/**
 * A small, dependency-free reader for JSON5 documents (https://spec.json5.org/).
 *
 * OpenClaw keeps its Gateway config (`~/.openclaw/openclaw.json`) in JSON5 and
 * its own examples use unquoted keys, single-quoted strings and comments, none
 * of which `jsonc-parser` accepts. Only reading is needed: strict JSON is valid
 * JSON5, so writers emit JSON.
 *
 * Supported: `//` and `/* *\/` comments, unquoted identifier keys, single- and
 * double-quoted strings with every JSON5 escape (including line
 * continuations), trailing commas, hexadecimal numbers, leading or trailing
 * decimal points, an explicit `+` sign, and `Infinity` / `NaN`.
 *
 * Every object is built with own properties only (a `__proto__` key becomes an
 * ordinary own property instead of replacing the prototype), duplicate keys
 * keep the last value like `JSON.parse`, and nesting is capped at
 * {@link MAX_JSON5_DEPTH} so a hostile file fails with a clear error instead of
 * overflowing the stack.
 */

export const MAX_JSON5_DEPTH = 256;

const SINGLE_CHAR_ESCAPES: Readonly<Record<string, string>> = {
  "'": "'",
  '"': '"',
  "\\": "\\",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

const LINE_TERMINATORS = new Set(["\n", "\r", "\u2028", "\u2029"]);

const ID_START = /[\p{L}\p{Nl}$_]/u;
const ID_CONTINUE = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$_\u200C\u200D]/u;
const WHITESPACE = /[\t\n\v\f\r \u00A0\u2028\u2029\uFEFF\p{Zs}]/u;

class Json5Reader {
  private pos = 0;

  constructor(private readonly text: string) {}

  parse(): unknown {
    this.skipTrivia();
    const value = this.readValue(0);
    this.skipTrivia();
    if (this.pos < this.text.length) {
      this.fail(`unexpected ${this.describe()} after the end of the document`);
    }
    return value;
  }

  private fail(message: string): never {
    let line = 1;
    let column = 1;
    for (let i = 0; i < this.pos && i < this.text.length; i++) {
      if (this.text[i] === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    throw new SyntaxError(`JSON5: ${message} at line ${line}, column ${column}`);
  }

  private describe(): string {
    const char = this.text[this.pos];
    return char === undefined ? "end of input" : `character ${JSON.stringify(char)}`;
  }

  private peek(offset = 0): string | undefined {
    return this.text[this.pos + offset];
  }

  private skipTrivia(): void {
    while (this.pos < this.text.length) {
      const char = this.text[this.pos]!;
      if (WHITESPACE.test(char)) {
        this.pos++;
      } else if (char === "/" && this.peek(1) === "/") {
        this.pos += 2;
        while (this.pos < this.text.length && !LINE_TERMINATORS.has(this.text[this.pos]!)) {
          this.pos++;
        }
      } else if (char === "/" && this.peek(1) === "*") {
        const end = this.text.indexOf("*/", this.pos + 2);
        if (end === -1) {
          this.fail("unterminated block comment");
        }
        this.pos = end + 2;
      } else {
        return;
      }
    }
  }

  private readValue(depth: number): unknown {
    const char = this.peek();
    if (char === "{" || char === "[") {
      if (depth >= MAX_JSON5_DEPTH) {
        this.fail(`document nests deeper than ${MAX_JSON5_DEPTH} levels`);
      }
      return char === "{" ? this.readObject(depth + 1) : this.readArray(depth + 1);
    }
    if (char === '"' || char === "'") {
      return this.readString();
    }
    if (char !== undefined && /[0-9+\-.IN]/.test(char)) {
      return this.readNumber();
    }
    for (const [literal, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (this.text.startsWith(literal, this.pos) && !this.isIdContinueAt(literal.length)) {
        this.pos += literal.length;
        return value;
      }
    }
    return this.fail(`unexpected ${this.describe()}`);
  }

  private isIdContinueAt(offset: number): boolean {
    const char = this.peek(offset);
    return char !== undefined && (ID_CONTINUE.test(char) || char === "\\");
  }

  private readObject(depth: number): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    this.pos++; // {
    this.skipTrivia();
    while (this.peek() !== "}") {
      const key = this.readKey();
      this.skipTrivia();
      if (this.peek() !== ":") {
        this.fail(`expected ':' after the key ${JSON.stringify(key)}`);
      }
      this.pos++;
      this.skipTrivia();
      const value = this.readValue(depth);
      // defineProperty, not assignment: `result["__proto__"] = value` would
      // swap the object's prototype instead of recording the key.
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      this.skipTrivia();
      if (this.peek() === ",") {
        this.pos++;
        this.skipTrivia();
        continue;
      }
      if (this.peek() !== "}") {
        this.fail(`expected ',' or '}' but found ${this.describe()}`);
      }
    }
    this.pos++; // }
    return result;
  }

  private readArray(depth: number): unknown[] {
    const result: unknown[] = [];
    this.pos++; // [
    this.skipTrivia();
    while (this.peek() !== "]") {
      result.push(this.readValue(depth));
      this.skipTrivia();
      if (this.peek() === ",") {
        this.pos++;
        this.skipTrivia();
        continue;
      }
      if (this.peek() !== "]") {
        this.fail(`expected ',' or ']' but found ${this.describe()}`);
      }
    }
    this.pos++; // ]
    return result;
  }

  private readKey(): string {
    const char = this.peek();
    if (char === '"' || char === "'") {
      return this.readString();
    }
    let key = "";
    while (this.pos < this.text.length) {
      const start = this.pos;
      let next = this.peek()!;
      if (next === "\\") {
        if (this.peek(1) !== "u") {
          this.fail("expected a \\u escape in an identifier key");
        }
        this.pos += 2;
        next = this.readHex(4);
      } else {
        this.pos++;
      }
      const allowed = key === "" ? ID_START.test(next) : ID_CONTINUE.test(next);
      if (!allowed) {
        this.pos = start;
        break;
      }
      key += next;
    }
    if (key === "") {
      this.fail(`expected a key but found ${this.describe()}`);
    }
    return key;
  }

  /** Reads `length` hex digits at the cursor and returns the character they encode. */
  private readHex(length: number): string {
    const digits = this.text.slice(this.pos, this.pos + length);
    if (digits.length !== length || !/^[0-9a-fA-F]+$/.test(digits)) {
      this.fail(`expected ${length} hexadecimal digits`);
    }
    this.pos += length;
    return String.fromCharCode(Number.parseInt(digits, 16));
  }

  private readString(): string {
    const quote = this.peek()!;
    this.pos++;
    let result = "";
    while (true) {
      const char = this.peek();
      if (char === undefined) {
        this.fail("unterminated string");
      }
      if (char === quote) {
        this.pos++;
        return result;
      }
      if (char === "\n" || char === "\r") {
        this.fail("unescaped line break in a string");
      }
      if (char !== "\\") {
        result += char;
        this.pos++;
        continue;
      }
      this.pos++;
      const escape = this.peek();
      if (escape === undefined) {
        this.fail("unterminated string");
      }
      if (escape === "\r") {
        // Line continuation; CRLF counts as one terminator.
        this.pos += this.peek(1) === "\n" ? 2 : 1;
      } else if (LINE_TERMINATORS.has(escape)) {
        this.pos++;
      } else if (escape === "x") {
        this.pos++;
        result += this.readHex(2);
      } else if (escape === "u") {
        this.pos++;
        result += this.readHex(4);
      } else if (escape === "0") {
        if (/[0-9]/.test(this.peek(1) ?? "")) {
          this.fail("octal escapes are not allowed");
        }
        result += "\0";
        this.pos++;
      } else if (/[1-9]/.test(escape)) {
        this.fail("octal escapes are not allowed");
      } else {
        result += SINGLE_CHAR_ESCAPES[escape] ?? escape;
        this.pos++;
      }
    }
  }

  private readNumber(): number {
    const start = this.pos;
    let sign = 1;
    if (this.peek() === "+" || this.peek() === "-") {
      sign = this.peek() === "-" ? -1 : 1;
      this.pos++;
    }
    for (const [literal, value] of [
      ["Infinity", Infinity],
      ["NaN", NaN],
    ] as const) {
      if (this.text.startsWith(literal, this.pos)) {
        if (this.isIdContinueAt(literal.length)) break;
        this.pos += literal.length;
        return sign * value;
      }
    }
    if (this.peek() === "0" && (this.peek(1) === "x" || this.peek(1) === "X")) {
      this.pos += 2;
      const digits = /^[0-9a-fA-F]+/.exec(this.text.slice(this.pos))?.[0];
      if (digits === undefined) {
        this.fail("expected hexadecimal digits");
      }
      this.pos += digits.length;
      return sign * Number.parseInt(digits, 16);
    }
    const match = /^(?:(?:0|[1-9][0-9]*)(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(
      this.text.slice(this.pos),
    );
    if (match === null) {
      this.pos = start;
      this.fail(`invalid number`);
    }
    this.pos += match[0].length;
    if (this.isIdContinueAt(0)) {
      this.fail(`invalid number`);
    }
    return sign * Number(match[0]);
  }
}

/**
 * Parse a JSON5 document. Throws a `SyntaxError` naming the line and column of
 * the first problem.
 */
export function parseJson5(text: string): unknown {
  return new Json5Reader(text).parse();
}
