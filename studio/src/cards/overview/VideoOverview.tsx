import { Words } from '../Words';
import { useContext } from 'react';
import { CardContext } from '../../board-context';
import { cardExtras } from '../types';
import { videoExcerptBands } from '../VideoCardBody';
import type { CardOverviewProps } from './types';

export function VideoOverview({ id, data, media, title, playing }: CardOverviewProps) {
  const board = useContext(CardContext);
  const marks = id && board ? cardExtras(board).excerptMarks?.(id) ?? [] : [];
  const duration = Math.max(data.duration ?? 0, data.transcript?.at(-1)?.end ?? 0, ...marks.map(mark => mark.end ?? 0));
  const bands = videoExcerptBands(duration, marks);
  const picture = media.poster;
  const onError = () => media.setPosterError(true);
  return (
    <div className={`field-card__overview field-card__overview--video card-drag${picture ? ' has-picture' : ''}`} aria-hidden="true">
      <div className="field-card__overview-picture">{picture && <img src={picture} alt="" draggable={false} onError={onError} />}</div>
      {playing ? <span className="field-card__overview-live" /> : <span className="field-card__overview-play" />}
      <div className="field-card__overview-content">
        <Words as="h3" text={title} />
        <div className="field-card__rail field-card__overview-rail">{bands.map(band => <span key={band.key} className="field-card__rail-band is-marked" data-edge-anchor="excerpt-row" data-quote-id={band.quoteId} style={{ left: `${band.left}%`, width: `${band.width}%` }} />)}</div>
      </div>
    </div>
  );
}
