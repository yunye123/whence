import { useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';
import { GripVertical, Link2, Upload } from 'lucide-react';
import type { Board, BoardNode, CardKind } from '../model';
import { parseDraftReferences, type DraftReference } from '../draft-references';
import { draftCharacterCount, draftParagraphIndexAt, draftParagraphNumbers, plainMarkdown, timeRangeLabel } from '../source-location';
import { isTextSource, quoteLocation, quoteTitle } from '../dialogs/display';
import { ProvenanceTagShape } from '../components/ProvenanceTag';
import { ArticleIcon, DraftIcon, ImageIcon, NoteIcon, QuoteIcon, VideoIcon } from '../icons/field-icons';
import { Words } from '../cards/Words';
import { draftStage } from '../cards/card-utils';

export interface OutlineSection { heading: string; from: number; to: number; references: DraftReference[] }

/** 文稿按 `#`/`##` 小标题切成节；第一个小标题之前有正文时算作“开头”。位置是 LF 规范化后正文的 UTF-16 偏移。 */
export function draftOutline(body: string): OutlineSection[] {
  const text = body.replace(/\r\n?/g, '\n');
  const references = parseDraftReferences(text);
  const headings = [...text.matchAll(/^#{1,3}[ \t]+(.+)$/gm)].map(match => ({ heading: match[1].trim(), from: match.index ?? 0 }));
  const sections: OutlineSection[] = [];
  const intro = headings.length ? headings[0].from : text.length;
  if (text.slice(0, intro).trim()) sections.push({ heading: '开头', from: 0, to: intro, references: [] });
  headings.forEach((item, index) => sections.push({ heading: item.heading, from: item.from, to: index + 1 < headings.length ? headings[index + 1].from : text.length, references: [] }));
  for (const section of sections) section.references = references.filter(reference => reference.from >= section.from && reference.from < section.to);
  return sections;
}

/** 把第 `from` 节整段移到第 `to` 节的位置（FD-M2）；只搬动文字块，不改动其中任何一个字。 */
export function moveDraftSection(body: string, from: number, to: number): string {
  const text = body.replace(/\r\n?/g, '\n');
  const sections = draftOutline(text);
  if (from === to || !sections[from] || !sections[to] || sections[0].heading === '开头' && (from === 0 || to === 0)) return text;
  const blocks = sections.map(section => text.slice(section.from, section.to));
  const ensureBreak = (value: string) => value.endsWith('\n\n') ? value : value.endsWith('\n') ? `${value}\n` : `${value}\n\n`;
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved);
  const head = text.slice(0, sections[0].from);
  return (head + blocks.map((block, index) => index === blocks.length - 1 ? block.replace(/\n+$/, '\n') : ensureBreak(block)).join('')).replace(/\n+$/, text.endsWith('\n') ? '\n' : '');
}

const KIND_ORDER: CardKind[] = ['draft', 'quote', 'video', 'note', 'link', 'image'];
const KIND_TITLE: Record<CardKind, string> = { draft: '文稿', quote: '摘录', video: '视频', note: '笔记', link: '链接', image: '图片', frame: '分组' };
function Glyph({ node }: { node: BoardNode }) {
  if (isTextSource(node)) return <ArticleIcon size={16}/>;
  switch (node.data.kind) {
    case 'video': return <VideoIcon size={16}/>;
    case 'image': return <ImageIcon size={16}/>;
    case 'quote': return <QuoteIcon size={16}/>;
    case 'draft': return <DraftIcon size={16}/>;
    case 'link': return <Link2 size={16} strokeWidth={1.75} aria-hidden="true"/>;
    default: return <NoteIcon size={16}/>;
  }
}
const oneLine = (value: string) => plainMarkdown(value).replace(/\[[^\]]*\]\(field:\/\/[^)]*\)/g, '').replace(/\s+/g, ' ').trim();

/**
 * 大纲视图（§6.27，FD-M2）：每篇文稿一张稿纸，每节列出引用的摘录、位置出处印与来源；
 * 没有文稿时按类型列出全部卡片。传入 `onReorderDraft` 后，节可以拖动或用 Alt + ↑↓ 调整顺序。
 */
