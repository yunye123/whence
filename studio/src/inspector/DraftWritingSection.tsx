import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { List, Quote, Type, X } from 'lucide-react';
import type { BoardNode, BoardEdge, CardData } from '../model';
import { useBoard } from '../board-context';
import type { BoardActions } from '../board-context';
import { formatDraftQuote } from '../draft-references';
import { draftCharacterCount } from '../source-location';
import { QuoteIcon, SourceIcon } from '../icons/field-icons';
import { insertDraftText, revealDraftReference } from './draft-text';
import { draftStage } from '../cards/card-utils';
import DraftReferenceList from './DraftReferenceList';
import DraftSourcesList, { DraftFootnotes, DraftMargin, SourceCard } from './DraftSourcesList';
import type { SourceActions } from './DraftSourcesList';
import DraftVersions, { DraftVersionsButton } from './DraftVersions';
import { InspectorSlot, keepEditorFocus, useInspectorLayout } from './shared';
import type { PatchCard } from './shared';
import DraftEditor, { DRAFT_MAX_LENGTH } from './draft-editor/DraftEditor';
import type { DraftEditorHandle, TextEditorHandle } from './draft-editor/handle';
import { analyzeDraftReferences } from './draft-editor/reference-analysis';
import { referenceInfoMap, resolveReferences } from './draft-editor/sources';
import type { ResolvedReference } from './draft-editor/sources';
import { createSignal, DRAFT_SAVE_EVENT, InPanel, useInspectorRoot, useMediaQuery, useTypingFade } from './draft-editor/panel';
import { ReferencePopover } from './draft-editor/ReferencePopover';
import { fitQuoteToCaret } from './draft-editor/quote-fit';
import { loadedDraftEditor } from './draft-editor/editor-loader';
import DraftViewSwitch from './script-view/DraftViewSwitch';
import ScriptView from './script-view/ScriptView';
import type { ScriptActions } from './script-view/ScriptView';
import { buildScript, scriptTimeResolver } from './script-view/script-model';
import type { ScriptLine } from './script-view/script-model';
import { setDraftView, storedDraftView, useDraftView } from './script-view/view-mode';
import type { DraftView } from './script-view/view-mode';
import { ScriptEditing } from './script-view/script-editing';
import { TranslationForCard } from './EnglishTranslation';

/** Optional App field (integration request inspector-writing): edges, for the notes pinned to the margin. */
type EdgeAwareBoard = BoardActions & { edges?: BoardEdge[] };

/** The script control a trip to a film left from (a tag, a scene, an empty picture), per draft: focus goes back to it. */
const scriptFocus = new Map<string, string>();

const PLACEHOLDER = '写下第一句话。\n\n把画布里的摘录放在身边，让自己的观点慢慢长出来。';
const NARROW_DESK = '(max-width: 1279px)';

/**
 * Draft writing (DESIGN_SYSTEM §6.18.4, C11, C12) and its script view (§6.29). One component for the docked panel and
 * focus writing, so the CodeMirror editor never remounts when the layout or the view changes (its selection and undo
 * history survive; in 脚本 it is only hidden):
 * - docked: format toolbar · editor · footnote list of sources · versions; the excerpt picker is a sheet over the panel;
 *   a superscript opens its source card in a popover.
 * - writing ≥ 1280: paper with the stage line, the margin (spine + source cards at the height of each reference),
 *   header actions (插入摘录 · 来源 · 版本 · 导出); excerpt picker and versions open as drawers on the right.
 * - writing < 1280: margin folds away; superscripts (or Alt+Enter) open the source card, “来源 N” opens a drawer.
 * - 正文 / 脚本 (group “文稿视图”): in the docked bar before the format tools, in the focus header after the title. 脚本 lays
 *   the same body out as a shooting script (ScriptView). Its cells edit the same body in place (ScriptEditing: a range
 *   view of this editor, one document, one undo history); rows and scenes move by drag or Alt+↑ / Alt+↓.
 */
