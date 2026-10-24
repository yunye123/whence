import { useEffect, useRef } from 'react';
import { ArrowDownToLine, ChevronRight, Film, FolderOpen, HardDrive, Link2, Plus, Upload } from 'lucide-react';
import XImportPanel from '../XImportPanel';
import { sharedLinks, videoPlatform, VIDEO_BATCH_LIMIT } from '../app/video-links';
import type { LinkMode } from '../app/types';
import { ArticleIcon, ImageIcon, VideoIcon, XLogoIcon } from '../icons/field-icons';
import { isMacPlatform } from './shortcuts';
import { Words } from '../cards/Words';

export interface ImportDialogProps {
  mode: LinkMode;
  onModeChange: (mode: LinkMode) => void;
  value: string;
  /** Video / web textarea edits (may switch the mode to X when an X link is pasted). */
  onTextChange: (value: string) => void;
  /** X panel edits. */
  onXTextChange: (value: string) => void;
  error: string;
  xProgress: string;
  xCommitting: boolean;
  xAvailable: boolean;
  videoAvailable: boolean;
  native: boolean;
  readOnly: boolean;
  busy: boolean;
  onPickFiles: () => void;
  /** Submits the textarea: queue videos in video mode, collect web pages otherwise. */
  onSubmitLink: () => void;
  onImportX: () => void;
  onCancelX: () => void;
  onRestoreBoardFile: () => void;
  onOpenLocalBoard: () => void;
  onRunNative: (action: 'project' | 'files') => void;
}

const LINK_MODES: readonly { mode: LinkMode; label: string; icon: typeof Link2 | typeof VideoIcon }[] = [
  { mode: 'video', label: '视频链接', icon: VideoIcon },
  { mode: 'x', label: 'X 推文', icon: XLogoIcon },
  { mode: 'web', label: '网页资料', icon: Link2 },
];

/** “识别到 2 个链接：抖音、B 站”：只显示一条，平台名直接写出来（IM-m1）。 */
function detectedLinks(value: string, mode: LinkMode): string {
  const links = sharedLinks(value);
  if (!links.length) return '粘贴包含 http 或 https 的完整链接';
  const platforms = mode === 'video' ? [...new Set(links.map(videoPlatform))].slice(0, 4) : [];
  const over = links.length > VIDEO_BATCH_LIMIT ? `，请分成每批 ${VIDEO_BATCH_LIMIT} 个以内` : '';
  return `识别到 ${links.length} 个链接${platforms.length ? `：${platforms.join('、')}` : ''}${over}`;
}

/**
 * Content of the “导入素材” modal (§6.20, IM-M1): 本机文件 → 链接 → 画布文件，三块分开写清楚。
 * 当前环境不可用的链接方式排在后面并写明原因；默认停在第一个可用的方式上。
 */