export default function OutlineView({ board, onOpenCard, onImport, onReorderDraft }: { board: Board; onOpenCard: (id: string) => void; onImport: () => void; onReorderDraft?: (draftId: string, body: string) => void }) {
  const nodes = useMemo(() => new Map(board.nodes.map(node => [node.id, node])), [board.nodes]);
  const cards = board.nodes.filter(node => node.data.kind !== 'frame');
  const drafts = cards.filter(node => node.data.kind === 'draft').sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  const [dragging, setDragging] = useState<{ draft: string; index: number } | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const cited = useMemo(() => new Set(drafts.flatMap(draft => parseDraftReferences(draft.data.body).flatMap(reference => [reference.quoteNodeId, reference.sourceNodeId].filter((id): id is string => !!id)))), [drafts]);
  const unusedQuotes = cards.filter(node => node.data.kind === 'quote' && !cited.has(node.id));

  const referenceRow = (reference: DraftReference, key: string, body: string) => {
    const quote = reference.quoteNodeId ? nodes.get(reference.quoteNodeId) : undefined;
    const source = nodes.get(reference.sourceNodeId);
    const location = (quote ? quoteLocation(quote.data, source?.data.body) : timeRangeLabel(reference.time)) ?? '原文';
    const text = quote ? (quote.data.citation?.text ?? (quote.data.body || quoteTitle(quote.data))) : reference.label;
    const gone = !source && !quote;
    const paragraph = draftParagraphIndexAt(body, reference.from);
    const kind = (quote?.data.citation?.start ?? reference.time) !== undefined ? 'video' : 'text';
    return <li key={key}>
      <button type="button" className="outline-row outline-row--ref" disabled={gone} title={gone ? '来源卡片已不在当前画布' : undefined} onClick={() => onOpenCard(quote?.id ?? reference.sourceNodeId)}>
        {paragraph && <span className="outline-ref__paragraph" data-para={paragraph} aria-hidden="true"/>}
        <span className="outline-ref__tag"><ProvenanceTagShape label={location} variant="stamp-mini" kind={kind} gone={gone}/></span>
        <span className="outline-ref__text">{text}</span>
        <span className="outline-ref__source">{source?.data.title ?? quote?.data.citation?.title ?? '来源已移除'}</span>
      </button>
    </li>;
  };

  const sectionKeys = (draft: BoardNode, index: number, count: number) => (event: KeyboardEvent<HTMLElement>) => {
    if (!onReorderDraft || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const target = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (target < 0 || target >= count) return;
    event.preventDefault();
    const next = moveDraftSection(draft.data.body, index, target);
    if (next !== draft.data.body) onReorderDraft(draft.id, next);
  };

  return (
    <div className="outline-view">
      <header className="outline-intro">
        <div>
          <h2>大纲</h2>
          <p>{drafts.length ? '按文稿的小标题，列出每一节引用了哪些摘录、出自哪里。' : cards.length ? '这块画布还没有文稿。下面按类型列出全部卡片。' : '这块画布还没有卡片。'}</p>
        </div>
        <span>{cards.length} 张卡片</span>
      </header>

      {drafts.map(draft => {
        const body = draft.data.body.replace(/\r\n?/g, '\n');
        const sections = draftOutline(body);
        const paragraphs = draftParagraphNumbers(body);
        const refs = sections.reduce((sum, section) => sum + section.references.length, 0);
        const fixedIntro = sections[0]?.heading === '开头';
        return <section className="outline-draft" key={draft.id} aria-label={`文稿：${draft.data.title || '未命名文稿'}`}>
          <button type="button" className="outline-row outline-row--draft" onClick={() => onOpenCard(draft.id)}>
            <span className="outline-row__icon"><DraftIcon size={18}/></span>
            <span className="outline-draft__title">{draft.data.title || '未命名文稿'}</span>
            <span className="outline-row__meta">{draftStage(draft.data.draftVersions?.length ?? 0)}　{sections.length} 节　{refs} 处引用　正文 {draftCharacterCount(draft.data.body).toLocaleString('en-US')} 字</span>
          </button>
          <div className="outline-draft__rule" aria-hidden="true"/>
          {sections.length > 0 && <ol className="outline-sections">
            {sections.map((section, index) => {
              const movable = !!onReorderDraft && !(fixedIntro && index === 0);
              const firstLine = paragraphs.starts.findIndex((start, line) => start >= section.from && start < section.to && paragraphs.owner[line] > 0);
              const paragraph = firstLine < 0 ? undefined : paragraphs.owner[firstLine];
              return <li key={`${section.from}-${section.heading}`}
                className={`outline-section${dragging?.draft === draft.id && dragging.index === index ? ' is-dragging' : ''}${over === index && dragging?.draft === draft.id ? ' is-over' : ''}`}
                draggable={movable}
                onDragStart={(event: DragEvent) => { if (!movable) return; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', section.heading); setDragging({ draft: draft.id, index }); }}
                onDragOver={(event: DragEvent) => { if (dragging?.draft !== draft.id || (fixedIntro && index === 0)) return; event.preventDefault(); setOver(index); }}
                onDragLeave={() => setOver(current => current === index ? null : current)}
                onDrop={(event: DragEvent) => {
                  event.preventDefault();
                  if (dragging?.draft === draft.id && onReorderDraft) { const next = moveDraftSection(draft.data.body, dragging.index, index); if (next !== draft.data.body) onReorderDraft(draft.id, next); }
                  setDragging(null); setOver(null);
                }}
                onDragEnd={() => { setDragging(null); setOver(null); }}>
                <div className="outline-section__head">
                  {movable && <span className="outline-section__grip" aria-hidden="true"><GripVertical size={14}/></span>}
                  <button type="button" className="outline-row outline-row--section" onClick={() => onOpenCard(draft.id)} onKeyDown={sectionKeys(draft, index, sections.length)}
                    aria-description={movable ? '按 Alt 加上下方向键调整这一节的位置' : undefined}>
                    {paragraph && <span className="outline-section__paragraph" data-para={paragraph} aria-hidden="true"/>}
                    <span className="outline-section__title">{section.heading}</span>
                    <span className="outline-row__meta">{section.references.length ? `${section.references.length} 处引用` : '没有引用'}</span>
                  </button>
                </div>
                {section.references.length > 0 && <ul className="outline-refs">{section.references.map((reference, refIndex) => referenceRow(reference, `${reference.id}-${refIndex}`, body))}</ul>}
              </li>;
            })}
          </ol>}
        </section>;
      })}

      {drafts.length > 0 && unusedQuotes.length > 0 && <section className="outline-group" aria-label="还没写进文稿的摘录">
        <h3 className="outline-group__title">还没写进文稿的摘录 <span>{unusedQuotes.length}</span></h3>
        <ul className="outline-refs outline-refs--loose">{unusedQuotes.map(quote => {
          const source = quote.data.citation ? nodes.get(quote.data.citation.nodeId) : undefined;
          const location = quoteLocation(quote.data, source?.data.body) ?? '原文';
          return <li key={quote.id}><button type="button" className="outline-row outline-row--ref" onClick={() => onOpenCard(quote.id)}>
            <span className="outline-ref__tag"><ProvenanceTagShape label={location} variant="stamp-mini" kind={quote.data.citation?.start !== undefined ? 'video' : 'text'}/></span>
            <span className="outline-ref__text">{quote.data.citation?.text ?? (quote.data.body || quoteTitle(quote.data))}</span>
            <span className="outline-ref__source">{source?.data.title ?? quote.data.citation?.title ?? ''}</span>
          </button></li>;
        })}</ul>
      </section>}

      {!drafts.length && KIND_ORDER.map(kind => {
        const group = cards.filter(node => node.data.kind === kind).sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
        if (!group.length) return null;
        return <section className="outline-group" key={kind} aria-label={KIND_TITLE[kind]}>
          <h3 className="outline-group__title">{KIND_TITLE[kind]} <span>{group.length}</span></h3>
          <ul className="outline-list">{group.map(node => {
            const thumb = node.data.kind === 'image' || node.data.kind === 'video' ? node.data.poster : undefined;
            const meta = node.data.kind === 'video' ? (node.data.duration ? timeRangeLabel(node.data.duration) : '') + (node.data.transcript?.length ? `　逐字稿 ${node.data.transcript.length} 句` : '')
              : node.data.kind === 'quote' ? timeRangeLabel(node.data.citation?.start, node.data.citation?.end) ?? node.data.citation?.title ?? ''
                : isTextSource(node) ? '文字资料' : node.data.kind === 'link' ? (() => { try { return new URL(node.data.url ?? '').hostname; } catch { return ''; } })() : oneLine(node.data.body).slice(0, 40);
            return <li key={node.id}><button type="button" className="outline-row outline-row--card" onClick={() => onOpenCard(node.id)}>
              <span className="outline-row__icon">{thumb ? <img src={thumb} alt="" draggable={false}/> : <Glyph node={node}/>}</span>
              <span className="outline-card__title">{node.data.kind === 'quote' ? quoteTitle(node.data) : node.data.title || KIND_TITLE[node.data.kind]}</span>
              <span className="outline-row__meta">{meta}</span>
            </button></li>;
          })}</ul>
        </section>;
      })}

      {!cards.length && (
        <div className="outline-empty">
          <h3>大纲还是空的</h3>
          <Words as="p" text="导入文字、图片或视频，或者新建一篇文稿。在文稿里加小标题（工具栏“小标题”），这里就会按节列出每一节的出处。"/>
          <button type="button" className="btn btn--line" onClick={() => onImport()}><Upload size={15} aria-hidden="true"/>导入素材</button>
        </div>
      )}
    </div>
  );
}
