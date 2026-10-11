import type { Dispatch, SetStateAction } from 'react';
import { useBoard } from '../board-context';
import type { PatchCard } from './shared';

/**
 * Tags the app writes itself (INSP-02): the kind of an imported text (文字资料 · 纯文本 · Markdown), the excerpt
 * marker and a draft's stage (第二稿). They decide how a card is treated, so they never sit in the editable field,
 * where deleting one would silently turn an imported article into “我写的” note; saving keeps them as they are.
 */
const SYSTEM_TAGS = new Set(['文字资料', '纯文本', 'Markdown', '参考摘录']);
const STAGE_TAG = /^第\s*[一二三四五六七八九十百\d]+\s*稿$/;
export const isSystemTag = (tag: string) => SYSTEM_TAGS.has(tag) || STAGE_TAG.test(tag);
/** The tags the person wrote, as the field shows them. */
export const editableTags = (tags?: readonly string[]) => (tags ?? []).filter(tag => !isSystemTag(tag)).join('，');

/** Tags split on , ， 、 or newline, leading # removed, de-duplicated, at most 20 (system tags first, K1). */
export default function TagsField({ tags, tagsInput, setTagsInput, patch }: {
  /** The card's stored tags, so the system ones survive a save. */
  tags?: readonly string[];
  tagsInput: string;
  setTagsInput: Dispatch<SetStateAction<string>>;
  patch: PatchCard;
}) {
  const board = useBoard();
  const commitTags = () => {
    const kept = (tags ?? []).filter(isSystemTag);
    const typed = tagsInput.split(/[,，、\n]/).map(tag => tag.trim().replace(/^#/, '')).filter(Boolean);
    const next = [...new Set([...kept, ...typed])].slice(0, 20);
    patch({ tags: next }); setTagsInput(editableTags(next));
  };
  return <section className="inspector-section inspector-tags">
    <label className="inspector-field-label" htmlFor="card-tags">标签</label>
    <input
      id="card-tags"
      className="input"
      readOnly={board.readOnly}
      value={tagsInput}
      onChange={event => setTagsInput(event.target.value)}
      onBlur={commitTags}
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { commitTags(); event.currentTarget.blur(); } }}
      placeholder="用逗号分隔，如：开头，叙事，灵感"
      aria-describedby="card-tags-hint"
    />
    <p id="card-tags-hint" className="inspector-field-hint">按标签可以在画布里找到相关卡片。</p>
  </section>;
}
