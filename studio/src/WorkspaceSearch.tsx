import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { FilePlus2, Frame, HelpCircle, Link2, ListTree, Lock, Maximize, Search, Share, Upload, X } from 'lucide-react';
import InspectorDialog from './InspectorDialog';
import { timecode } from './model';
import type { BoardNode, CardKind, Workspace } from './model';
import { MAX_SPOTS, createWorkspaceSearchIndex, searchWorkspace } from './workspace-search';
import type { SearchField, SearchScope, WorkspaceSearchHit } from './workspace-search';
import { ArticleIcon, DraftIcon, ImageIcon, NoteIcon, QuoteIcon, VideoIcon } from './icons/field-icons';
import ProvenanceTag from './components/ProvenanceTag';
import { paragraphIndexAt } from './source-location';
import { matchText, mergeRanges, readableExcerpt } from './dialogs/search-text';
import { cardTitle, isTextSource, kindDisplay, quoteLocation } from './dialogs/display';
import { shortcutLabel } from './dialogs/shortcuts';

type SearchCommand = 'note' | 'draft' | 'import' | 'new-board' | 'fit';
/** 需要 App 额外接线的命令（集成请求）；没有 `onExtraCommand` 时不显示。 */
type ExtraCommand = 'export' | 'help' | 'outline';
type Kind = 'all' | 'cards' | 'source' | 'commands';
type Range = { start: number; end: number };

interface CommandDef { id: SearchCommand | ExtraCommand; title: string; description: string; aliases: string[]; shortcut?: string; icon: typeof Search | typeof NoteIcon; extra?: boolean; writes?: boolean }
const COMMANDS: readonly CommandDef[] = [
  { id: 'note', title: '新建笔记', description: '在可见画布中央记下一条想法', aliases: ['笔记', '想法', 'note'], shortcut: 'add-note', icon: NoteIcon, writes: true },
  { id: 'draft', title: '新建文稿', description: '开始一篇可以引用摘录的文稿', aliases: ['文稿', '写作', '脚本', 'draft'], shortcut: 'add-draft', icon: DraftIcon, writes: true },
  { id: 'import', title: '导入素材', description: '本机文件、视频链接、网页或 X 推文', aliases: ['导入', '文件', '链接', '视频', '图片', '字幕', 'import'], icon: Upload, writes: true },
  { id: 'new-board', title: '新建画布', description: '从空白画布或一个起点模板开始', aliases: ['画布', '模板', 'board'], icon: FilePlus2, writes: true },
  { id: 'fit', title: '查看全部', description: '让当前画布上的卡片完整可见', aliases: ['显示全部', '缩放', '全部卡片', 'fit'], shortcut: 'fit', icon: Maximize },
  { id: 'export', title: '导出', description: '文稿、灵感板或便携画布文件', aliases: ['导出', '下载', '灵感板', 'pdf', 'png', 'markdown', 'export'], icon: Share, extra: true },
  { id: 'outline', title: '切换大纲', description: '按文稿的小标题查看每节引用了什么', aliases: ['大纲', '结构', 'outline'], icon: ListTree, extra: true },
  { id: 'help', title: '使用指南', description: '收集、整理、写作、交付与全部快捷键', aliases: ['帮助', '快捷键', '指南', 'help'], shortcut: 'help', icon: HelpCircle, extra: true },
];

const kindLabel = kindDisplay;
function KindGlyph({ kind, node }: { kind: CardKind; node?: BoardNode }) {
  if (isTextSource(node)) return <ArticleIcon size={18}/>;
  if (kind === 'video') return <VideoIcon size={18}/>;
  if (kind === 'image') return <ImageIcon size={18}/>;
  if (kind === 'quote') return <QuoteIcon size={18}/>;
  if (kind === 'draft') return <DraftIcon size={18}/>;
  if (kind === 'link') return <Link2 size={18} strokeWidth={1.75} aria-hidden="true"/>;
  if (kind === 'frame') return <Frame size={18} strokeWidth={1.75} aria-hidden="true"/>;
  return <NoteIcon size={18}/>;
}

