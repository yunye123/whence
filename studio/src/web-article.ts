/**
 * Readable article text for a pasted web page.
 *
 * Parsing uses `@mozilla/readability` (Apache-2.0) as a dependency. Its license
 * stays Apache-2.0; this file does not relicense it and does not vendor its source.
 * The DOM is linkedom. HTML becomes Markdown with the turndown already used for export.
 */
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

const MAX_BODY = 300_000;

export interface WebArticle {
  title: string;
  body: string;
}

/**
 * Readability's own meaningful-content bar. Below it the library marks the grab
 * unsuccessful and only returns its longest leftover fragment. That fragment is
 * not an article here: a title-only homepage stays a link.
 */
const MEANINGFUL_ARTICLE = 500;

/** Article title and Markdown, or null when Readability finds no article or the text is empty. */
export function extractWebArticle(html: string, url: string): WebArticle | null {
  try {
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as Document).parse();
    if (!article?.content || (article.length ?? 0) < MEANINGFUL_ARTICLE) return null;
    const turndown = new TurndownService();
    turndown.remove(node => ['IMG', 'PICTURE', 'SVG', 'VIDEO', 'IFRAME', 'SCRIPT', 'STYLE'].includes(node.nodeName));
    const body = turndown.turndown(article.content).replace(/!\[[^\]]*]\([^)]*\)/g, '').replace(/\u0000/g, '').trim().slice(0, MAX_BODY);
    if (!body) return null;
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = ''; }
    const title = (article.title || '').replace(/\u0000/g, '').trim().slice(0, 500) || host;
    return { title, body };
  } catch {
    return null;
  }
}
