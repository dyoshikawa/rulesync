/**
 * Replace the content between `<!-- MARKER:BEGIN -->` / `<!-- MARKER:END -->`
 * comments with a generated body. Shared by the marker-based table generators
 * (supported-tools tables, hook-event matrix).
 */
export const replaceBetweenMarkers = (content: string, marker: string, body: string): string => {
  const begin = `<!-- ${marker}:BEGIN -->`;
  const end = `<!-- ${marker}:END -->`;
  const startIdx = content.indexOf(begin);
  const endIdx = content.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error(`Markers ${marker} not found; add ${begin} / ${end} around the table.`);
  }
  return `${content.slice(0, startIdx + begin.length)}\n${body}\n${content.slice(endIdx)}`;
};
