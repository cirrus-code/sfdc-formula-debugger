/** 1-based line/column for a source offset, for displaying diagnostics. */
export function offsetToLineCol(
  source: string,
  offset: number,
): { line: number; col: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(offset, source.length);
  for (let i = 0; i < end; i++) {
    if (source[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: end - lineStart + 1 };
}
