import type { MouseEvent, ReactNode } from 'react';
import { ProvenanceParagraphIcon, ProvenancePlayIcon } from '../icons/field-icons';

/**
 * 出处印（PLAN §2.5）：朱框和实心位置图标，墨色位置字；不改变来源文字或动作名。
 * 旧 size 调用映射到对应的新变体，便于各表面按所属工作包逐步接线。
 */
export type ProvenanceTagSize = 'standard' | 'mini';

export interface ProvenanceTagProps {
  variant?: 'stamp' | 'stamp-mini';
  /** 调用方按 citation.start 是否有值选择；省略时兼容旧的字符串时间位置。 */
  kind?: 'video' | 'text';
  /** 印上只写调用方提供的位置，不重写现有位置函数的输出。 */
  label: ReactNode;
  size?: ProvenanceTagSize;
  /** 来源已不在当前画布：虚线描边、不可点。 */
  gone?: boolean;
  /** 可点时渲染为按钮；aria-label 写动作，例如“回到原片 01:12”。 */
  onActivate?: (event: MouseEvent<HTMLButtonElement>) => void;
  actionLabel?: string;
  title?: string;
  className?: string;
}

export function ProvenanceTagShape({ label, size = 'standard', variant, kind, gone = false }: Pick<ProvenanceTagProps, 'label' | 'size' | 'variant' | 'kind' | 'gone'>) {
  const mini = (variant ?? (size === 'mini' ? 'stamp-mini' : 'stamp')) === 'stamp-mini';
  const video = kind ? kind === 'video' : typeof label === 'string' && /^\d{2,}:\d{2}(?::\d{2})?(?:[–—-]|$)/.test(label);
  const Icon = video ? ProvenancePlayIcon : ProvenanceParagraphIcon;
  const classes = ['tag', mini ? 'tag--mini tag--stamp-mini' : 'tag--stamp', gone ? 'tag--gone' : ''].filter(Boolean).join(' ');
  return (
    <span className={classes}>
      <span className="tag__head" aria-hidden="true"><Icon className="tag__icon" /></span>
      <span className="tag__body">{label}</span>
    </span>
  );
}

export default function ProvenanceTag({ label, size = 'standard', variant, kind, gone = false, onActivate, actionLabel, title, className }: ProvenanceTagProps) {
  const shape = <ProvenanceTagShape label={label} size={size} variant={variant} kind={kind} gone={gone} />;
  if (gone) {
    return <span className={['tag-static', className].filter(Boolean).join(' ')} title={title ?? '来源卡片已不在当前画布'}>{shape}</span>;
  }
  if (!onActivate) {
    return <span className={['tag-static', className].filter(Boolean).join(' ')} title={title}>{shape}</span>;
  }
  return (
    <button
      type="button"
      className={['field-card__citation', 'tag-btn', 'nodrag', 'nopan', className].filter(Boolean).join(' ')}
      aria-label={actionLabel}
      title={title ?? actionLabel}
      onClick={event => { event.stopPropagation(); onActivate(event); }}
    >
      {shape}
    </button>
  );
}
