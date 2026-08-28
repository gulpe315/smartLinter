/** Shared sentence/TU boundary contract. Offsets use JavaScript UTF-16 code units. */
export interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

/**
 * Splits at newlines, or at `.`, `!`, `?`, and `…` when followed by whitespace
 * or the end of text. Terminators remain with their sentence; `。` is excluded
 * until Japanese document support is explicitly added.
 */
export function splitIntoSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  let segmentStart = 0;

  const pushTrimmed = (end: number) => {
    let start = segmentStart;
    let trimmedEnd = end;
    while (start < trimmedEnd && /\s/.test(text[start])) start += 1;
    while (trimmedEnd > start && /\s/.test(text[trimmedEnd - 1])) trimmedEnd -= 1;
    if (start < trimmedEnd) spans.push({ text: text.slice(start, trimmedEnd), start, end: trimmedEnd });
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const isNewline = char === '\n';
    const isSoftBreak = /[.!?\u2026]/.test(char)
      && (index + 1 === text.length || /\s/.test(text[index + 1]));
    if (isNewline || isSoftBreak) {
      pushTrimmed(isNewline ? index : index + 1);
      segmentStart = index + 1;
    }
  }
  pushTrimmed(text.length);
  return spans;
}

export function sentenceCount(text: string): number {
  return splitIntoSentences(text).length;
}
