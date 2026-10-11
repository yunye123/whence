import type { Dispatch, SetStateAction } from 'react';
import { Expand, Image as ImageIcon, LoaderCircle, RotateCcw } from 'lucide-react';
import type { CardData } from '../model';
import { useBoard } from '../board-context';
import type { ImageSize, MediaStatus } from './shared';

/** Image card preview; opening it shows the original in ImagePreviewDialog. */
export default function ImageSourcePanel({
  data, imageUrl, imageSize, setImageSize, mediaError, setMediaError, mediaStatus, mediaLoading, mediaUnavailable, retryMedia, onOpen,
}: {
  data: CardData;
  imageUrl?: string;
  imageSize: ImageSize | null;
  setImageSize: Dispatch<SetStateAction<ImageSize | null>>;
  mediaError: boolean;
  setMediaError: Dispatch<SetStateAction<boolean>>;
  mediaStatus: MediaStatus;
  mediaLoading: boolean;
  mediaUnavailable: boolean;
  retryMedia: () => void;
  onOpen: () => void;
}) {
  const board = useBoard();
  return <div className={`inspector-image-preview${imageSize && imageSize.height > imageSize.width * 1.25 ? ' inspector-image-preview--portrait' : ''}`}>
    {imageUrl && !mediaError ? <button type="button" className="inspector-image-open" aria-label="查看原图" onClick={onOpen}>
      <img
        src={imageUrl}
        alt={data.title || '图片'}
        onLoad={event => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        onError={() => setMediaError(true)}
      />
      <span>
        <Expand size={14} />查看原图
        {imageSize && <small>{imageSize.width.toLocaleString('zh-CN')} × {imageSize.height.toLocaleString('zh-CN')}</small>}
      </span>
    </button> : <div className="inspector-media-empty">
      {mediaLoading ? <LoaderCircle size={28} className="inspector-is-processing" /> : <ImageIcon size={28} />}
      <strong>
        {mediaLoading ? '正在读取图片'
          : mediaStatus === 'missing' ? '图片文件未找到'
            : mediaStatus === 'error' ? '图片文件读取失败'
              : mediaError ? '这张图片无法显示'
                : data.mediaId ? '这张图片暂时不可用' : '这张卡片还没有图片'}
      </strong>
      <span>
        {mediaLoading ? '图片就绪后会显示在这里。'
          : mediaError || mediaUnavailable || data.mediaId ? '画面笔记与来源仍保留。可以重新读取、检查来源链接或重新导入原图。'
            : '在“来源链接”里粘贴图片地址，或把本机图片拖到画布上。'}
      </span>
      {(mediaError || mediaUnavailable) && data.mediaId && board.retryMedia && <button type="button" className="inspector-small-button" onClick={retryMedia}>
        <RotateCcw size={13} />重新读取
      </button>}
    </div>}
  </div>;
}
