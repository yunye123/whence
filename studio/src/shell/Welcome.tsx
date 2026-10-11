import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { FolderOpen, HardDrive, HelpCircle } from 'lucide-react';
import { EXAMPLES, type ExampleId } from '../templates';
import { MarkIcon, Wordmark } from '../icons/field-icons';
import { isDesktopWorkspace } from '../dialogs/display';
import { Words } from '../cards/Words';

export interface WelcomeProps {
  onOpenExample: (id: ExampleId) => void;
  /** Opens the existing new-board dialog (K4/K6). */
  onNewBoard: () => void;
  onOpenBoardFile?: () => void;
  onHelp?: () => void;
  storagePath?: string;
  onChangeLocation?: () => void;
  onDismiss?: () => void;
  /** Show only a shortcut actually wired by App. */
  newBoardShortcut?: string;
}

const SAMPLE = (file: string) => `/assets/samples/${file}`;
const MARK_SIZE = 28;
const QUOTE = '摊主说，四点出摊不是为了赚钱，是为了等头班公交的司机。';
const DEMO_MIN_SCALE = .8; // 16px demonstration text stays at least 12.8px on screen.
const READY_CAP_MS = 1200;

function Swatch({ id }: { id: ExampleId }) {
  if (id === 'writing') return <span className="wl-sw wl-sw--paper" aria-hidden="true">
    <span className="wl-sw__paper"><i/><i/><i/><i/><i/></span>
  </span>;
  if (id === 'video') return <span className="wl-sw wl-sw--video" aria-hidden="true">
    <span className="wl-sw__poster"><img src={EXAMPLES.find(item => item.id === 'video')?.cover} alt="" draggable={false}/></span>
    <span className="wl-sw__archive"><i/><i/></span>
  </span>;
  return <span className="wl-sw wl-sw--creative" aria-hidden="true">
    <span className="wl-sw__tab"/>
    <span className="wl-sw__prints"><img src={EXAMPLES.find(item => item.id === 'creative')?.cover} alt="" draggable={false}/><img src={SAMPLE('c-dawn-wide.webp')} alt="" draggable={false}/></span>
  </span>;
}

/** Decorative stamp in the aria-hidden demonstration; never a second, inactive product control. */
function DemoStamp() {
  return <span className="wl-stamp"><svg className="wl-stamp__icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3 13 8 5 13Z"/></svg><span>01:12–01:26</span></span>;
}

