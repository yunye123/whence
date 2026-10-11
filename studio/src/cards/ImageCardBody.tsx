import { useState, type CSSProperties } from 'react';
import { Image as ImageGlyph, LoaderCircle, Maximize2 } from 'lucide-react';
import { MediaProblem, mediaProblem, mediaProblemKind } from './MediaProblem';
import type { CardBodyProps, CardMedia } from './types';
import { knownImageRatio, rememberImageRatio } from '../card-placement';

const clampRatio = (ratio: number) => Math.min(4, Math.max(.25, ratio));

/**
 * Image card (§6.15): the picture is the card — no mount, no title bar, no resting shadow, its own ratio.
 * A card without a stored height follows the picture's natural ratio (clamped 0.25–4); a resized card
 * keeps its box and covers it. The shell's existing header is the conditional outside caption; the expand action a
 * 28px button in the top-right corner.
 */
export function ImageCardBody({ id, data, board, activate, openCard, media }: CardBodyProps & { media: CardMedia }) {
  const { source, poster, mediaError, loadingMedia, unavailableMedia, setMediaError } = media;
  // Retain natural geometry over viewport culling without reading DOM layout on mount.
  const ratioKey = data.mediaId ? `media:${data.mediaId}` : data.url || data.poster;
  const [learned, setLearned] = useState<{ key?: string; ratio: number }>();
  const cached = knownImageRatio({ id, type: 'card', position: { x: 0, y: 0 }, data });
  const ratio = learned?.key === ratioKey ? learned?.ratio ?? cached : cached;
  const url = source || poster;
  // A picture that is missing, unreadable or cannot be decoded says which, once, with the one useful action (CORE-08).
  const problem = unavailableMedia || mediaError
    ? mediaProblemKind(mediaError, data.mediaId ? board.getMediaStatus?.(data.mediaId) : undefined) ?? 'undecodable'
    : undefined;
  const copy = problem && mediaProblem('image', problem, id, data, board, openCard, () => setMediaError(false));
  const expandAction = problem ? '检查素材' : loadingMedia ? '查看读取状态' : '查看原图';
  const style = ratio ? { '--image-ratio': String(ratio) } as CSSProperties : undefined;

  return (
    <div className={`field-card__image-button card-drag-content${url && !mediaError ? '' : ' is-empty'}`} style={style}>
      {url && !mediaError ? (
        <img
          src={url}
          alt={data.title}
          draggable={false}
          onLoad={event => {
            const image = event.currentTarget;
            if (image.naturalWidth && image.naturalHeight) {
              if (ratioKey) rememberImageRatio(ratioKey, image.naturalWidth, image.naturalHeight);
              setLearned({ key: ratioKey, ratio: clampRatio(image.naturalWidth / image.naturalHeight) });
            }
          }}
          onError={() => setMediaError(true)}
        />
      ) : copy ? (
        <MediaProblem message={copy.message} detail={copy.detail} action={copy.action} activate={activate} />
      ) : (
        <div className="field-card__media-placeholder">
          {loadingMedia
            ? <LoaderCircle size={22} strokeWidth={1.6} className="spin" aria-hidden="true" />
            : <ImageGlyph size={22} strokeWidth={1.5} aria-hidden="true" />}
          <span>{loadingMedia ? '正在读取图片' : '还没有图片'}</span>
        </div>
      )}
      {/* When the problem's own action already opens the details, a second “检查素材” would say it twice. */}
      {copy?.action?.kind !== 'inspect' && <button
        className="field-card__image-expand nodrag nowheel"
        onClick={event => activate(event, openCard)}
        aria-label={`${expandAction}：${data.title}`}
        title={expandAction}
      >
        <Maximize2 size={14} aria-hidden="true" />
      </button>}
    </div>
  );
}
