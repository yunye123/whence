import { isXUrl, recognizableVideo, sharedLinks } from './video-links';

/** Prose left after every pasted URL is removed. Empty when the paste was only links. */
export function textBesideLinks(text: string, urls: readonly string[]): string {
  let rest = text;
  for (const url of [...new Set(urls)].sort((a, b) => b.length - a.length)) {
    if (url) rest = rest.split(url).join('\n');
  }
  return rest.trim();
}

/** One reading of a paste: X is handled whole, videos and ordinary pages are separate, leftover prose is a note. */
export function pastedMaterial(text: string): { x: boolean; videos: string[]; pages: string[]; note: string } {
  const urls = sharedLinks(text);
  return {
    x: urls.some(isXUrl),
    videos: urls.filter(recognizableVideo),
    pages: urls.filter(url => !recognizableVideo(url) && !isXUrl(url)),
    note: textBesideLinks(text, urls),
  };
}