const SOURCE_FIELDS: ReadonlySet<SearchField> = new Set(['body', 'citation', 'transcript', 'originalTranscript']);
const SCOPES: readonly { id: Kind; label: string }[] = [{ id: 'all', label: '全部' }, { id: 'cards', label: '卡片' }, { id: 'source', label: '原文' }, { id: 'commands', label: '命令' }];

/** Text stays ordinary React text (markup-like input is never parsed); ranges are UTF-16 positions in `text`. */
function highlighted(text: string, ranges: readonly Range[]): ReactNode {
  const fragments: ReactNode[] = [];
  let cursor = 0;
  for (const range of mergeRanges(ranges)) {
    const start = Math.max(cursor, Math.min(text.length, range.start)), end = Math.max(start, Math.min(text.length, range.end));
    if (start > cursor) fragments.push(text.slice(cursor, start));
    if (end > start) fragments.push(<mark key={`${start}-${end}`}>{text.slice(start, end)}</mark>);
    cursor = end;
  }
  if (cursor < text.length) fragments.push(text.slice(cursor));
  return fragments;
}

/** 原文位置的出处印：视频写时间，文字写第几段（DESIGN_SYSTEM §6.7）。 */
function hitLocation(hit: WorkspaceSearchHit, node?: BoardNode, nodes?: ReadonlyMap<string, BoardNode>): string | undefined {
  if (typeof hit.time === 'number' && Number.isFinite(hit.time)) return timecode(hit.time);
  if (node?.data.kind === 'quote') return quoteLocation(node.data, node.data.citation ? nodes?.get(node.data.citation.nodeId)?.data.body : undefined);
  if (hit.field !== 'body' || !node || node.data.kind === 'draft') return undefined;
  // 每一处命中带自己的段号（DLG-02）：按命中的绝对位置算，不再从摘要反查（同一段文字可能在正文里出现多次）。
  if (typeof hit.bodyStart === 'number') {
    const paragraph = paragraphIndexAt(node.data.body, hit.bodyStart);
    return paragraph ? `第 ${paragraph} 段` : undefined;
  }
  const body = node.data.body.replace(/\r\n?/g, '\n');
  const core = hit.excerpt.replace(/^…/, '').replace(/…$/, '');
  const at = body.indexOf(core);
  if (at < 0) return undefined;
  const first = hit.ranges[0]?.start ?? 0;
  const paragraph = paragraphIndexAt(body, at + Math.max(0, first - (hit.excerpt.startsWith('…') ? 1 : 0)));
  return paragraph ? `第 ${paragraph} 段` : undefined;
}

type Entry =
  | { type: 'command'; key: string; command: CommandDef; ranges: Range[]; disabled: boolean }
  | { type: 'hit'; key: string; hit: WorkspaceSearchHit; node?: BoardNode; group: 'cards' | 'source' | 'board' };

