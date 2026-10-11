import { useContext, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useStore, type ReactFlowState } from '@xyflow/react';
import type { Board, BoardNode, CardData } from '../model';
import { timecode } from '../model';
import { CardContext } from '../board-context';
import { approxCharacters, articleCharacters } from '../cards/card-utils';
import { frameContainsCard, type CardMeasurements } from '../card-placement';
import { citationLocationLabel, draftCharacterCount, paragraphIndexAt, quoteDisplayTitle } from '../source-location';

/** 侧栏语义筛选（§6.2 第 7 项）：来源（视频、文字资料、链接）、摘录、我写的（文稿与笔记）、图片。 */
export type LibraryFacet = 'all' | 'source' | 'quote' | 'mine' | 'image';
type Facet = Exclude<LibraryFacet, 'all'>;

const FACETS: { id: Facet; label: string }[] = [
  { id: 'source', label: '来源' },
  { id: 'quote', label: '摘录' },
  { id: 'mine', label: '我写的' },
  { id: 'image', label: '图片' },
];
const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const isArticle = (data: CardData) => data.kind === 'note' && !!data.tags?.includes('文字资料');
const isXPost = (data: CardData) => data.kind === 'link' && /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//i.test(data.url ?? data.sourceUrl ?? '');

/** 一张卡片属于哪个筛选；分组不属于任何筛选。 */
export function cardFacet(data: CardData): Facet | null {
  switch (data.kind) {
    case 'video': case 'link': return 'source';
    case 'note': return isArticle(data) ? 'source' : 'mine';
    case 'quote': return 'quote';
    case 'draft': return 'mine';
    case 'image': return 'image';
    default: return null;
  }
}

/** 界面显示名（§8.1；`cardLabels` 是存储值，不在界面露出）。 */
function displayName(data: CardData): string {
  if (isArticle(data)) return '文字资料';
  return ({ video: '视频', image: '图片', note: '笔记', quote: '摘录', draft: '文稿', link: '链接', frame: '分组' } as const)[data.kind];
}

function KindIcon({ data }: { data: CardData }) {
  // These 20×16 stationery silhouettes reproduce mock/desk.css g-* glyphs.
  const jacket = isArticle(data) || data.kind === 'link';
  return <svg width="20" height="16" viewBox="0 0 20 16" fill="none" aria-hidden="true">
    {jacket ? <><path className="library-glyph__jacket" d="M2.5 14.5V2.5h5.2l1.3 1.6h8.5v10.4z"/><rect className="library-glyph__paper" x="4.5" y="6" width="11" height="6.5"/><path className="library-glyph__line" d="M6.5 8.3h7M6.5 10.3h5"/></>
      : data.kind === 'draft' ? <><rect className="library-glyph__manuscript" x="4.5" y=".5" width="11" height="15"/><path className="library-glyph__line" d="M4.5 3.6h11M8 6.5h5.5M8 8.8h5.5M8 11.1h4"/></>
      : data.kind === 'quote' ? <><rect className="library-glyph__paper" x="2.5" y="3.5" width="15" height="9"/><path className="library-glyph__source" d="M2.5 5.9h15"/><path className="library-glyph__line" d="M4.5 8.6h11M4.5 10.8h11"/></>
      : data.kind === 'frame' ? <><path className="library-glyph__wall" d="M2.5 14.5V3.5H4V2h5v1.5h8.5v11z"/><path className="library-glyph__line" d="M4.5 6h5v3.5h-5zM10.8 6h4.7v6.5h-4.7z"/></>
      : data.kind === 'note' ? <><rect className="library-glyph__note" x="4" y="2" width="12" height="12"/><path className="library-glyph__line" d="M4 4.4h12M6.3 8c1.1-.6 2.2.5 3.3 0s2-.5 3.1 0M6.3 10.8c1.1-.6 2.1.4 3.1 0"/></>
      : <><rect className="library-glyph__wall" x="1.5" y="1.5" width="17" height="13"/><path className="library-glyph__line" d={data.kind === 'video' ? 'M8 5l5 3-5 3zM1.5 12h17' : 'M3.5 12l4-4 3 3 2.5-2.5 3.5 3.5'}/></>}
  </svg>;
}

/** 列表右侧的元信息：时长、位置、稿次、篇幅、张数（§6.2 第 8 项）。 */
function itemMeta(node: BoardNode, board: Board, contained: number): string {
  const data = node.data;
  // The same length as the card shows (“约 1,600 字”), from the same function (KN-15).
  if (isArticle(data)) return approxCharacters(articleCharacters(data.body ?? ''));
  switch (data.kind) {
    case 'video': return data.duration ? timecode(data.duration) : '';
    case 'link': return isXPost(data) ? '推文' : '网页';
    case 'quote': {
      const citation = data.citation;
      if (citation?.start !== undefined) return citation.end !== undefined && citation.end > citation.start ? `${timecode(citation.start)}–${timecode(citation.end)}` : timecode(citation.start);
      const source = citation ? board.nodes.find(item => item.id === citation.nodeId) : undefined;
      const paragraph = citation?.textAnchor && source ? paragraphIndexAt(source.data.body, citation.textAnchor.from) : undefined;
      const location = citationLocationLabel(citation, paragraph);
      const sourceTitle = source?.data.title || citation?.title;
      return [location, sourceTitle].filter(Boolean).join(' · ');
    }
    case 'draft': {
      const round = (data.draftVersions?.length ?? 0) + 1;
      if (round > 1) return round <= 10 ? `第${CN_DIGITS[round]}稿` : `第 ${round} 稿`;
      const count = draftCharacterCount(data.body ?? '');
      return count ? approxCharacters(count, 10) : '';
    }
    case 'frame': return contained ? `${contained} 张` : '';
    default: return '';
  }
}

