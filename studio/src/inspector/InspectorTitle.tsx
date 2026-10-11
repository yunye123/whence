import type { RefObject } from 'react';
import type { CardData } from '../model';
import { useBoard } from '../board-context';
import { quoteDisplayTitle } from '../source-location';
import type { PatchCard } from './shared';

/**
 * Where the title sits depends on the layout (DESIGN_SYSTEM §6.18):
 * - `header`  docked panel and watching workbench: one line in the 52px header, 15/600
 * - `article` reading: top of the article column, 26/36
 * - `paper`   focus writing: top of the paper, serif 34/44
 * The field is always the same textarea named “资料标题”; auto-height sizing of `titleRef` stays in the shell.
 * No fixed slogan under the title (CD-M3): only the person's own words appear here.
 */
export type InspectorTitleVariant = 'header' | 'article' | 'paper';

export default function InspectorTitle({ nodeId, data, titleRef, patch, variant = 'header' }: {
  nodeId: string;
  data: CardData;
  titleRef: RefObject<HTMLTextAreaElement | null>;
  patch: PatchCard;
  variant?: InspectorTitleVariant;
}) {
  const board = useBoard();
  const inHeader = variant === 'header';
  // The paper of focus writing carries only the person's words; the example badge stays in the other layouts.
  // An excerpt still carrying its stored default title (“摘录 · 01:12”, “摘录 · <来源>”) shows the opening of its
  // sentence, as the canvas, sidebar and search do (C13, INSP-20); typing gives it a title of its own.
  const value = data.kind === 'quote' ? quoteDisplayTitle(data) : data.title;
  const example = data.demo && variant !== 'paper' ? <span className="inspector-example" title="示例画布里的卡片，可以直接修改或删除">示例</span> : null;
  return <div className={`inspector-title-area inspector-title-area--${variant}`}>
    {!inHeader && example}
    <textarea
      ref={titleRef}
      key={`${nodeId}-title`}
      aria-label="资料标题"
      className={`inspector-title-field inspector-title-field--${variant}`}
      rows={1}
      wrap={inHeader ? 'off' : undefined}
      maxLength={200}
      readOnly={board.readOnly}
      value={value}
      placeholder={data.kind === 'draft' ? '未命名文稿' : '给这张卡片起个名字'}
      spellCheck={false}
      onChange={event => patch({ title: event.target.value.replace(/\n/g, '') })}
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault(); }}
    />
    {inHeader && example}
  </div>;
}
