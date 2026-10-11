import type { Dispatch, SetStateAction } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { CardData } from '../model';
import { useBoard } from '../board-context';
import { usesSeparateSourceUrl } from '../media-source';
import { safeWebUrl } from './shared';
import type { PatchCard } from './shared';

/** Source link for link, image and video cards. Only http(s) URLs are saved. */
export default function SourceUrlField({ data, sourceUrl, urlInput, setUrlInput, urlError, setUrlError, importBusy, patch }: {
  data: CardData;
  sourceUrl?: string;
  urlInput: string;
  setUrlInput: Dispatch<SetStateAction<string>>;
  urlError: string;
  setUrlError: Dispatch<SetStateAction<string>>;
  importBusy: boolean;
  patch: PatchCard;
}) {
  const board = useBoard();
  const usesSourceUrl = usesSeparateSourceUrl(data);
  const commitUrl = () => {
    if (importBusy) return;
    if (!urlInput.trim()) { patch(usesSourceUrl ? { sourceUrl: '' } : { url: '' }); setUrlError(''); return; }
    const url = safeWebUrl(urlInput);
    if (!url) { setUrlError('请输入以 https:// 或 http:// 开头的完整链接。'); return; }
    patch(usesSourceUrl ? { sourceUrl: url } : { url }); setUrlInput(url); setUrlError('');
  };
  return <section className="inspector-section inspector-url-section">
    <label className="inspector-field-label" htmlFor="source-url">来源链接</label>
    <div className="inspector-url-row">
      <input
        id="source-url"
        className="input"
        type="url"
        lang="en"
        value={urlInput}
        readOnly={importBusy || board.readOnly}
        onChange={event => { setUrlInput(event.target.value); setUrlError(''); }}
        onBlur={commitUrl}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { commitUrl(); event.currentTarget.blur(); } }}
        placeholder="https://"
        aria-invalid={!!urlError}
        aria-describedby={urlError ? 'source-url-error' : undefined}
      />
      {sourceUrl && <a className="icon-btn" href={sourceUrl} target="_blank" rel="noopener noreferrer" title="打开来源链接" aria-label="打开来源链接"><ArrowUpRight size={16} aria-hidden="true" /></a>}
    </div>
    {urlError && <p id="source-url-error" className="inspector-field-error" role="alert">{urlError}</p>}
  </section>;
}
