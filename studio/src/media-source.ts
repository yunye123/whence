import type { CardData } from './model';
import { safeUrl } from './board-utils';
import { isSampleAsset } from './templates';

export function usesSeparateSourceUrl(data: CardData): boolean {
  // A shipped example film is playable media, not the original source link (EXAMPLE_CONTENT §8.2).
  return isSampleAsset(data.url) || !!data.nativeAssetId || /^(?:media|field-media):\/\//.test(data.url ?? '') || !!data.videoImport || !!data.mediaId && (data.kind === 'video' || data.kind === 'image');
}

/** An empty sourceUrl records the user's explicit removal, including after restart. */
export function getSourceUrl(data: CardData): string {
  return usesSeparateSourceUrl(data) ? data.sourceUrl ?? data.videoImport?.url ?? (data.url ? safeUrl(data.url) : null) ?? '' : data.url ?? '';
}

/** Apply a finished local task to current edits, never to its stale starting card. */
export function mergePastedVideoMedia(current: CardData, material: Partial<CardData>): CardData {
  const fields = ['url', 'poster', 'duration', 'nativeAssetId', 'nativeProjectId', 'nativeDirectory', 'nativeTranscriptId', 'nativeHasAudio', 'nativeCapture', 'nativeMediaWarning'] as const;
  const media = Object.fromEntries(fields.flatMap(key => material[key] === undefined ? [] : [[key, material[key]]]));
  if (current.url?.startsWith('field-media://')) delete media.url;
  if (current.poster) delete media.poster;
  return { ...current, ...media, sourceUrl: getSourceUrl(current) };
}