/** 文字摘录的存储默认标题是“摘录 · <来源标题>”（text-sources.ts），也按默认标题处理，显示原句开头（C13）。 */
function itemTitle(data: CardData): string {
  if (data.kind === 'quote') {
    const sourceTitle = data.citation?.title;
    const defaultTextTitle = !!sourceTitle && data.title.startsWith('摘录 · ') && `摘录 · ${sourceTitle}`.startsWith(data.title);
    return quoteDisplayTitle(defaultTextTitle ? { ...data, title: '摘录' } : data);
  }
  return data.title || (data.kind === 'draft' ? '未命名文稿' : displayName(data));
}

function Thumb({ node }: { node: BoardNode }) {
  const card = useContext(CardContext);
  const [failed, setFailed] = useState<string>();
  const data = node.data;
  const src = data.kind === 'video' ? data.poster : data.kind === 'image' ? card?.getMediaUrl(data.mediaId) || data.url || data.poster : undefined;
  if (src && !/^(?:media|field-media):/i.test(src) && src !== failed) return <span className={`library-icon library-thumb ${data.kind}`} aria-hidden="true"><img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(src)} /></span>;
  return <span className={`library-icon ${data.kind}`} aria-hidden="true"><KindIcon data={data} /></span>;
}

export interface MaterialsLibraryProps {
  board: Board;
  selectedIds: string[];
  /** 语义筛选。集成后由 App 持有（同时压暗画布上不属于该类的卡片）；未传时组件自己保存，换画布时复位。 */
  facet?: LibraryFacet;
  onFacet?: (facet: LibraryFacet) => void;
  /** Single click: select the card and bring it into view on the canvas (focus moves to the card, KB-M2). */
  onRevealCard: (id: string) => void;
  /** Double click: open the card in the inspector. */
  onOpenCard: (id: string) => void;
  /** @deprecated 添加素材的唯一入口在画布工具条（IM-M1）。 */
  onImport?: () => void;
}

/** 画布节点（App 传给 React Flow 的那份，带着 App 的实测尺寸）；只在 App 换节点数组时变，平移、缩放不变。 */
const flowNodesSelector = (state: ReactFlowState) => state.nodes;

