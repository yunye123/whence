import type { CardData } from '../model';
import { XLogoIcon } from '../icons/field-icons';
import { useInspectorLayout } from './shared';
import type { XPostView } from './x-post-view';

/**
 * X author/status for link, image and video cards, plus the import-time snapshot of an edited link card.
 * In the reading split it reads as the article byline (§6.18.3): the author in strong ink, “发表在 X”, then the
 * collection status on a quieter second line. Platform names are plain metadata, never a provenance tag (§6.7).
 */
export default function XProvenanceSection({ data, view }: { data: CardData; view: XPostView }) {
  const layout = useInspectorLayout();
  const { xSourceAuthor, xSourceStatus, xPostStatus, xSnapshotEdited } = view;
  const isVideo = data.kind === 'video';
  const status = isVideo ? xPostStatus : xSourceStatus;
  return <section className="inspector-section inspector-x-provenance" aria-label="X 来源信息">
    <div className="inspector-section-heading"><h3><XLogoIcon size={16} />X 来源信息</h3></div>
    {xSourceAuthor && <dl className="inspector-x-author">
      <dt>作者</dt>
      <dd>{xSourceAuthor}</dd>
      {layout === 'reading' && <dd className="inspector-x-where">发表在 X</dd>}
    </dl>}
    {status && <p className="inspector-x-source-status">{status}</p>}
    {xSnapshotEdited && <div className="inspector-x-snapshot">
      <p>正文已有编辑，导入时的推文文字仍保留。</p>
      <details><summary>查看导入时的推文原文</summary><p>{data.sourceOriginalText}</p></details>
    </div>}
  </section>;
}
