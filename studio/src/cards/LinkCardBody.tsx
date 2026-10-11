import { ExternalLink, Link2 } from 'lucide-react';
import { webLink } from './card-utils';
import { ArticleCardFooter, FolderSourcePreview } from './ArticleCardBody';
import type { CardBodyProps, CardMedia, ExcerptMark } from './types';
const NO_MARKS: readonly ExcerptMark[] = [];

/**
 * Link folder (§6.14): title and URL above verbatim source paragraphs. An optional picture is a print
 * at the top of the sheet; an invalid/missing URL retains the existing edit action.
 */
export function LinkCardBody({ media, marks = NO_MARKS, connectable = false, ...props }: CardBodyProps & { media: CardMedia; marks?: readonly ExcerptMark[]; connectable?: boolean }) {
  const { data, activate, openCard } = props;
  const { poster, setPosterError } = media;
  const link = webLink(data.url);
  return (
    <>
      {poster && (
        <div className="field-card__link-poster card-drag-content">
          <img src={poster} alt="" onError={() => setPosterError(true)} draggable={false} />
        </div>
      )}
      {!link && (
        <div className="field-card__link-content card-drag-content">
          <button className="field-card__text-btn nodrag nowheel" onClick={event => activate(event, openCard)}>
            {data.url ? '链接格式有误，点击修改' : '添加网页链接'}
          </button>
        </div>
      )}
      <FolderSourcePreview {...props} marks={marks} connectable={connectable} />
    </>
  );
}

export function LinkCardFooter({ data }: Pick<CardBodyProps, 'data'>) {
  const link = webLink(data.url);
  return <>
    <ArticleCardFooter data={data} platform="网页" />
    {link && <span className="field-card__meta-source field-card__domain" lang="en"><Link2 className="field-card__link-icon" size={13} aria-hidden="true" /><span className="field-card__link-url">{link.href.replace(/^https?:\/\//, '')}</span></span>}
  </>;
}

/** Hover action: the external link (K4 `打开原始网页`). */
export function LinkCardActions({ data }: Pick<CardBodyProps, 'data'>) {
  const link = webLink(data.url);
  if (!link) return null;
  return (
    <a className="field-card__chip nodrag nowheel" href={link.href} target="_blank" rel="noopener noreferrer" aria-label="打开原始网页" title="打开原始网页">
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}
