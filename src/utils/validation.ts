/**
 * Shared validation utilities for input sanitization.
 */

/**
 * Find the first control character in a string.
 * Returns the position and hex code, or null if none found.
 * Control characters: 0x00-0x1f and 0x7f (DEL).
 */
export function findControlCharacter(value: string): { position: number; hex: string } | null {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) {
      return { position: i, hex: `0x${code.toString(16).padStart(2, "0")}` };
    }
  }
  return null;
}

/**
 * Check whether a string contains any control characters.
 */
export function hasControlCharacters(value: string): boolean {
  return findControlCharacter(value) !== null;
}
