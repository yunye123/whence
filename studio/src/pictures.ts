import { pictureMediaId } from './storage';

/** A paragraph whose whole text is one markdown image, in the order it was written. */
export function imageMarkdown(value: string): { alt: string; src: string } | null {
  const match = /^!\[([^\]\n]*)\]\(([^)\s]+)\)$/.exec(value.trim());
  return match ? { alt: match[1], src: match[2] } : null;
}

/** The first picture a card can show: attached pictures, then the first image in the text. */
export function firstCardPicture(data: { pictures?: readonly string[]; body?: string }, getMediaUrl?: (id?: string) => string | undefined): string | undefined {
  for (const item of data.pictures || []) {
    const src = pictureSource(item, getMediaUrl);
    if (src) return src;
  }
  const match = /!\[[^\]\n]*\]\(([^)\s]+)\)/.exec(data.body || '');
  return match ? pictureSource(match[1], getMediaUrl) : undefined;
}

/** Turn a stored picture reference into something an img tag can load. */
export function pictureSource(src: string, getMediaUrl?: (id?: string) => string | undefined): string | undefined {
  const id = pictureMediaId(src);
  if (id) return getMediaUrl?.(id);
  if (/^https?:\/\//i.test(src) || src.startsWith('/') || src.startsWith('media://') || src.startsWith('field-media://')) return src;
  return undefined;
}