export default function WorkspaceSearch({ workspace, readOnly, onClose, onSelect, onCommand, onExtraCommand }: {
  workspace: Workspace;
  readOnly: boolean;
  onClose: () => void;
  onSelect: (hit: WorkspaceSearchHit) => void;
  onCommand: (command: SearchCommand) => void;
  /** 导出、使用指南、切换大纲（App 接线后出现）。 */
  onExtraCommand?: (command: ExtraCommand) => void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [boardOnly, setBoardOnly] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const id = useId();
  const listId = `${id}-results`;
  const helpId = `${id}-help`;
  const scope: SearchScope = boardOnly ? 'board' : 'workspace';
  const index = useMemo(() => createWorkspaceSearchIndex(workspace), [workspace]);
  const nodes = useMemo(() => new Map(workspace.boards.flatMap(board => board.nodes.map(node => [node.id, node] as const))), [workspace]);
  const currentBoard = workspace.boards.find(board => board.id === workspace.activeBoardId);
  const result = useMemo(() => searchWorkspace(index, query, { scope, boardId: workspace.activeBoardId, limit: 60 }), [index, query, scope, workspace.activeBoardId]);
  const hasQuery = result.query.length > 0;

  const groups = useMemo(() => {
    const commands = COMMANDS.filter(command => !command.extra || onExtraCommand).flatMap(command => {
      if (!hasQuery) return [{ command, ranges: [] as Range[], score: 0 }];
      const match = matchText(query, command.title, [...command.aliases, command.description]);
      return match ? [{ command, ranges: match.ranges, score: match.score }] : [];
    }).sort((a, b) => b.score - a.score).slice(0, hasQuery ? 4 : 8);
    const commandEntries: Entry[] = commands.map(({ command, ranges }) => ({ type: 'command', key: `command-${command.id}`, command, ranges, disabled: !!command.writes && readOnly }));
    const cards: Entry[] = [], source: Entry[] = [];
    if (hasQuery) {
      for (const hit of result.hits) {
        const entry: Entry = { type: 'hit', key: `${hit.boardId}-${hit.nodeId}-${hit.spot ?? 0}`, hit, node: nodes.get(hit.nodeId), group: SOURCE_FIELDS.has(hit.field) ? 'source' : 'cards' };
        (entry.group === 'source' ? source : cards).push(entry);
      }
    } else if (currentBoard) {
      // 默认分组：命令，加上当前画布最近的几张卡片，打开即可跳过去。
      for (const node of currentBoard.nodes.filter(item => item.data.kind !== 'frame').slice(-6).reverse()) {
        const title = cardTitle(node);
        cards.push({ type: 'hit', key: `recent-${node.id}`, node, group: 'board', hit: { boardId: currentBoard.id, boardTitle: currentBoard.title, nodeId: node.id, kind: node.data.kind, title, field: 'title', excerpt: node.data.citation?.text || node.data.body.slice(0, 160), ranges: [] } });
      }
    }
    const visible: { id: string; title: string; entries: Entry[] }[] = [];
    if ((kind === 'all' || kind === 'commands') && commandEntries.length) visible.push({ id: 'commands', title: '命令', entries: commandEntries });
    if ((kind === 'all' || kind === 'cards') && cards.length) visible.push({ id: 'cards', title: hasQuery ? '卡片' : `本画布最近的卡片`, entries: cards });
    if ((kind === 'all' || kind === 'source') && source.length) visible.push({ id: 'source', title: '原文位置', entries: source });
    return visible;
  }, [hasQuery, query, result.hits, nodes, currentBoard, kind, readOnly, onExtraCommand]);
  const entries = useMemo(() => groups.flatMap(group => group.entries), [groups]);
  /** 列出来的卡片数（同一张卡片的几处命中只算一张）。 */
  const shownCards = useMemo(() => new Set(result.hits.map(hit => `${hit.boardId}-${hit.nodeId}`)).size, [result.hits]);
  const enabled = entries.map((entry, position) => entry.type === 'hit' || !entry.disabled ? position : -1).filter(position => position >= 0);
  const activeId = active !== null && enabled.includes(active) ? `${id}-option-${active}` : undefined;

  useEffect(() => { setActive(hasQuery && enabled.length ? enabled[0] : null); }, [query, kind, boardOnly, index, readOnly]);
  useEffect(() => {
    const count = entries.filter(entry => entry.type === 'hit').length;
    const message = hasQuery ? `${boardOnly ? '当前画布' : '全部画布'}，找到 ${result.total} 张卡片${shownCards < result.total ? `，显示前 ${shownCards} 张` : ''}，${entries.length - count} 个命令` : `${entries.filter(entry => entry.type === 'command').length} 个常用命令`;
    const timer = window.setTimeout(() => setAnnouncement(message), 250);
    return () => window.clearTimeout(timer);
  }, [hasQuery, entries, result.total, boardOnly, shownCards]);
  useEffect(() => {
    if (!activeId) return;
    const option = document.getElementById(activeId);
    if (option && listRef.current?.contains(option)) option.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  function execute(entry: Entry | undefined) {
    if (!entry || composing.current) return;
    if (entry.type === 'hit') { onSelect(entry.hit); return; }
    if (entry.disabled) return;
    if (entry.command.extra) onExtraCommand?.(entry.command.id as ExtraCommand);
    else onCommand(entry.command.id as SearchCommand);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
    // Tab 在面板里首尾循环（DLG-22）：对话框自带的关闭按钮是隐藏的，不能当作循环的起点。
    if (event.key === 'Tab') {
      const stops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, [tabindex]'))
        .filter(element => element.tabIndex >= 0 && !element.hasAttribute('disabled') && element.getClientRects().length > 0);
      const first = stops[0], last = stops.at(-1), current = document.activeElement as HTMLElement | null;
      if (!first || !last) return;
      if (event.shiftKey && (current === first || !current || !stops.includes(current))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && current === last) { event.preventDefault(); first.focus(); }
      return;
    }
    const target = event.target as HTMLElement;
    const targetOption = target.closest<HTMLElement>('[role="option"]');
    if (target !== inputRef.current && !targetOption) return;
    const current = targetOption ? Number(targetOption.dataset.searchPosition) : active;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (!enabled.length) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if ((event.key === 'Home' || event.key === 'End') && target === inputRef.current) return;
      event.preventDefault();
      const position = current === null ? -1 : enabled.indexOf(current);
      const next = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1)! : event.key === 'ArrowDown'
        ? enabled[position < 0 ? 0 : (position + 1) % enabled.length]
        : enabled[position < 0 ? enabled.length - 1 : (position - 1 + enabled.length) % enabled.length];
      setActive(next);
      inputRef.current?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      execute(entries[current !== null && enabled.includes(current) ? current : enabled[0]]);
    }
  }

  let position = -1;
  return <InspectorDialog title="搜索与命令" className="workspace-search" closeLabel="关闭搜索与命令" onCancel={onClose}>
    <section className="workspace-search__content ws" onKeyDown={handleKeyDown}>
      <div className="ws-input">
        <Search size={20} aria-hidden="true"/>
        <input ref={inputRef} data-autofocus type="search" role="combobox" aria-label="搜索材料" aria-controls={listId} aria-expanded="true"
          aria-autocomplete="list" aria-activedescendant={activeId} aria-describedby={helpId} autoComplete="off" spellCheck={false}
          value={query} placeholder="找一张卡片、一句字幕，或输入命令" onChange={event => setQuery(event.target.value)}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}/>
        {query.length > 0 && <button type="button" className="ws-clear icon-btn" aria-label="清空搜索" onClick={() => { setQuery(''); inputRef.current?.focus(); }}><X size={16} aria-hidden="true"/></button>}
        <button type="button" className="ws-esc" aria-label="关闭搜索与命令" onClick={onClose}><kbd>Esc</kbd></button>
      </div>
      <div className="ws-scope">
        <div className="ws-chips" role="radiogroup" aria-label="搜索范围">
          {SCOPES.map(item => <button type="button" role="radio" key={item.id} aria-checked={kind === item.id} tabIndex={kind === item.id ? 0 : -1}
            onClick={() => setKind(item.id)}
            onKeyDown={event => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (!step) return;
              event.preventDefault(); event.stopPropagation();
              const next = SCOPES[(SCOPES.findIndex(scopeItem => scopeItem.id === kind) + step + SCOPES.length) % SCOPES.length];
              setKind(next.id);
              (event.currentTarget.parentElement?.querySelector(`[data-scope="${next.id}"]`) as HTMLElement | null)?.focus();
            }} data-scope={item.id}>{item.label}</button>)}
        </div>
        <button type="button" className="ws-board-only" aria-pressed={boardOnly} onClick={() => setBoardOnly(value => !value)} title={currentBoard?.title}>
          只看当前画布{boardOnly && currentBoard ? <span className="ws-board-name">「{currentBoard.title}」</span> : null}
        </button>
      </div>
      <div ref={listRef} id={listId} className="ws-results" role="listbox" aria-label={hasQuery ? '搜索结果' : '常用命令'}>
        {groups.map(group => <div className="ws-group" role="group" aria-labelledby={`${id}-${group.id}`} key={group.id}>
          <div className="ws-group__title" id={`${id}-${group.id}`} role="presentation">{group.title}
            {group.id !== 'commands' && hasQuery && result.total > shownCards && <span>显示前 {shownCards} 张，共 {result.total} 张</span>}
          </div>
          {group.entries.map(entry => {
            position += 1;
            const at = position;
            const selected = active === at;
            const hover = () => { if (!composing.current && !(entry.type === 'command' && entry.disabled)) setActive(at); };
            if (entry.type === 'command') {
              const Icon = entry.command.icon;
              const keys = entry.command.shortcut ? shortcutLabel(entry.command.shortcut) : undefined;
              return <div key={entry.key} id={`${id}-option-${at}`} role="option" data-search-position={at} aria-selected={selected} aria-disabled={entry.disabled || undefined} tabIndex={-1}
                className={`ws-option ws-option--command${selected ? ' is-active' : ''}${entry.disabled ? ' is-disabled' : ''}`} onMouseMove={hover}
                onMouseDown={event => event.preventDefault()} onClick={() => execute(entry)}>
                <span className="ws-icon"><Icon size={18} aria-hidden="true"/></span>
                <span className="ws-copy"><strong>{highlighted(entry.command.title, entry.ranges)}</strong><span className="ws-excerpt">{entry.disabled ? '当前窗口只读' : entry.command.description}</span></span>
                {keys && <span className="ws-keys">{keys.split(' ').map(key => <kbd key={key}>{key}</kbd>)}</span>}
              </div>;
            }
            const { hit, node } = entry;
            const title = node ? cardTitle(node) : hit.title || kindLabel(hit.kind);
            const titleRanges = hit.field === 'title' && title === hit.title ? hit.ranges : hasQuery ? matchText(query, title)?.ranges ?? [] : [];
            // 从正文开头取的摘要跳过与标题相同的首行（Markdown 文章的 # 标题），行间用全角空格隔开（DLG-02）。
            const excerpt = hit.field === 'title' && entry.group !== 'board'
              ? readableExcerpt(node?.data.citation?.text || node?.data.body?.slice(0, 200) || '', [], { title })
              : readableExcerpt(hit.excerpt, hit.field === 'title' ? [] : hit.ranges, { title: hit.excerpt.startsWith('…') ? undefined : title });
            const more = hit.spots && hit.spots > MAX_SPOTS && hit.spot === MAX_SPOTS - 1 ? hit.spots - MAX_SPOTS : 0;
            const location = entry.group === 'source' ? hitLocation(hit, node, nodes) : undefined;
            const otherBoard = hit.boardId !== workspace.activeBoardId;
            return <div key={entry.key} id={`${id}-option-${at}`} role="option" data-search-position={at} aria-selected={selected} tabIndex={-1}
              className={`ws-option ws-option--hit${selected ? ' is-active' : ''}`} onMouseMove={hover}
              onMouseDown={event => event.preventDefault()} onClick={() => execute(entry)}>
              <span className="ws-icon"><KindGlyph kind={hit.kind} node={node}/></span>
              <span className="ws-copy">
                <strong>{highlighted(title, titleRanges)}</strong>
                {excerpt.text && <span className="ws-excerpt">{highlighted(excerpt.text, excerpt.ranges)}</span>}
              </span>
              <span className="ws-meta">
                {location ? <ProvenanceTag variant="stamp-mini" label={location}/> : <span className="ws-kind">{kindLabel(hit.kind, node)}</span>}
                {more > 0 && <span className="ws-more">还有 {more} 处</span>}
                {otherBoard && <span className="ws-board" title={hit.boardTitle}>{hit.boardTitle}</span>}
              </span>
            </div>;
          })}
        </div>)}
        {hasQuery && entries.length === 0 && <div className="ws-empty"><strong>没有找到“{result.query}”</strong><p>{boardOnly ? '试试更短的词，或取消“只看当前画布”。' : '试试更短的词，或输入拼音首字母，例如 xjbj（新建笔记）。'}</p></div>}
      </div>
      <footer className="ws-footer" id={helpId}><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span>{readOnly && <span className="ws-readonly"><Lock size={12} aria-hidden="true"/>当前只读，仍可查找素材</span>}</footer>
      <p className="workspace-search__announcement" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    </section>
  </InspectorDialog>;
}
