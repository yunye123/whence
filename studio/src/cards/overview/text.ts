import { plainMarkdown } from '../../source-location';
import { isLatinText } from '../card-utils';

/** Overview text never needs more than what fits on a card at 50%: keep word breaking cheap. */
const TEXT_LIMIT = 220;

/** CJK ideographs, CJK punctuation and full-width forms: a line break between two of them joins without a space. */
const CJK_JOIN = /([　-〿㐀-鿿豈-﫿＀-￯])\s+(?=[　-〿㐀-鿿豈-﫿＀-￯])/g;

/** Plain one-paragraph text for a silhouette (no Markdown marks, no line breaks; “小时。冷青蓝”, not “小时。 冷青蓝”). */
export function overviewText(text: string | undefined, limit = TEXT_LIMIT): string {
  return plainMarkdown(text ?? '').replace(/\s+/g, ' ').replace(CJK_JOIN, '$1').trim().slice(0, limit);
}

/** Latin titles keep their hyphenated words together on one line (“15‑Minute City”, §6.14). */
export function unbreakableHyphens(text: string): string {
  return isLatinText(text) ? text.replace(/(\w)-(?=\w)/g, '$1‑') : text;
}


export { CJK_JOIN };
