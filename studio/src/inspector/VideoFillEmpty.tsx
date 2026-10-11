import { useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import { Film, FolderOpen, Link2, LoaderCircle } from 'lucide-react';
import type { CardData } from '../model';
import { cardLabels, uid } from '../model';
import { DEFAULT_TITLES } from '../board-utils';
import { useBoard } from '../board-context';
import { removeMedia, saveMedia } from '../storage';
import { isXUrl, sharedLinks } from '../app/video-links';
import { readVideoPreview } from '../app/local-media';
import { directVideoUrl } from './shared';
import type { PatchCard } from './shared';
import { Words } from '../cards/Words';

const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime,video/ogg,video/x-m4v,.mp4,.m4v,.mov,.webm,.ogv';
const isVideoFile = (file: File) => file.type ? file.type.startsWith('video/') : /\.(mp4|m4v|mov|webm|ogv)$/i.test(file.name);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * The player of a video card that has no film yet — a template slot or a new card (FV-M5). It fills this same card:
 * choose a local film, drop one on the player, or paste a link (the desktop app downloads it into this card; the
 * browser keeps it as the card's source and says what the desktop app adds). Importing subtitles stays in the
 * transcript column next to it.
 */
export default function VideoFillEmpty({ nodeId, data, sourceUrl, patch, onNotify }: {
  nodeId: string;
  data: CardData;
  sourceUrl?: string;
  patch: PatchCard;
  onNotify: (message: string) => void;
}) {
  const board = useBoard();
  const fileInput = useRef<HTMLInputElement>(null);
  const linkButton = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkError, setLinkError] = useState('');
  const [dropping, setDropping] = useState(false);
  const desktop = board.videoImportAvailable;

  const fill = async (file: File | undefined) => {
    if (!file || saving || board.readOnly) return;
    if (!isVideoFile(file)) { onNotify('请选择 MP4、WebM 或 MOV 视频文件'); return; }
    setSaving(true);
    try {
      const media = await saveMedia(file, file.name);
      const name = file.name.replace(/\.[^.]+$/, '');
      // A slot keeps a title the person gave it; the generic “视频” gives way to the file name.
      const titled = !!data.title.trim() && data.title !== cardLabels.video && data.title !== DEFAULT_TITLES.video;
      // The same poster frame and running time an imported film gets (FV-M7), so the filled card reads as a film at rest.
      const preview = await readVideoPreview(file);
      if (!patch({ mediaId: media.id, ...(titled ? {} : { title: name }), ...(preview.poster ? { poster: preview.poster } : {}), ...(preview.duration ? { duration: preview.duration } : {}) })) {
        await removeMedia(media.id).catch(() => {});
        onNotify('视频还没有放进这张卡，请检查保存状态后重试');
        return;
      }
      onNotify(`已把“${name}”放进这张卡`);
    } catch (error) { onNotify(`视频没有添加：${message(error)}`); }
    finally { setSaving(false); }
  };

  const closeLink = (refocus: boolean) => {
    setLinkOpen(false); setLinkText(''); setLinkError('');
    if (refocus) requestAnimationFrame(() => linkButton.current?.focus({ preventScroll: true }));
  };
  const submitLink = (event: FormEvent) => {
    event.preventDefault();
    if (board.readOnly) return;
    const url = sharedLinks(linkText)[0];
    if (!url) { setLinkError('没有找到完整的 http 或 https 链接。可以直接粘贴平台的分享文案。'); return; }
    const direct = directVideoUrl(url);
    if (direct) {
      if (patch({ url: direct })) { closeLink(false); onNotify('已添加视频地址，可以直接播放'); }
      return;
    }
    if (desktop && !isXUrl(url)) {
      // Same task the import dialog creates, attached to this card; retry starts it (queue, save, download).
      const now = new Date().toISOString();
      const text = linkText.trim().slice(0, 20000);
      const started = patch({
        sourceUrl: url, sourceOriginalText: text,
        videoImport: { attemptId: uid(), url, originalText: text, status: 'interrupted', message: '准备下载这段视频', mediaReady: false, createdAt: now, updatedAt: now },
      });
      if (!started) return;
      board.retryVideoImport(nodeId);
      closeLink(false);
      onNotify('开始下载这段视频，逐字稿会在后台准备');
      return;
    }
    if (patch({ url })) {
      closeLink(true);
      onNotify(desktop ? '链接已存为这张卡的来源' : '链接已存为这张卡的来源。自动下载和逐字稿需要来处桌面版');
    }
  };

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  const hintId = `${nodeId}-video-link-hint`;
  return <div
    className={`inspector-media-empty watch-fill${dropping ? ' is-dropping' : ''}`}
    onDragOver={event => { if (!hasFiles(event) || saving) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropping(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false); }}
    onDrop={event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDropping(false);
      const files = [...event.dataTransfer.files];
      void fill(files.find(isVideoFile) ?? files[0]);
    }}
  >
    {saving ? <LoaderCircle size={24} className="inspector-is-processing" aria-hidden="true" /> : <Film size={24} aria-hidden="true" />}
    <strong>{saving ? '正在放入视频' : dropping ? '松开即可放进这张卡' : sourceUrl ? '已存下这条视频的链接' : '这张卡还没有视频'}</strong>
    <Words text={sourceUrl && !desktop ? '原视频可以从上方“打开原视频”查看；下载和逐字稿需要来处桌面版。也可以选择本机视频放进这张卡。'
      : desktop ? '选择本机视频，或粘贴视频链接下载到这张卡；也可以把视频文件拖到这里。' : '选择本机视频放进这张卡，也可以把视频文件拖到这里。'} />
    {linkOpen ? <form className="watch-fill__link" onSubmit={submitLink}>
      <input
        className="input"
        type="text"
        inputMode="url"
        lang="en"
        autoFocus
        value={linkText}
        onChange={event => { setLinkText(event.target.value); setLinkError(''); }}
        onKeyDown={event => {
          if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          closeLink(true);
        }}
        placeholder="粘贴视频链接或分享文案"
        aria-label="视频链接"
        aria-invalid={!!linkError}
        aria-describedby={hintId}
      />
      <button type="submit" className="btn btn--sm btn--soft">保存链接</button>
      <button type="button" className="btn btn--sm" onClick={() => closeLink(true)}>取消</button>
    </form> : <div className="watch-fill__actions">
      <button type="button" className="btn btn--soft" disabled={saving} onClick={() => fileInput.current?.click()}><FolderOpen size={15} aria-hidden="true" />选择本机视频</button>
      <button ref={linkButton} type="button" className="btn btn--line" disabled={saving} onClick={() => setLinkOpen(true)}><Link2 size={15} aria-hidden="true" />粘贴视频链接</button>
    </div>}
    {linkOpen && <p id={hintId} className={`watch-fill__hint${linkError ? ' is-error' : ''}`} role={linkError ? 'alert' : undefined}>
      {linkError || (desktop
        ? '平台链接会下载到这张卡，逐字稿在后台准备。'
        : '浏览器版会把平台链接存为这张卡的来源，随时可以打开原视频；下载和逐字稿需要来处桌面版。以 .mp4 或 .webm 结尾的视频地址可以直接播放。')}
    </p>}
    <input ref={fileInput} type="file" accept={VIDEO_ACCEPT} hidden aria-label="选择本机视频文件" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void fill(file); }} />
  </div>;
}