/** PLAN §2.8: three stationery entries and source → excerpt → paragraph five, on the quiet desk. */
export default function Welcome({ onOpenExample, onNewBoard, onOpenBoardFile, onHelp, storagePath, onChangeLocation, onDismiss, newBoardShortcut }: WelcomeProps) {
  const root = useRef<HTMLElement>(null);
  const demo = useRef<HTMLDivElement>(null);
  const [demoScale, setDemoScale] = useState(1);
  const [links, setLinks] = useState({ excerpt: '', used: '', labelY: 462 });
  const [settled, setSettled] = useState(false);
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    const container = root.current, box = demo.current;
    if (!container || !box) return;
    const draft = box.querySelector<HTMLElement>('.wl-draft');
    const contentHeight = draft ? draft.offsetTop + draft.offsetHeight + 12 : 660;
    // The footer wraps independently. Reserve its actual top instead of assuming a single line.
    const footer = container.querySelector<HTMLElement>('.welcome__foot');
    const available = (footer?.offsetTop ?? container.clientHeight - 86) - box.offsetTop - 24;
    setDemoScale(Math.min(1, Math.max(.55, available / contentHeight)));
    const video = box.querySelector<HTMLElement>('.wl-video');
    const quote = box.querySelector<HTMLElement>('.wl-quote');
    const paragraph = box.querySelector<HTMLElement>('.wl-draft__paragraph');
    const body = box.querySelector<HTMLElement>('.wl-draft__body');
    if (video && quote && draft && paragraph && body) {
      const vx = video.offsetLeft + 82, vy = video.offsetTop + video.offsetHeight;
      const qx = quote.offsetLeft, qy = quote.offsetTop + 24;
      const startX = quote.offsetLeft + 42, startY = quote.offsetTop + quote.offsetHeight;
      const endX = draft.offsetLeft + body.offsetLeft + paragraph.offsetLeft;
      const endY = draft.offsetTop + body.offsetTop + paragraph.offsetTop + paragraph.offsetHeight / 2;
      const next = { excerpt: `M${vx} ${vy}C${vx} ${vy + 24} ${qx - 24} ${qy} ${qx} ${qy}`, used: `M${startX} ${startY}C${startX} ${startY + 24} ${endX - 32} ${endY} ${endX} ${endY}`, labelY: startY + 12 };
      setLinks(current => current.excerpt === next.excerpt && current.used === next.used && current.labelY === next.labelY ? current : next);
    }
  }, []);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (root.current) observer.observe(root.current);
    if (demo.current) observer.observe(demo.current);
    const footer = root.current?.querySelector<HTMLElement>('.welcome__foot');
    if (footer) observer.observe(footer);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [measure]);

  // Wait for first-frame text and pictures, with the existing cap; controls remain keyboard accessible.
  useEffect(() => {
    let waiting = true;
    const go = () => { if (!waiting) return; waiting = false; measure(); setReady(true); };
    const cap = window.setTimeout(go, READY_CAP_MS);
    const frame = requestAnimationFrame(() => {
      const container = root.current;
      if (!container) return go();
      const fonts = document.fonts;
      const texts = [...container.querySelectorAll<HTMLElement>('.welcome__voice, .welcome__sub, .welcome__entry-copy strong, .welcome__entry-copy span, .wl-card h3, .wl-quote__text, .wl-draft__body')];
      const loads = fonts?.load ? texts.map(element => {
        const style = getComputedStyle(element);
        return fonts.load(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, element.textContent || '来处').catch(() => []);
      }) : [];
      const images = [...container.querySelectorAll('img')].map(image => image.decode?.().catch(() => undefined));
      void Promise.all([...loads, ...images]).then(() => fonts?.ready).then(go, go);
    });
    return () => { waiting = false; window.clearTimeout(cap); cancelAnimationFrame(frame); };
  }, [measure]);

  // Capture Escape before App can remove a modal: that key closes only the modal, keeping welcome.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const settle = () => { setReady(true); setSettled(true); };
    const key = (event: KeyboardEvent) => {
      settle();
      if (event.key === 'Escape' && !event.isComposing && !document.querySelector('.modal-backdrop, dialog[open]')) dismissRef.current?.();
    };
    window.addEventListener('pointerdown', settle, { once: true });
    window.addEventListener('wheel', settle, { once: true, passive: true });
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', settle); window.removeEventListener('wheel', settle); window.removeEventListener('keydown', key, true); };
  }, []);
  useEffect(() => {
    if (!ready || settled) return;
    const timer = window.setTimeout(() => setSettled(true), 700);
    return () => window.clearTimeout(timer);
  }, [ready, settled]);

  const desktopPath = storagePath?.trim();
  return <section ref={root} className={`welcome${ready ? ' is-ready' : ''}${settled ? ' is-settled' : ''}`} aria-labelledby="welcome-title">
    <header className="welcome__top">
      <span className="welcome__brand"><span className="welcome__mark"><MarkIcon size={MARK_SIZE}/></span><Wordmark height={19}/></span>
      <span className="welcome__top-actions">
        {onOpenBoardFile && <button type="button" className="btn" onClick={onOpenBoardFile}><FolderOpen size={16} aria-hidden="true"/>打开画布文件</button>}
        {onHelp && <button type="button" className="btn" onClick={onHelp}><HelpCircle size={16} aria-hidden="true"/>使用指南<kbd>?</kbd></button>}
      </span>
    </header>
    <div className="welcome__lead">
      <h1 className="welcome__title" id="welcome-title">
        <span className="welcome__voice welcome__voice--theirs">把收集来的<span className="welcome__halt">，</span></span>
        <span className="welcome__voice welcome__voice--mine">写成自己的<span className="welcome__halt">。</span></span>
      </h1>
      <Words as="p" className="welcome__sub" text="文字、视频和图片放在同一块画布上。摘下的每一句都系着出处，写进文稿以后，点一下就回到原文那一段、原片那一秒。"/>
      <div className="welcome__entries" role="group" aria-label="从一块示例画布开始">
        {EXAMPLES.map(example => <button type="button" key={example.id} className="template-card welcome__entry" data-stationery={example.id}
          aria-label={`${example.entry}：打开示例画布“${example.title}”`} onClick={() => onOpenExample(example.id)}>
          <Swatch id={example.id}/>
          <span className="welcome__entry-copy"><strong>{example.entry}</strong><span>{example.summary}</span></span>
        </button>)}
      </div>
    </div>
    <div ref={demo} className={`welcome__demo${demoScale < DEMO_MIN_SCALE ? ' is-too-small' : ''}`} aria-hidden="true" style={{ '--wl-scale': demoScale } as CSSProperties}>
      <svg className="wl-threads" viewBox="0 0 480 660" aria-hidden="true" focusable="false">
        <path className="wl-thread wl-thread--excerpt" d={links.excerpt}/>
        <path className="wl-thread wl-thread--used" d={links.used}/>
      </svg>
      <article className="wl-card wl-video">
        <div className="wl-video__poster"><img src={SAMPLE('v01-stall.webp')} alt="" draggable={false}/><span className="wl-video__play"/><span className="wl-video__dur">02:20</span></div>
        <div className="wl-video__body"><h3>凌晨四点的早餐摊</h3><p className="wl-video__meta">示例短片 · 逐字稿 23 句</p><p className="wl-video__source"><mark>{QUOTE}</mark></p></div>
      </article>
      <article className="wl-card wl-quote">
        <div className="wl-quote__head"><DemoStamp/><span>凌晨四点的早餐摊</span></div>
        <Words as="p" className="wl-quote__text" text={QUOTE}/>
      </article>
      <span className="wl-used-label" style={{ top: links.labelY }}>写进⑤</span>
      <article className="wl-card wl-draft">
        <h3>早餐摊 · 分镜脚本</h3>
        <p className="wl-draft__meta">第二稿</p>
        <div className="wl-draft__body"><span className="wl-draft__paragraph">5</span><p>这一段只靠老周一句话撑住：</p><p>“{QUOTE}”</p><DemoStamp/></div>
      </article>
    </div>
    <footer className="welcome__foot">
      <span className="welcome__hdd"><HardDrive size={16} aria-hidden="true"/></span>
      <p>{desktopPath ? <>这本记录只存在这台电脑上：<code>{desktopPath}</code>。没有账号，不会上传。</>
        : isDesktopWorkspace() ? <>这本记录只存在这台电脑上的来处工作区里。没有账号，不会上传。</>
          : <>这本记录只存在这台电脑的浏览器里。没有账号，不会上传。</>}</p>
      {desktopPath && onChangeLocation && <button type="button" className="welcome__link" onClick={onChangeLocation}>更改位置</button>}
      <button type="button" className="btn btn--line new-board" onClick={onNewBoard}>从空白画布开始{newBoardShortcut && <kbd>{newBoardShortcut}</kbd>}</button>
    </footer>
  </section>;
}