export default function DraftWritingSection({ data, editorRef, normalizedBody, patch, onNotify, showReferences, setShowReferences, showVersions, setShowVersions, openDraftSource }: {
  data: CardData;
  editorRef: RefObject<TextEditorHandle | null>;
  normalizedBody: string;
  patch: PatchCard;
  onNotify: (message: string) => void;
  showReferences: boolean;
  setShowReferences: Dispatch<SetStateAction<boolean>>;
  showVersions: boolean;
  setShowVersions: Dispatch<SetStateAction<boolean>>;
  openDraftSource: (sourceId: string, time?: number, quoteNodeId?: string, insert?: { insertAfter: number; line?: number }) => void;
}) {
  const board = useBoard();
  const layout = useInspectorLayout();
  const writing = layout === 'writing';
  const narrow = useMediaQuery(NARROW_DESK);
  const sectionRef = useRef<HTMLElement>(null);
  const paperMetaRef = useRef<HTMLParagraphElement>(null);
  const root = useInspectorRoot(sectionRef);
  const markTyping = useTypingFade(writing ? root : null);
  const geometry = useMemo(() => createSignal(), []);
  const lastPatch = useRef(true);
  const [caretReference, setCaretReference] = useState<number | null>(null);
  const [hoverReference, setHoverReference] = useState<number | null>(null);
  const [popover, setPopover] = useState<{ index: number; anchor: HTMLElement; keyboard: boolean } | null>(null);
  const [sourcesDrawer, setSourcesDrawer] = useState(false);
  const [marginHidden, setMarginHidden] = useState(false);
  const draftId = board.inspectedId;
  const [view, setView] = useDraftView(draftId, normalizedBody);
  const script = view === 'script';
  // The view a draft first opens in stays its view (§6.29: 正文 unless it already reads as a script, like the example):
  // a draft written in 正文 does not come back in 脚本 next time just because its body has grown to look like one.
  useEffect(() => { if (draftId && storedDraftView(draftId) === undefined) setDraftView(draftId, view); }, [draftId, view]);

  const spans = useMemo(() => analyzeDraftReferences(normalizedBody), [normalizedBody]);
  const references = useMemo(() => resolveReferences(spans, board.nodes), [spans, board.nodes]);
  // The labels only change when a source is renamed, moved or removed: keep the same Map while typing, so the editor
  // is not sent a reconfiguring transaction on every keystroke.
  const referenceInfoCache = useRef<{ key: string; map: ReturnType<typeof referenceInfoMap> } | null>(null);
  const referenceInfo = useMemo(() => {
    const map = referenceInfoMap(references);
    const key = JSON.stringify([...map]);
    if (referenceInfoCache.current?.key === key) return referenceInfoCache.current.map;
    referenceInfoCache.current = { key, map };
    return map;
  }, [references]);
  const usedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const span of spans) if (span.quoteNodeId) counts.set(span.quoteNodeId, (counts.get(span.quoteNodeId) ?? 0) + 1);
    return counts;
  }, [spans]);
  // One rule everywhere (INSP-10): the stage follows the saved versions, as on the card and in the sidebar.
  const stage = draftStage(data.draftVersions?.length ?? 0);
  useEffect(() => {
    const meta = paperMetaRef.current, column = meta?.closest<HTMLElement>('.inspector-column');
    if (!writing || !meta || !column) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // Title wrapping changes the single column frame's top; the body and its offsets stay untouched.
        const top = meta.getBoundingClientRect().bottom - column.getBoundingClientRect().top;
        column.style.setProperty('--draft-frame-top', `${top}px`);
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(meta); observer.observe(column);
    schedule();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); column.style.removeProperty('--draft-frame-top'); };
  }, [writing, data.title]);
  const edges = (board as EdgeAwareBoard).edges;
  const notes = useMemo(() => {
    if (!edges || !draftId) return [];
    const linked = new Set(edges.flatMap(edge => edge.source === draftId ? [edge.target] : edge.target === draftId ? [edge.source] : []));
    return board.nodes.filter(node => linked.has(node.id) && node.data.kind === 'note' && !node.data.tags?.includes('文字资料'));
  }, [edges, draftId, board.nodes]);

  const getView = useCallback(() => {
    const handle = editorRef.current as Partial<DraftEditorHandle> | null;
    return handle?.view ?? null;
  }, [editorRef]);

  // Script cells (§6.29 编辑): range views of the body editor above; one session for the whole table.
  const saveShortcut = useRef<() => void>(() => {});
  const [editing] = useState(() => new ScriptEditing({
    getMain: () => { const handle = editorRef.current as Partial<DraftEditorHandle> | null; return handle?.view && handle.subscribe ? handle as DraftEditorHandle : null; },
    onSave: () => saveShortcut.current(),
  }));
  useEffect(() => () => editing.destroy(), [editing]);

  // Popovers and drawers belong to one layout; leaving it closes them.
  useEffect(() => { setPopover(null); setSourcesDrawer(false); }, [layout, narrow]);

  // ── 正文 / 脚本 (§6.29) ────────────────────────────────────────────────────────────────────────────────────
  const scriptModel = useMemo(() => script ? buildScript(normalizedBody, scriptTimeResolver(board.nodes)) : null, [script, normalizedBody, board.nodes]);
  const scroller = useCallback(() => sectionRef.current?.closest<HTMLElement>('.inspector-scroll') ?? null, []);
  // Each view keeps its own place in the panel's one scroller; switching back returns to it.
  const scrollMemory = useRef<Partial<Record<DraftView, number>>>({});
  const pendingScroll = useRef<number | null>(null);
  const changeView = useCallback((next: DraftView) => {
    if (next === view) return;
    const element = scroller();
    if (element) scrollMemory.current[view] = element.scrollTop;
    pendingScroll.current = scrollMemory.current[next] ?? 0;
    setPopover(null); setSourcesDrawer(false); setShowReferences(false); setHoverReference(null);
    if (editing.getSnapshot() !== null) editing.finish(false);
    // Back in 正文 after changing the script: the caret (where the last change was) comes into view instead of the old place.
    if (next === 'body' && editing.edited) {
      pendingScroll.current = null;
      requestAnimationFrame(() => requestAnimationFrame(() => (editorRef.current as Partial<DraftEditorHandle> | null)?.revealSelection?.()));
    }
    editing.edited = false;
    setView(next);
  }, [view, scroller, setView, setShowReferences, editing, editorRef]);
  useLayoutEffect(() => {
    const target = pendingScroll.current;
    pendingScroll.current = null;
    if (target !== null) { const element = scroller(); if (element) element.scrollTop = target; }
    // The editor was hidden: let it measure its lines again before the margin reads them.
    if (!script) { getView()?.requestMeasure(); geometry.emit(); }
  }, [script, scroller, getView, geometry]);

  // The script's first visible line, so a layout switch (docked ↔ focus writing) keeps the reader on the same line:
  // the panel restores its editor-based scroll for the hidden editor, which means nothing in 脚本.
  const scriptAnchor = useRef<number | null>(null);
  useEffect(() => {
    const element = scroller();
    if (!script || !element) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      // At the very top the reader is at the title, not at a line: keep the top.
      if (element.scrollTop < 4) { scriptAnchor.current = null; return; }
      const top = element.getBoundingClientRect().top;
      const rows = element.querySelectorAll<HTMLElement>('.draft-script__row[data-from]');
      const first = [...rows].find(row => row.getBoundingClientRect().bottom > top + 8);
      scriptAnchor.current = first ? Number(first.dataset.from) : null;
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => { element.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [script, scroller, layout]);
  const previousLayout = useRef(layout);
  useEffect(() => {
    if (previousLayout.current === layout) return;
    previousLayout.current = layout;
    const anchor = scriptAnchor.current;
    if (!script) return;
    // After the panel's own restore (one frame) and the editor's measure (the next one).
    let frames = 0, handle = requestAnimationFrame(function settle() {
      if (++frames < 3) { handle = requestAnimationFrame(settle); return; }
      const element = scroller();
      if (!element) return;
      const row = anchor === null ? null : element.querySelector<HTMLElement>(`.draft-script__row[data-from="${anchor}"]`);
      element.scrollTop = row ? element.scrollTop + row.getBoundingClientRect().top - element.getBoundingClientRect().top - 24 : 0;
    });
    return () => cancelAnimationFrame(handle);
  }, [layout, script, scroller]);

  // 写进文稿 (INSP-26) into a draft that shows 脚本: App appends the excerpt and reveals the caret of the hidden editor,
  // which shows nothing. The script brings the new line into view, marks it once and gives it focus instead. The same
  // happens on the way back from a “补一个镜头” trip (§6.29): `from` is the new line written after the trip's line
  // (“另起一行写进原话”), `within` an offset inside the trip's line that has just taken its picture (“配给这一行”).
  const revealedLine = useRef(false);
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !script) return;
    let frame = 0;
    const onInserted = (event: Event) => {
      const { from, within } = (event as CustomEvent<{ from?: number; within?: number }>).detail ?? {};
      if (typeof from !== 'number' && typeof within !== 'number') return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => {
        const rows = [...section.querySelectorAll<HTMLElement>('.draft-script__row--line[data-from]')];
        const row = typeof within === 'number'
          ? rows.filter(item => Number(item.dataset.from) <= within).at(-1) ?? rows[0]
          : rows.find(item => Number(item.dataset.from) >= from!) ?? rows.at(-1);
        if (!row) return;
        revealedLine.current = true;
        row.scrollIntoView({ block: 'center' });
        row.classList.remove('is-revealed');
        void row.offsetWidth;
        row.classList.add('is-revealed');
        row.querySelector<HTMLElement>('.draft-script__line')?.focus({ preventScroll: true });
      }); });
    };
    section.addEventListener('draft-inserted', onInserted);
    return () => { section.removeEventListener('draft-inserted', onInserted); cancelAnimationFrame(frame); };
  }, [script]);

  /** A line pressed in 脚本: back to 正文 with the caret at the start of that paragraph, centred. */
  const editLine = useCallback((line: ScriptLine) => {
    const element = scroller();
    if (element) scrollMemory.current.script = element.scrollTop;
    pendingScroll.current = null;
    setView('body');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const editor = editorRef.current as Partial<DraftEditorHandle> | null;
      if (editor?.revealRange) editor.revealRange(line.caret, line.caret);
      else if (editor?.setSelectionRange) { editor.focus?.({ preventScroll: true }); editor.setSelectionRange(line.caret, line.caret); }
    }));
  }, [scroller, setView, editorRef]);

  // Esc leaves one layer at a time (§6.18): an open drawer or the excerpt sheet closes before focus writing collapses
  // or the panel closes, wherever focus is (the editor keeps its selection). Capture phase on the panel root runs
  // before the editor and the shell's own Esc routing; IME composition is left alone (K9-21).
  const layerOpen = sourcesDrawer || showReferences || (writing && showVersions);
  useEffect(() => {
    if (!root || !layerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      if ((event.target as Element | null)?.closest?.('.draft-popover, details[open]')) return;
      event.preventDefault();
      event.stopPropagation();
      const inside = (event.target as Element | null)?.closest?.('.draft-drawer, .draft-picker');
      if (sourcesDrawer) setSourcesDrawer(false);
      else if (showReferences) setShowReferences(false);
      else setShowVersions(false);
      if (inside) getView()?.focus();
    };
    root.addEventListener('keydown', onKey, true);
    return () => root.removeEventListener('keydown', onKey, true);
  }, [root, layerOpen, sourcesDrawer, showReferences, setShowReferences, setShowVersions, getView]);
  useEffect(() => { if (popover && popover.index > references.length) setPopover(null); }, [popover, references.length]);

  const onChange = useCallback((body: string) => {
    const ok = patch({ body });
    lastPatch.current = ok;
    return ok;
  }, [patch]);

  const insertText = (text: string, wrap?: [string, string]) => {
    if (board.readOnly) return false;
    const view = getView();
    if (!view) {
      // The editor has not mounted yet (first frame): fall back to the stored body and the end of it.
      const { body } = insertDraftText(data.body, normalizedBody.length, normalizedBody.length, text, wrap);
      if (body.length > DRAFT_MAX_LENGTH) { onNotify(`正文最多支持 ${DRAFT_MAX_LENGTH} 个字符，请缩短内容后再插入`); return false; }
      return patch({ body });
    }
    // C11: the same insertDraftText result as the textarea path, dispatched as one change with the caret after it.
    const insertion = loadedDraftEditor()!.draftInsertion(view.state, text, wrap);
    if (!insertion) return false;
    if (insertion.body.length > DRAFT_MAX_LENGTH) { onNotify(`正文最多支持 ${DRAFT_MAX_LENGTH} 个字符，请缩短内容后再插入`); return false; }
    lastPatch.current = true;
    view.dispatch(insertion.spec);
    view.focus();
    return lastPatch.current;
  };
  const insertQuote = (quote: BoardNode) => {
    // An empty line already above the caret is not doubled before the quotation (INSP-36).
    const view = getView();
    const before = view ? view.state.doc.sliceString(0, view.state.selection.main.from) : normalizedBody;
    try { if (insertText(fitQuoteToCaret(before, formatDraftQuote(quote)))) onNotify('已插入原文，出处附在引文后'); }
    catch (error) { onNotify(`引用未插入：${error instanceof Error ? error.message : String(error)}`); }
  };

  const actions: SourceActions = useMemo(() => ({
    open: (reference: ResolvedReference) => {
      if (!reference.source) return;
      setPopover(null);
      openDraftSource(reference.span.sourceNodeId, reference.span.time, reference.quote?.id);
    },
    locate: (reference: ResolvedReference) => {
      setSourcesDrawer(false);
      const editor = editorRef.current;
      if (editor) revealDraftReference(editor, reference.span);
    },
  }), [openDraftSource, editorRef]);

  const scriptActions: ScriptActions = useMemo(() => {
    const rememberFocus = () => {
      const key = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-script-focus]')?.dataset.scriptFocus;
      if (draftId && key) scriptFocus.set(draftId, key);
    };
    return {
    open: (reference: ResolvedReference) => { rememberFocus(); actions.open(reference); },
    // From an empty picture (“补一个镜头”) the trip remembers the end of that line (folded footnotes included), so a
    // sentence chosen in the film becomes its picture (“配给这一行”, §6.29) or a new line right after it.
    openSource: (sourceId: string, time?: number, line?: ScriptLine) => { rememberFocus(); openDraftSource(sourceId, time, undefined, line ? { insertAfter: line.to, line: line.number } : undefined); },
    edit: editLine,
    showBody: () => changeView('body'),
    };
  }, [actions, openDraftSource, editLine, changeView, draftId]);
  // Back from a film to the script: the control the trip started from gets focus again (after the panel's restore).
  useEffect(() => {
    const key = draftId ? scriptFocus.get(draftId) : undefined;
    if (!script || !draftId || !key) return;
    scriptFocus.delete(draftId);
    let frames = 0, handle = requestAnimationFrame(function wait() {
      if (++frames < 4) { handle = requestAnimationFrame(wait); return; }
      // A line just given its picture (or written in) from the film has taken focus (§6.29): it keeps it.
      if (revealedLine.current) return;
      const target = sectionRef.current?.querySelector<HTMLElement>(`[data-script-focus="${key}"]`);
      (target?.matches('button') ? target : target?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(handle);
    // Once, when the draft opens again.
  }, []);

  const activeReference = hoverReference ?? caretReference;
  const onReferenceActivate = useCallback((index: number, anchor: HTMLElement, keyboard: boolean) => {
    if (writing && !narrow && !marginHidden) {
      // The card is already beside the line: light the chain up and bring the card into view. From the keyboard
      // (Alt+Enter) focus moves to the card's tag; Esc there gives it back to the editor (DraftMargin).
      setHoverReference(index);
      const card = root?.querySelector<HTMLElement>(`.draft-source-card--margin[data-ref-index="${index}"]`);
      card?.scrollIntoView({ block: 'nearest', behavior: keyboard ? 'auto' : 'smooth' });
      if (keyboard) card?.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
      return;
    }
    setPopover(current => current?.index === index ? null : { index, anchor, keyboard });
  }, [writing, narrow, marginHidden, root]);

  /**
   * A drawer or sheet opened with the mouse leaves focus (and the caret) in the editor, so one can keep inserting at
   * the caret; opened from the keyboard (click detail 0) focus moves to its first control, or Tab would have to walk
   * the whole page to reach it.
   */
  const focusLayerFromKeyboard = (detail: number) => {
    if (detail !== 0) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const layer = root?.querySelector<HTMLElement>(':scope > :is(.draft-drawer, .draft-picker--sheet)');
      const target = ['.draft-picker__actions button:not([disabled])', '.draft-source-card button:not([disabled])', '.draft-versions__save button:not([disabled])', 'button:not([disabled])']
        .map(selector => layer?.querySelector<HTMLElement>(selector)).find(Boolean);
      target?.focus({ preventScroll: true });
    }));
  };

  // Ctrl+S: the body is already saved automatically; tell the band to say so (PW-m1).
  const onSaveShortcut = useCallback(() => { root?.dispatchEvent(new CustomEvent(DRAFT_SAVE_EVENT)); }, [root]);
  saveShortcut.current = onSaveShortcut;
  useEffect(() => { editing.setReferenceInfo(referenceInfo); }, [editing, referenceInfo]);
  const onLimit = useCallback(() => onNotify(`正文最多支持 ${DRAFT_MAX_LENGTH} 个字符，超出的内容没有写入`), [onNotify]);
  // Keep the caret clear of the docked toolbar (sticky, 44px) and of the excerpt sheet rising over the panel.
  const scrollInsets = useCallback(() => {
    if (writing) return {};
    const toolbar = sectionRef.current?.querySelector<HTMLElement>('.draft-bar')?.offsetHeight ?? 0;
    const sheet = root?.querySelector<HTMLElement>(':scope > .draft-picker--sheet');
    const footer = root?.querySelector<HTMLElement>(':scope > .inspector-footer')?.offsetHeight ?? 0;
    return { top: toolbar + 16, bottom: sheet ? sheet.offsetHeight - footer + 24 : 0 };
  }, [writing, root]);

  const showMargin = writing && !narrow && !marginHidden && !script;
  const viewSwitch = <DraftViewSwitch view={view} onChange={changeView} />;
  const popoverReference = popover ? references.find(reference => reference.index === popover.index) : undefined;

  // Body changes can move the reference lines: let the margin measure again after the editor has laid out.
  useLayoutEffect(() => { geometry.emit(); }, [normalizedBody, layout, geometry]);

  const picker = showReferences ? <DraftReferenceList
    variant={writing ? 'drawer' : 'sheet'}
    usedCounts={usedCounts}
    openDraftSource={openDraftSource}
    onInsert={insertQuote}
    onClose={() => { setShowReferences(false); getView()?.focus(); }}
  /> : null;
  const versionsDrawer = writing && showVersions ? <DraftVersions data={data} patch={patch} onNotify={onNotify} showVersions={showVersions} setShowVersions={setShowVersions} mode="drawer" /> : null;
  const narrowSources = writing && narrow && sourcesDrawer ? <DraftSourcesList variant="drawer" references={references} actions={actions} active={activeReference} onHover={setHoverReference} /> : null;
  const drawerOpen = writing && (!!picker || !!versionsDrawer || !!narrowSources);

  return <section ref={sectionRef} className={`inspector-section inspector-writing-section draft-writing draft-writing--${writing ? 'focus' : 'docked'}${script ? ' is-script' : ''}`}
    // In 脚本, Ctrl+Z / Ctrl+Y on the table (not in a cell, which has its own keys) step through the body's history: the
    // moves, the cells' typing and 正文 edits are one history. With nothing to undo there, the canvas undo still applies.
    onKeyDown={event => {
      if (!script || !(event.ctrlKey || event.metaKey) || event.altKey || event.nativeEvent.isComposing) return;
      const key = event.key.toLowerCase();
      const target = event.target instanceof Element ? event.target : null;
      if ((key !== 'z' && key !== 'y') || !target?.closest('.draft-script') || target.closest('.script-cell')) return;
      if (key === 'y' || event.shiftKey ? editing.redo() : editing.undo()) { event.preventDefault(); event.stopPropagation(); }
    }}
  >
    {writing && <InspectorSlot name="header-meta" fallback={viewSwitch}>
      <span className="draft-head__title">{data.title || '未命名文稿'}</span>
      <span className="draft-head__stage">{stage}</span>
      {viewSwitch}
    </InspectorSlot>}
    {writing && <InspectorSlot name="header-actions">
      {/* In 脚本 the two writing commands step out of sight but keep their room, so the header (and the 正文 / 脚本
          switch centred in it) does not shift when the view changes. */}
      <span className={`draft-head-group${script ? ' is-concealed' : ''}`} aria-hidden={script || undefined}>
      <button type="button" className={`inspector-head-button inspector-head-button--text draft-head-button${showReferences ? ' is-pressed' : ''}`} aria-expanded={showReferences} title="把画布里的摘录插入到光标处"
        onPointerDown={keepEditorFocus} onClick={event => { setShowReferences(value => !value); setShowVersions(false); setSourcesDrawer(false); if (!showReferences) focusLayerFromKeyboard(event.detail); }}
      ><QuoteIcon size={15} aria-hidden="true" /><span>插入摘录</span></button>
      <button type="button" className={`inspector-head-button inspector-head-button--text draft-head-button${(narrow ? sourcesDrawer : !marginHidden) ? ' is-pressed' : ''}`}
        {...(narrow ? { 'aria-expanded': sourcesDrawer } : { 'aria-pressed': !marginHidden })}
        title={narrow ? '查看本稿的全部出处' : marginHidden ? '在页边显示出处' : '收起页边出处'}
        onPointerDown={keepEditorFocus}
        onClick={event => { if (narrow) { setSourcesDrawer(value => !value); setShowReferences(false); setShowVersions(false); if (!sourcesDrawer) focusLayerFromKeyboard(event.detail); } else setMarginHidden(value => !value); }}
      ><SourceIcon size={15} aria-hidden="true" /><span>来源</span><span className="draft-head-button__count tabular">{references.length}</span></button>
      </span>
      <DraftVersionsButton count={data.draftVersions?.length ?? 0} open={showVersions} onToggle={detail => { setShowVersions(value => !value); setShowReferences(false); setSourcesDrawer(false); if (!showVersions) focusLayerFromKeyboard(detail); }} />
    </InspectorSlot>}

    {writing && <p ref={paperMetaRef} className="draft-paper-meta">
      <span>{stage}</span>
      {scriptModel && scriptModel.sceneCount > 0 && <span><span className="tabular">{scriptModel.sceneCount}</span> 场</span>}
      <span><span className="tabular">{draftCharacterCount(normalizedBody)}</span> 字</span>
    </p>}

    {/* K4 keeps the toolbar name “Markdown 格式工具”; the words on screen never mention Markdown (P2). Labels sit in a
        span: the legacy `.inspector-writing-toolbar button` rule forces 12px !important on the button element itself. */}
    {!writing && <div className="draft-bar">
      {viewSwitch}
      {!script && <div className="inspector-writing-toolbar draft-toolbar" role="toolbar" aria-label="Markdown 格式工具"
        // A toolbar moves between its buttons with the arrow keys, Home and End (every button also stays a Tab stop).
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (current < 0 || !buttons.length) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].focus();
        }}
      >
        <button type="button" className="draft-toolbar__button" disabled={board.readOnly} onPointerDown={keepEditorFocus} onClick={() => insertText('小标题', ['\n## ', '\n'])} title="插入小标题"><Type size={15} aria-hidden="true" /><span>小标题</span></button>
        <button type="button" className="draft-toolbar__button" disabled={board.readOnly} onPointerDown={keepEditorFocus} onClick={() => insertText('列表内容', ['\n- ', '\n'])} title="插入列表"><List size={15} aria-hidden="true" /><span>列表</span></button>
        <span className="draft-toolbar__rule" aria-hidden="true" />
        <button type="button" className={`draft-toolbar__button${showReferences ? ' is-active' : ''}`} aria-expanded={showReferences} onPointerDown={keepEditorFocus} onClick={event => { setShowReferences(value => !value); if (!showReferences) focusLayerFromKeyboard(event.detail); }} title="把画布里的摘录插入到光标处"><Quote size={15} aria-hidden="true" /><span>引用</span></button>
      </div>}
    </div>}

    <TranslationForCard data={data} surface="draft" nodeId={draftId ?? ''} readOnly={!!board.readOnly} update={(_id, next) => patch(next)} />
    {/* 脚本 hides the editor instead of unmounting it: selection, undo history and scroll anchors survive the switch. */}
    <div className="draft-body" hidden={script}>
      <DraftEditor
        body={data.body}
        sessionKey={draftId ?? undefined}
        readOnly={!!board.readOnly}
        placeholder={PLACEHOLDER}
        handleRef={editorRef}
        onChange={onChange}
        referenceInfo={referenceInfo}
        hoverReference={hoverReference}
        onActiveReference={setCaretReference}
        onReferenceHover={setHoverReference}
        onReferenceActivate={onReferenceActivate}
        onGeometry={geometry.emit}
        onTyping={markTyping}
        onLimit={onLimit}
        onSaveShortcut={onSaveShortcut}
        scrollInsets={scrollInsets}
      />
    </div>
    {writing && !script && <DraftFootnotes body={normalizedBody} references={references} actions={actions} />}
    {scriptModel && <ScriptView model={scriptModel} references={references} nodes={board.nodes} readOnly={!!board.readOnly} actions={scriptActions} editing={editing} />}

    {/* Sources: footnote list when docked; the margin in wide focus writing (server rendering shows the list). */}
    {!writing ? <DraftSourcesList references={references} actions={actions} />
      : script ? null
      : showMargin ? <InspectorSlot name="margin" fallback={<DraftSourcesList references={references} actions={actions} />}>
        <DraftMargin references={references} notes={notes} getView={getView} geometry={geometry} active={activeReference} onHover={setHoverReference} actions={actions} />
      </InspectorSlot>
        : !root ? <DraftSourcesList references={references} actions={actions} /> : null}

    {/* Versions: an inline block when docked; a header button and a drawer in focus writing. */}
    {!writing ? <DraftVersions data={data} patch={patch} onNotify={onNotify} showVersions={showVersions} setShowVersions={setShowVersions} />
      : !root ? <DraftVersions data={data} patch={patch} onNotify={onNotify} showVersions={showVersions} setShowVersions={setShowVersions} /> : null}

    {!writing && picker && <InPanel root={root} inline>{picker}</InPanel>}
    {drawerOpen && <InPanel root={root} inline>
      <div className={`draft-drawer${narrowSources ? ' draft-drawer--scrim' : ''}`}>
        {narrowSources && <div className="draft-drawer__scrim" aria-hidden="true" onClick={() => setSourcesDrawer(false)} />}
        <div className="draft-drawer__panel"
          onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing && narrowSources) { event.preventDefault(); event.stopPropagation(); setSourcesDrawer(false); } }}
        >
          {narrowSources && <div className="draft-picker__head"><h3>本稿已引用来源</h3><span className="draft-picker__count tabular">{references.length}</span>
            <button type="button" className="icon-btn draft-picker__close" aria-label="收起来源" title="收起 (Esc)" onClick={() => setSourcesDrawer(false)}><X size={15} aria-hidden="true" /></button></div>}
          {narrowSources}
          {picker}
          {versionsDrawer}
        </div>
      </div>
    </InPanel>}
    {popover && popoverReference && <ReferencePopover
      root={root}
      anchor={popover.anchor}
      keyboard={popover.keyboard}
      onClose={(refocus) => { setPopover(null); if (refocus) getView()?.focus(); }}
    >
      <SourceCard reference={popoverReference} variant="popover" actions={actions} />
    </ReferencePopover>}
  </section>;
}
