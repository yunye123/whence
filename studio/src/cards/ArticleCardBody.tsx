import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { BookOpen } from 'lucide-react';
import { approxCharacters, articleCharacters, isLatinText, lengthMarks, webLink } from './card-utils';
import { CardHandle } from './CardShell';
import { withBreaks } from './Words';
import { canMeasureText, measureTextLines, textPieces } from './text-measure';
import { sourcePreviewParagraphs, type SourcePreviewParagraph } from '../source-location';
import type { CardBodyProps, ExcerptMark } from './types';

export type FolderSourceProps = CardBodyProps & { marks: readonly ExcerptMark[]; connectable: boolean };
type TextMark = ExcerptMark & { from: number; to: number };

/** Never guess an old citation's location. Card extras supplies already resolved LF/UTF-16 ranges. */
function validTextMarks(marks: readonly ExcerptMark[], length: number): TextMark[] {
  return marks.filter((mark): mark is TextMark => Number.isInteger(mark.from) && Number.isInteger(mark.to)
    && mark.from! >= 0 && mark.to! > mark.from! && mark.to! <= length);
}
const intersects = (p: SourcePreviewParagraph, mark: TextMark) => mark.from < p.to && mark.to > p.from;

/** Mark boundaries split the original slice, not a Markdown projection. Overlaps keep every actual quote id. */
function markedText(paragraph: SourcePreviewParagraph, marks: readonly TextMark[], narrow: boolean): ReactNode[] {
  const used = marks.filter(mark => intersects(paragraph, mark));
  const boundaries = [...new Set([paragraph.from, paragraph.to, ...used.flatMap(mark => [Math.max(paragraph.from, mark.from), Math.min(paragraph.to, mark.to)])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((from, index) => {
    const to = boundaries[index + 1];
    const text = paragraph.text.slice(from - paragraph.from, to - paragraph.from);
    // Short pieces may use shared cached word breaks; long TXT stays one text node, clipped only by CSS.
    // No canvas font or width estimate is claimed in SSR, and no DOM width is read on mount.
    let content: ReactNode = text.length <= 600 ? withBreaks(textPieces(text, { mode: narrow ? 'char' : 'word' }) ?? [text]) : text;
    for (const mark of used.filter(mark => mark.from < to && mark.to > from).reverse()) {
      content = <mark data-quote-id={mark.quoteId} data-edge-anchor={mark.quoteId ? 'excerpt-row' : undefined}
        data-mark-from={from} data-mark-to={to}>{content}</mark>;
    }
    return <Fragment key={from}>{content}</Fragment>;
  });
}

/** Shared folder source face. Numbering and exact slices are the same lightweight API as reading. */
export function FolderSourcePreview({ data, marks, connectable, previewWidth, previewHeight }: FolderSourceProps) {
  const normalized = useMemo(() => data.body.replace(/\r\n?/g, '\n'), [data.body]);
  const paragraphs = useMemo(() => sourcePreviewParagraphs(normalized), [normalized]);
  const valid = useMemo(() => validTextMarks(marks, normalized.length), [marks, normalized.length]);
  const total = paragraphs.filter(p => p.number).length;
  // Node width arrives from ReactFlow's ResizeObserver. Keep its delivery from also
  // committing a different content height; plan at the next frame using the latest width.
  const [plan, setPlan] = useState({ width: previewWidth, height: previewHeight });
  useEffect(() => {
    if (previewWidth === plan.width && previewHeight === plan.height) return;
    // Finish this scheduled layout before the browser delivers its next size
    // observations; an observer store notification must not flush it midway.
    const frame = requestAnimationFrame(() => flushSync(() => setPlan({ width: previewWidth, height: previewHeight })));
    return () => cancelAnimationFrame(frame);
  }, [previewWidth, previewHeight, plan]);
  const { width: planWidth, height: planHeight } = plan;
  const narrow = planWidth !== undefined && Number.isFinite(planWidth) && planWidth <= 200;
  const [fontVersion, setFontVersion] = useState(0);
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    const loaded = () => setFontVersion(version => version + 1);
    document.fonts.addEventListener('loadingdone', loaded);
    return () => document.fonts.removeEventListener('loadingdone', loaded);
  }, []);
  const canPlan = planWidth !== undefined && Number.isFinite(planWidth) && planWidth > 0 && canMeasureText();
  const selected = useMemo(() => {
    const candidates = paragraphs.filter(p => p.number === 1 || valid.some(mark => intersects(p, mark)));
    if (!canPlan) return candidates.slice(0, 6).map(paragraph => ({ paragraph, lineLimit: undefined })); // SSR defers line planning.
    const width = Math.max(1, planWidth! - 8 - (narrow ? 28 + 12 : 34 + 14));
    // These are the folder's authored CSS insets and fixed line heights. Measure
    // text with the existing canvas cache; never read live DOM height or feed a
    // ResizeObserver result back into its own layout.
    const titleLines = Math.min(2, Math.max(1, measureTextLines(data.title || '未命名', {
      font: `600 16px ${isLatinText(data.title) ? '"Inter Variable"' : '"Noto Sans SC Variable"'}, sans-serif`,
      width: Math.max(1, planWidth! - 8 - 14 - 40), mode: 'word', whiteSpace: 'normal', minRun: 4,
    }).length));
    const link = data.kind === 'link' ? webLink(data.url) : null;
    const poster = data.kind === 'link' && data.poster ? 14 + Math.min(150, Math.floor(Math.max(0, planWidth! - 8 - 30) * 9 / 16)) : 0;
    const chrome = 24 + 8 + 12 + titleLines * 24 + 2 + 22 + (link ? 22 : 0) + 20 + poster + (data.kind === 'link' && !link ? 30 : 0);
    const budget = planHeight === undefined ? 330 : Math.max(0, Math.min(330, planHeight - chrome));
    const accepted: { paragraph: SourcePreviewParagraph; lineLimit?: number }[] = [];
    let pixels = 0, previous = 0;
    for (const [index, paragraph] of candidates.entries()) {
      const quoted = valid.some(mark => intersects(paragraph, mark));
      const lines = measureTextLines(paragraph.text, { font: '400 14px "Noto Sans SC Variable", "Microsoft YaHei UI", "PingFang SC", sans-serif', width,
        mode: narrow ? 'char' : 'word', minRun: 0, whiteSpace: 'pre-wrap', letterSpacing: 0, wordSpacing: 0 });
      const gap = paragraph.number > previous + 1 ? 24 : 0;
      const tail = paragraph.number < total ? 24 : 0;
      // Leave room for a following highlighted passage when a user makes the
      // paper short. Both paragraphs remain verbatim; CSS clamps complete lines.
      const following = candidates[index + 1];
      const reserve = !quoted && following && valid.some(mark => intersects(following, mark))
        ? (following.number > paragraph.number + 1 ? 24 : 0) + 2 * 22 + 6 : 0;
      const availableLines = Math.floor((budget - pixels - gap - tail - 6 - reserve) / 22);
      const lineLimit = Math.min(lines.length, quoted ? 5 : 3, Math.max(1, availableLines));
      const next = lineLimit * 22 + 6;
      if (accepted.length >= 6 || pixels + gap + next + tail > budget) break;
      accepted.push({ paragraph, lineLimit }); pixels += gap + next; if (paragraph.number) previous = paragraph.number;
    }
    return accepted;
  }, [paragraphs, valid, canPlan, planWidth, planHeight, narrow, total, fontVersion, data.title, data.kind, data.url, data.poster]);
  const spans = lengthMarks(normalized.length, valid);
  let previousNumber = 0;
  return (
    <div className="field-card__article card-drag-content" data-folder-narrow={narrow ? '' : undefined}>
      <div className="field-card__folder-tab" data-folder-tab={data.kind === 'link' ? 'link' : 'article'}>
        {data.kind === 'link' ? '网页' : <>文字资料 <span>{data.tags?.includes('Markdown') ? 'Markdown' : data.tags?.includes('纯文本') ? 'TXT' : ''}</span></>}
      </div>
      <div className="field-card__folder-paragraphs" data-plan-ready={canPlan ? '' : undefined}>
        {selected.map(({ paragraph, lineLimit }) => {
          const gapFrom = previousNumber + 1;
          const gapTo = paragraph.number - 1;
          if (paragraph.number) previousNumber = paragraph.number;
          const excerpt = valid.some(mark => intersects(paragraph, mark));
          return <Fragment key={paragraph.from}>
            {gapTo >= gapFrom && <FolderGap from={gapFrom} to={gapTo} />}
            <p className={`field-card__folder-paragraph nodrag nowheel nopan ${narrow ? 'char-wrap' : 'cjk-wrap'}`} data-pn={paragraph.number || undefined}
              data-source-from={paragraph.from} data-source-to={paragraph.to} data-source-heading={paragraph.heading ? '' : undefined}
              style={lineLimit ? { '--folder-lines': lineLimit } as CSSProperties : undefined}
              data-has-excerpt={excerpt ? '' : undefined}>{markedText(paragraph, valid, narrow)}</p>
          </Fragment>;
        })}
        {total > previousNumber && <FolderGap from={previousNumber + 1} to={total} />}
      </div>
      {/* Retain the original rail/handle contract, without drawing a second length rail on the paper. */}
      <div className="field-card__length-rail" data-folder-output="">
        {spans.map(span => <span key={span.key} aria-hidden="true" style={{ left: `${span.left * 100}%`, width: `${span.width * 100}%` }} />)}
        <CardHandle type="source" connectable={connectable} />
      </div>
    </div>
  );
}

function FolderGap({ from, to }: { from: number; to: number }) {
  return <div className="field-card__folder-gap">… 第 {from}{to > from ? `–${to}` : ''} 段</div>;
}

export function ArticleCardBody(props: FolderSourceProps) {
  // The integration base temporarily also mounts ArticleCardBody for links. LinkCardBody now owns
  // that source preview and its sole handle; main can remove the temporary composition safely.
  return props.data.kind === 'link' ? null : <FolderSourcePreview {...props} />;
}

export function ArticleCardFooter({ data, platform }: Pick<CardBodyProps, 'data'> & { platform: string }) {
  const count = useMemo(() => articleCharacters(data.body), [data.body]);
  const total = useMemo(() => sourcePreviewParagraphs(data.body).filter(p => p.number).length, [data.body]);
  const date = data.collectedAt?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return (
    <>
      <span className="field-card__meta-source">{data.sourceAuthor || platform}</span>
      <span className="field-card__meta-state tabular">{approxCharacters(count)} · {total} 段{date ? ` · ${date}` : ''}</span>
    </>
  );
}

/** Hover action: open reading (K4 `展开阅读：<标题>`). */
export function ArticleCardActions({ data, activate, openCard }: CardBodyProps) {
  return (
    <button className="field-card__chip nodrag nowheel" onClick={event => activate(event, openCard)} aria-label={`展开阅读：${data.title}`} title="展开阅读">
      <BookOpen size={14} aria-hidden="true" />
    </button>
  );
}