export default function ImportDialog({ mode, onModeChange, value, onTextChange, onXTextChange, error, xProgress, xCommitting, xAvailable, videoAvailable, native, readOnly, busy, onPickFiles, onSubmitLink, onImportX, onCancelX, onRestoreBoardFile, onOpenLocalBoard, onRunNative }: ImportDialogProps) {
  const available = (item: LinkMode) => item === 'video' ? videoAvailable : item === 'x' ? xAvailable : true;
  const ordered = [...LINK_MODES.filter(item => available(item.mode)), ...LINK_MODES.filter(item => !available(item.mode))];
  // 浏览器里默认不停在用不了的“视频链接”（IM-M1）。粘贴触发的打开（带文字或错误说明）保持原样。
  const initial = useRef({ mode, value, error });
  useEffect(() => {
    const start = initial.current;
    if (!available(start.mode) && !start.value.trim() && !start.error) onModeChange(ordered[0].mode);
  }, []);

  const linkUnavailable = !available(mode);
  const pending = !!xProgress;
  return (
    <>
      <header className="modal-header">
        <h2 id="modal-title" className="modal-title">导入素材</h2>
        <p className="modal-subtitle">放进当前画布，原样保留来源。</p>
      </header>
      <div className="modal-body import-dialog">
        <section className="imp-section" aria-labelledby="imp-files-title">
          <h3 className="dialog-section-title" id="imp-files-title">本机文件</h3>
          <button type="button" className="imp-drop" disabled={readOnly || busy} onClick={() => onPickFiles()}>
            <span className="imp-drop__icons" aria-hidden="true"><ArticleIcon size={20}/><ImageIcon size={20}/><VideoIcon size={20}/></span>
            <span className="imp-drop__copy">
              <strong>选择文件</strong>
              {/* Breaks between words (§3.4): never “视 / 频”. */}
              <Words text="文字资料（TXT、Markdown，10 万字以内，常见中文编码都能识别）、图片和视频，单个媒体不超过 64 MB。也可以直接拖进画布。" />
            </span>
            <Upload className="imp-drop__go" size={16} aria-hidden="true"/>
          </button>
        </section>

        <section className="imp-section" aria-labelledby="imp-links-title">
          <h3 className="dialog-section-title" id="imp-links-title">链接</h3>
          <div className="imp-tabs seg-ctl" role="group" aria-label="链接导入方式">
            {ordered.map(item => {
              const Icon = item.icon;
              const off = !available(item.mode);
              return <button type="button" key={item.mode} disabled={pending} aria-label={item.label} aria-pressed={mode === item.mode}
                className={off ? 'is-unavailable' : undefined} title={off ? `${item.label}需要来处桌面版` : undefined}
                onClick={() => onModeChange(item.mode)}>
                <Icon size={15} aria-hidden="true"/>{item.label}{off && <small aria-hidden="true">需要桌面版</small>}
              </button>;
            })}
          </div>
          {mode === 'x' ? (
            <XImportPanel value={value} onChange={onXTextChange} onImport={onImportX} onCancel={onCancelX} available={xAvailable} busy={pending} committing={xCommitting} progress={xProgress} error={error} readOnly={readOnly}/>
          ) : (
            <div className="imp-link">
              <label className="dialog-field">
                <span>{mode === 'video' ? '视频链接或平台分享文案' : '网页链接或分享文案'}</span>
                <textarea
                  autoFocus
                  aria-label={mode === 'video' ? '视频链接或分享文案' : '网页链接或分享文案'}
                  placeholder={mode === 'video' ? '粘贴抖音、小红书、B 站、YouTube 的分享文案或视频链接' : '粘贴网页链接或分享文字。会抓取可读正文；抓不到时只保存链接'}
                  value={value}
                  maxLength={20000}
                  onChange={event => onTextChange(event.target.value)}
                  onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (!linkUnavailable) onSubmitLink(); } }}
                />
              </label>
              {value.trim() && <p className="imp-detected" role="status">{detectedLinks(value, mode)}</p>}
              {linkUnavailable && (
                <div className="imp-notice"><HardDrive size={15} aria-hidden="true"/>
                  <div className="imp-notice__copy">
                    <p>自动下载与逐字稿需要来处桌面版。浏览器里可以改存为网页资料，或用上面的“选择文件”导入本机视频。</p>
                    <p className="imp-notice__aside">字幕（SRT、VTT）在视频导入以后加：点视频卡片上的“导入字幕”，或选中视频后点“添加 → 字幕文件…”。</p>
                  </div>
                </div>
              )}
              {error && <p className="dialog-error imp-error" role="alert">{error}</p>}
              <div className="imp-submit">
                {/* 快捷键提示与按钮同一个动词；用不了的方式不写按不出来的快捷键（DLG-15）。 */}
                <span className="dialog-hint">
                  {linkUnavailable ? null : mode === 'video' ? `每次最多 ${VIDEO_BATCH_LIMIT} 个。下载好就能播放，逐字稿在后台继续。` : <><kbd>{isMacPlatform() ? '⌘' : 'Ctrl'}</kbd> <kbd>Enter</kbd> 保存</>}
                </span>
                {linkUnavailable
                  ? <button type="button" className="btn btn--line" disabled={readOnly} onClick={() => onModeChange('web')}><Link2 size={15} aria-hidden="true"/>改存为网页资料</button>
                  : <button type="button" className="btn btn--primary" disabled={readOnly || !value.trim()} onClick={() => onSubmitLink()}>
                    {mode === 'video' ? <><ArrowDownToLine size={15} aria-hidden="true"/>下载并提取逐字稿</> : <><Plus size={15} aria-hidden="true"/>保存网页资料</>}
                  </button>}
              </div>
            </div>
          )}
        </section>

        {/* No region name here: “画布文件” is the hidden file input's contract name (K4), and two elements may not share it. */}
        <section className="imp-section">
          <h3 className="dialog-section-title" id="imp-board-title">画布文件</h3>
          <div className="import-other">
            {/* 可见文字与欢迎页统一为“打开画布文件”；读屏名“恢复画布文件”是 K4 契约，保留。 */}
            <button type="button" aria-label="恢复画布文件" disabled={readOnly || busy} onClick={() => onRestoreBoardFile()}>
              <span className="imp-row__label">打开画布文件</span>
              <span className="imp-row__note">来处导出的画布文件，连同素材与布局</span>
              <ChevronRight size={16} aria-hidden="true"/>
            </button>
            {native && (
              <>
                <button type="button" onClick={() => onOpenLocalBoard()} disabled={busy}><span className="imp-row__label">打开本机画布</span><span className="imp-row__note">选择一个来处的画布文件夹</span><FolderOpen size={16} aria-hidden="true"/></button>
                <button type="button" onClick={() => onRunNative('project')} disabled={busy}><span className="imp-row__label">导入原有参考项目</span><span className="imp-row__note">读取本机项目、转写与摘录</span><ChevronRight size={16} aria-hidden="true"/></button>
                <button type="button" onClick={() => onRunNative('files')} disabled={busy}><span className="imp-row__label">桌面媒体工具</span><span className="imp-row__note">导入本机文件、检测媒体、本机转写</span><Film size={16} aria-hidden="true"/></button>
              </>
            )}
          </div>
          {!native && <p className="dialog-hint imp-desktop-note">桌面版另有：打开本机画布文件夹、导入原有参考项目、在本机转写视频。</p>}
        </section>
      </div>
    </>
  );
}
