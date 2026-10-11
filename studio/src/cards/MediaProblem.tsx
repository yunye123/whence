import type { MouseEvent } from 'react';
import { CircleAlert, FileSearch, RotateCcw, Replace } from 'lucide-react';
import type { CardActions } from '../board-context';
import type { CardData } from '../model';
import { cardExtras, type CardActivate } from './types';

/**
 * What is wrong with a card's picture or film, said once on the card (§6.8 失败, CORE-08):
 * - `missing`: the stored file is not where it was (cache says missing) — it may come back: “重新读取”.
 * - `unreadable`: reading the stored file failed — try again: “重新读取”.
 * - `undecodable`: the file is there but the browser cannot show or play it (a damaged or unsupported file,
 *   the same case the import now refuses with “无法解码，可能已损坏”). Reading it again changes nothing, so the
 *   one way forward is another file (“换一张图片 / 换一个视频” once App offers replaceMedia), else the details.
 */
export type MediaProblemKind = 'missing' | 'unreadable' | 'undecodable';

export function mediaProblemKind(mediaError: boolean, status?: 'loading' | 'ready' | 'missing' | 'error'): MediaProblemKind | undefined {
  if (status === 'missing') return 'missing';
  if (status === 'error') return 'unreadable';
  return mediaError ? 'undecodable' : undefined;
}

const MESSAGES: Record<'image' | 'video', Record<MediaProblemKind, string>> = {
  image: { missing: '图片未找到', unreadable: '图片读取失败', undecodable: '这张图片无法显示' },
  video: { missing: '视频未找到', unreadable: '视频读取失败', undecodable: '这段视频无法播放' },
};
/** Why, for the reason's tooltip: the same words the import and the details panel use. */
const DETAILS: Record<MediaProblemKind, string> = {
  missing: '原文件可能已被移动或删除。重新读取，或换一个文件。',
  unreadable: '读取这个文件时出错。重新读取，或换一个文件。',
  undecodable: '文件可能已损坏或格式不受支持，重新读取也无法显示。换一个文件再试。',
};

export interface MediaProblemAction {
  label: string;
  /** Accessible name: “<动作>：<标题>” like every card action (K4 `重新读取：` / `检查素材：`). */
  name: string;
  kind: 'retry' | 'replace' | 'inspect';
  run: () => void;
}

/** Copy and the one action for a media problem on this card. */
export function mediaProblem(kind: 'image' | 'video', problem: MediaProblemKind, id: string, data: CardData, board: CardActions, openCard: () => void, clearError: () => void) {
  const title = data.title || '未命名';
  const replace = cardExtras(board).replaceMedia;
  let action: MediaProblemAction | undefined;
  if (problem !== 'undecodable' && board.retryMedia && data.mediaId) {
    const retry = board.retryMedia;
    action = { label: '重新读取', name: `重新读取：${title}`, kind: 'retry', run: () => { clearError(); retry(data.mediaId!); } };
  } else if (replace && !board.readOnly) {
    const label = kind === 'image' ? '换一张图片' : '换一个视频';
    action = { label, name: `${label}：${title}`, kind: 'replace', run: () => replace(id) };
  } else {
    action = { label: '检查素材', name: `检查素材：${title}`, kind: 'inspect', run: openCard };
  }
  return { message: MESSAGES[kind][problem], detail: DETAILS[problem], action };
}

/** One reason and one action inside the media area (§6.8 失败). */
export function MediaProblem({ message, detail, action, activate }: {
  message: string;
  detail?: string;
  action?: MediaProblemAction;
  activate: CardActivate;
}) {
  const Icon = action?.kind === 'replace' ? Replace : action?.kind === 'inspect' ? FileSearch : RotateCcw;
  return (
    <div className="field-card__problem nodrag nowheel" role="status">
      <span className="field-card__problem-text" title={detail}><CircleAlert size={14} aria-hidden="true" /><span>{message}</span></span>
      {action && (
        <button className="field-card__btn" onClick={(event: MouseEvent) => activate(event, action.run)} aria-label={action.name} title={detail}>
          <Icon size={13} aria-hidden="true" />
          {action.label}
        </button>
      )}
    </div>
  );
}
