import type { CardOverviewProps } from './types';

export function ImageOverview({ media, title }: CardOverviewProps) {
  const { source, poster, mediaError, loadingMedia, setMediaError } = media;
  const picture = !mediaError ? source || poster : undefined;
  const onError = () => setMediaError(true);
  return (
    <div className={`field-card__overview field-card__overview--image card-drag${picture ? ' has-picture' : ''}`} data-photo-preview={picture ? 'picture' : loadingMedia ? 'loading' : 'missing'} aria-hidden="true">
      {picture && <img src={picture} alt="" draggable={false} onError={onError} />}
      <div className="field-card__overview-content">
        <h3 className={picture ? 'sr-only' : undefined}>{picture ? title : loadingMedia ? `正在读取图片：${title}` : `图片未找到：${title}`}</h3>
      </div>
    </div>
  );
}
