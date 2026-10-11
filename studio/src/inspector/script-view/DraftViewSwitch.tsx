import type { KeyboardEvent, MouseEvent } from 'react';
import type { DraftView } from './view-mode';

const OPTIONS: { value: DraftView; label: string; title: string }[] = [
  { value: 'body', label: '正文', title: '正文：写和改都在这里' },
  { value: 'script', label: '脚本', title: '脚本：按小标题分场，每段一行，带画面与时长' },
];

/**
 * “正文 / 脚本” (§6.29): a segmented control, group “文稿视图”, each option `aria-pressed`. One Tab stop (the current
 * view); ← → Home End move to the other view and switch to it at once, as a segmented control does.
 * `onChange` gets whether the choice came from the keyboard, so focus can stay on the control.
 */
export default function DraftViewSwitch({ view, onChange, className }: {
  view: DraftView;
  onChange: (view: DraftView, fromKeyboard: boolean) => void;
  className?: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = OPTIONS.findIndex(option => option.value === view);
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? Math.min(OPTIONS.length - 1, index + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? Math.max(0, index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? OPTIONS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const group = event.currentTarget;
    if (next !== index) onChange(OPTIONS[next].value, true);
    requestAnimationFrame(() => group.querySelectorAll<HTMLButtonElement>('button')[next]?.focus());
  };
  const onClick = (value: DraftView) => (event: MouseEvent<HTMLButtonElement>) => {
    if (value !== view) onChange(value, event.detail === 0);
  };
  return <div className={['draft-view-switch', className].filter(Boolean).join(' ')} role="group" aria-label="文稿视图" data-view={view} onKeyDown={onKeyDown}>
    <span className="draft-view-switch__thumb" aria-hidden="true" />
    {OPTIONS.map(option => <button
      key={option.value}
      type="button"
      className="draft-view-switch__option"
      aria-pressed={view === option.value}
      tabIndex={view === option.value ? 0 : -1}
      title={option.title}
      onClick={onClick(option.value)}
    >{option.label}</button>)}
  </div>;
}