/** “本画布”：卡片计数、语义筛选兼图例、卡片列表（§6.2 第 6–8 项）。 */
export default function MaterialsLibrary({ board, selectedIds, facet: controlledFacet, onFacet, onRevealCard, onOpenCard }: MaterialsLibraryProps) {
  const [ownState, setOwnState] = useState<{ boardId: string; facet: LibraryFacet }>({ boardId: board.id, facet: 'all' });
  const [frameState, setFrameState] = useState<{ boardId: string; ids: Set<string> }>(() => ({ boardId: board.id, ids: new Set() }));
  // Sidebar keys this component by board ID; also reset when reused directly,
  // so A → B → A cannot revive an old uncontrolled filter or open tray.
  if (ownState.boardId !== board.id) setOwnState({ boardId: board.id, facet: 'all' });
  if (frameState.boardId !== board.id) setFrameState({ boardId: board.id, ids: new Set() });
  const expandedFrames = frameState.boardId === board.id ? frameState.ids : new Set<string>();
  const facet = controlledFacet ?? (ownState.boardId === board.id ? ownState.facet : 'all');
  const setFacet = (next: LibraryFacet) => { setOwnState({ boardId: board.id, facet: next }); onFacet?.(next); };
  // 分组成员与画布上的分组标签同一口径（FC-06）：用卡片的实测尺寸判断，没有存高度的图片不再按默认 480 高算成组外。
  const flowNodes = useStore(flowNodesSelector);
  const measurements = useMemo(() => {
    const sizes: CardMeasurements = {};
    for (const node of flowNodes) { const width = node.measured?.width, height = node.measured?.height; if (width && height) sizes[node.id] = { width, height }; }
    return sizes;
  }, [flowNodes]);

  const { cards, counts, groups, frameImages, containedBy } = useMemo(() => {
    const cards = board.nodes.filter(node => node.data.kind !== 'frame');
    const frames = board.nodes.filter(node => node.data.kind === 'frame');
    const counts: Record<Facet, number> = { source: 0, quote: 0, mine: 0, image: 0 };
    for (const node of cards) { const value = cardFacet(node.data); if (value) counts[value]++; }
    const containedBy = new Map<string, number>();
    for (const frame of frames) containedBy.set(frame.id, cards.filter(node => frameContainsCard(frame, node, measurements)).length);
    // Fold only images, as before. An overlapping image appears under the first
    // containing tray once; this is a directory view, never a stored membership.
    const frameImages = new Map<string, BoardNode[]>(frames.map(frame => [frame.id, []]));
    const foldedImages = new Set<string>();
    for (const image of cards.filter(node => node.data.kind === 'image')) {
      const owner = frames.find(frame => frameContainsCard(frame, image, measurements));
      if (owner) { frameImages.get(owner.id)!.push(image); foldedImages.add(image.id); }
    }
    const groups: Record<Facet, BoardNode[]> = { source: [], quote: [], mine: [], image: [] };
    for (const card of cards) { const value = cardFacet(card.data); if (value && !foldedImages.has(card.id)) groups[value].push(card); }
    groups.mine.sort((a, b) => Number(b.data.kind === 'draft') - Number(a.data.kind === 'draft'));
    groups.image = [...frames.filter(frame => (containedBy.get(frame.id) ?? 0) > 0 || frame.data.title), ...groups.image];
    return { cards, counts, groups, frameImages, containedBy };
  }, [board, measurements]);

  const activeFacet = FACETS.find(item => item.id === facet);
  const renderItem = (node: BoardNode, child = false) => {
    const current = selectedIds.includes(node.id);
    const title = itemTitle(node.data);
    const meta = itemMeta(node, board, containedBy.get(node.id) ?? 0);
    return <button key={node.id} type="button"
      className={`library-item${current ? ' is-current' : ''}${node.data.kind === 'quote' ? ' is-quote' : ''}${child ? ' is-child' : ''}`}
      data-card-id={node.id} title={`${title}\n单击定位到画布，双击${current ? '或按 Enter ' : ''}打开`}
      aria-current={current ? 'true' : undefined}
      onClick={() => onRevealCard(node.id)} onDoubleClick={() => onOpenCard(node.id)}
      onKeyDown={event => {
        if (event.key !== 'Enter' || !current || event.repeat || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        event.preventDefault(); onOpenCard(node.id);
      }}>
      <Thumb node={node} />
      <strong lang={/[㐀-鿿]/.test(title) ? undefined : 'en'}>{title}</strong>
      <span className={`library-meta${node.data.kind === 'quote' ? ' library-meta--location' : ''}`}>{meta}</span>
    </button>;
  };
  return (
    <section className="materials-navigation" aria-label="当前画布资料">
      <div className="sidebar-section-head">
        <span className="sidebar-section-label">本画布</span>
        <span className="sidebar-section-count tabular">{cards.length} 张卡片</span>
      </div>
      <div className="library-list" role="group" aria-label="素材筛选">
          {FACETS.map(({ id, label }) => {
            const pressed = facet === id;
            const empty = counts[id] === 0;
            return <section key={id} className="library-directory-group" data-facet={id}>
              <button
                type="button"
                className={`library-facet${pressed ? ' is-pressed' : ''}${empty ? ' is-empty' : ''}`}
                aria-label={`只看${label}，${counts[id]} 张`}
                aria-pressed={pressed}
                title={empty && !pressed ? `本画布没有${label === '我写的' ? '我写的文稿或笔记' : label}` : pressed ? '显示全部卡片' : `只看${label}`}
                onClick={() => setFacet(pressed ? 'all' : id)}
              >
                <span className="library-facet__label">{label}</span>
                <b>{counts[id]}</b>
              </button>
              {(facet === 'all' || facet === id) && groups[id].map(node => {
                if (node.data.kind !== 'frame') return renderItem(node);
                const members = frameImages.get(node.id) ?? [];
                const expanded = expandedFrames.has(node.id);
                return <div key={node.id} className="library-frame">
                  <div className="library-frame-row">
                    <button type="button" className="library-frame-toggle" aria-label={`${expanded ? '收起' : '展开'}分组成员：${itemTitle(node.data)}`}
                      title={expanded ? '收起分组成员' : '展开分组成员'} aria-expanded={expanded} disabled={!members.length}
                      onClick={() => setFrameState(current => { const next = new Set(current.boardId === board.id ? current.ids : []); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return { boardId: board.id, ids: next }; })}>
                      {expanded ? <ChevronDown size={12} aria-hidden="true"/> : <ChevronRight size={12} aria-hidden="true"/>}
                    </button>
                    {renderItem(node)}
                  </div>
                  {expanded && <div className="library-frame-members">{members.map(member => renderItem(member, true))}</div>}
                </div>;
              })}
            </section>;
          })}
        {/* What to do is said once, in the middle of the empty canvas (§8.3 #13). */}
        {!cards.length && <p className="library-empty">还没有卡片</p>}
        {!!cards.length && activeFacet && !groups[activeFacet.id].length && (
          <div className="library-empty">
            <p>本画布没有{activeFacet.label === '我写的' ? '我写的文稿或笔记' : activeFacet.label}。</p>
            <button type="button" className="btn btn--sm" onClick={() => setFacet('all')}>清除筛选</button>
          </div>
        )}
      </div>
    </section>
  );
}
