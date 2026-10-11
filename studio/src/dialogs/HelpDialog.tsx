import { Fragment, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { SHORTCUT_GROUPS, chordKeys, isMacPlatform, shortcutLabel, visibleShortcuts, type ShortcutDef } from './shortcuts';
import { isDesktopWorkspace } from './display';

/** 构建时由 vite.config.ts 的 define 注入（package.json 版本、构建日期、短提交号）；测试与未注入时没有。 */
declare const __FIELD_BUILD__: { version: string; date: string; commit: string } | undefined;
const build = typeof __FIELD_BUILD__ === 'undefined' ? undefined : __FIELD_BUILD__;

/** 产品名（2026-10-07 起由原野改名为来处）。英文副名 whence 全小写，只作副标。 */
const PRODUCT_NAME = '来处';
const PRODUCT_NAME_EN = 'whence';

/** “来处 whence 0.1.0 · 2026-10-07”：反馈问题或核对日常入口是否更新时，用户能确认自己在用哪一版（DLG-23）。 */
export function buildLabel(info = build): string {
  const name = `${PRODUCT_NAME} ${PRODUCT_NAME_EN}`;
  return info ? [name, [info.version, info.date].filter(Boolean).join(' · ')].filter(Boolean).join(' ') : name;
}

function Keys({ item, mac }: { item: ShortcutDef; mac: boolean }) {
  const chords = item.id === 'nudge' ? [item.chords[0], item.chords[1], item.chords[2], item.chords[3]] : item.chords;
  return <span className="help-keys">
    {item.id === 'nudge'
      ? <span className="help-chord">{chords.map(chord => <kbd key={chord.key}>{chordKeys(chord, mac).at(-1)}</kbd>)}</span>
      : chords.map((chord, index) => <Fragment key={`${chord.key}-${index}`}>
        {index > 0 && <span className="help-or">或</span>}
        <span className="help-chord">{chord.hold && <span className="help-hold">按住</span>}{chordKeys(chord, mac).map(key => <kbd key={key}>{key}</kbd>)}</span>
      </Fragment>)}
    {item.note && <span className="help-note">{item.note}</span>}
  </span>;
}

/**
 * Content of the “使用指南” modal (§6.26, FD-m1): 收集 / 整理 / 阅读与观看 / 写作 / 交付，每组左边一句做法、
 * 右边这一步用得到的按键。按键表来自 `shortcuts.ts`，与键盘处理同一份描述。
 */
export default function HelpDialog({ storagePath }: { storagePath?: string } = {}) {
  const mac = isMacPlatform();
  const desktop = isDesktopWorkspace();
  // 桌面专属的键（Ctrl N 新建画布）只在桌面版列出：浏览器把它留给“新窗口”（CHROME-19）。
  const shortcuts = visibleShortcuts(desktop);
  const [copied, setCopied] = useState(false);
  const label = buildLabel();
  const copyDiagnostics = () => {
    const lines = [label + (build?.commit ? `（${build.commit}）` : ''), desktop ? '桌面版' : `浏览器版 · ${navigator.userAgent}`];
    void navigator.clipboard?.writeText(lines.join('\n')).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }).catch(() => {});
  };
  return (
    <>
      <header className="modal-header">
        <h2 id="modal-title" className="modal-title">使用指南</h2>
        <p className="modal-subtitle">从收来的素材，到写成的作品。输入文字时，按键交给编辑器。</p>
      </header>
      {/* 正文是一个可聚焦区域（DLG-12）：打开时焦点落在这里，↓、PageDown、End 能读到底部的存储提醒和“关于”；
          不落在最后一个按钮上，打开时也就不会先滚到底。 */}
      <div className="modal-body help-guide" tabIndex={0} role="region" aria-label="使用指南内容">
        {SHORTCUT_GROUPS.filter(group => group.id !== 'anytime').map(group => {
          const items = shortcuts.filter(item => item.group === group.id);
          return <section className={`help-group help-group--${group.id}`} key={group.id} aria-labelledby={`help-${group.id}`}>
            <div className="help-group__lead">
              <h3 id={`help-${group.id}`}>{group.title}</h3>
              <p>{group.summary}{group.id === 'collect' && `按 ${shortcutLabel('search', mac)} 可以在全部画布里找素材，也能直接执行命令。`}{group.id === 'organize' && '顶栏的“大纲”按文稿的小标题列出每一节引用了哪些摘录。'}</p>
            </div>
            <dl className="help-group__keys">
              {items.map(item => <div className="help-row" key={item.id}><dt>{item.label}</dt><dd><Keys item={item} mac={mac}/></dd></div>)}
            </dl>
          </section>;
        })}
        <p className="help-storage">
          <HardDrive size={15} aria-hidden="true"/>
          <span>
            {storagePath
              ? <>这本记录只存在这台电脑上：<code>{storagePath}</code>。没有账号，不会上传。</>
              : desktop
                ? <>这本记录只存在这台电脑上的来处工作区里。没有账号，不会上传。</>
                : <>这本记录只存在这个浏览器里，不会上传。清理浏览器数据前，先从“导出”另存便携画布文件。</>}
          </span>
        </p>
        {/* The canvas carries no React Flow mark (agreed 2026-10-06); the credit lives here and in THIRD_PARTY_NOTICES.txt. */}
        <section className="help-group help-group--about" aria-labelledby="help-about">
          <div className="help-group__lead">
            <h3 id="help-about">关于</h3>
            <p><span className="help-version" title={build?.commit ? `提交 ${build.commit}` : undefined}>{label}</span>，在本机运行的创作画布。</p>
            {build && <button type="button" className="btn btn--line btn--sm help-copy" onClick={copyDiagnostics}>{copied ? '已复制' : '复制版本信息'}</button>}
          </div>
          <div>
            <p className="help-about">无限画布基于 React Flow 构建（MIT 许可），感谢 xyflow 团队。</p>
            <p className="help-about">其他开源组件及其许可，见程序目录里的 THIRD_PARTY_NOTICES.txt。</p>
            <p className="help-about">2026-10-07 起由“原野”改名为“来处”。原来的画布、设置和导出的便携画布文件都照常可用。</p>
          </div>
        </section>
      </div>
      <footer className="modal-footer help-anytime" aria-label="随时可用的按键">
        <span className="help-anytime__title">随时</span>
        {shortcuts.filter(item => item.group === 'anytime').map(item => <span className="help-anytime__item" key={item.id}><Keys item={item} mac={mac}/><span>{item.label}</span></span>)}
      </footer>
    </>
  );
}
