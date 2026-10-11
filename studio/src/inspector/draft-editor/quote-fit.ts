/**
 * A quotation block starts with blank lines of its own (formatDraftQuote, K1). When the text before the caret
 * already ends in line breaks, only the missing ones are added, so a quote typed after two Enters does not leave
 * three empty lines above it (INSP-36). At the very start of the text no leading break is kept.
 */
export function fitQuoteToCaret(before: string, text: string): string {
  const leading = /^\n*/.exec(text)![0].length;
  if (!leading) return text;
  const trailing = before.length ? (/(?:[ \t]*\n)*$/.exec(before)![0].match(/\n/g)?.length ?? 0) : leading;
  return text.slice(Math.min(leading, trailing));
}
