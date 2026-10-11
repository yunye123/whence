import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, drawSelection, keymap, placeholder as placeholderExtension } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, redo } from '@codemirror/commands';
import { DRAFT_MAX_LENGTH, DRAFT_SCROLL_PADDING_BOTTOM } from './limits';
import type { DraftEditorProps } from './DraftEditor';
import { DraftEditorFallback } from './stand-in';
import { attachTextareaAdapter } from './handle';
import type { DraftEditorHandle } from './handle';
import { activeReference, referenceExtension, referenceField, setReferenceHover, setReferenceInfo } from './references';
import { markdownExtension } from './markdown';
import { draftEditorTheme } from './theme';
import { draftSessionState, rememberDraftSession } from './session';

/** Marks transactions that only mirror the stored body into the editor, so they are not echoed back as edits. */
const externalSync = Annotation.define<boolean>();

/** Smallest single change that turns `before` into `after` (keeps the caret and the undo history meaningful). */
function minimalChange(before: string, after: string) {
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endBefore = before.length, endAfter = after.length;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) { endBefore--; endAfter--; }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}

/**
 * The draft body editor: CodeMirror 6 over the raw Markdown string (C11, K1, K9-14). Reference links render as
 * inline superscripts or source-line stamps, Markdown marks stay out of sight, the caret is 2px ink. Server rendering (and the first client
 * frame) shows a read-only textbox with the readable text, named “文稿正文” like the live editor.
 * Loaded on demand with the rest of the editor (editor-kit.ts); DraftEditor.tsx shows the same stand-in until it arrives.
 */
export default function DraftEditorView(props: DraftEditorProps) {
  const { body, readOnly, placeholder, handleRef, referenceInfo, hoverReference } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const readOnlyCompartment = useMemo(() => new Compartment(), []);
  /** Script cells (range views of this body, §6.29) follow every update through the handle's `subscribe`. */
  const updateListeners = useMemo(() => new Set<(update: ViewUpdate) => void>(), []);
  const normalized = useMemo(() => body.replace(/\r\n?/g, '\n'), [body]);
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const readOnlyExtensions = (value: boolean) => [
      EditorState.readOnly.of(value),
      EditorView.editable.of(!value),
      EditorView.contentAttributes.of({ 'aria-readonly': value ? 'true' : 'false' }),
    ];
    const view: EditorView = new EditorView({
      parent: host,
      state: draftSessionState(props.sessionKey, normalized, [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          // Escape is left to the panel: it collapses focus writing first and keeps the selection (shell A5).
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => { callbacks.current.onSaveShortcut?.(); return true; } },
            { key: 'Mod-Shift-z', run: redo, preventDefault: true },
            { key: 'Alt-Enter', run: current => {
              const index = activeReference(current.state);
              const anchor = index === null ? null : current.contentDOM.querySelector<HTMLElement>(`[data-ref-index="${index}"].cm-ref, .cm-ref-label[data-ref-index="${index}"]`);
              if (index === null || !anchor) return false;
              callbacks.current.onReferenceActivate?.(index, anchor, true);
              return true;
            } },
            ...defaultKeymap.filter(binding => binding.key !== 'Escape'),
            ...historyKeymap,
          ]),
          placeholderExtension(placeholder),
          EditorView.contentAttributes.of({ 'aria-label': '文稿正文', 'aria-multiline': 'true', role: 'textbox', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', translate: 'no' }),
          readOnlyCompartment.of(readOnlyExtensions(readOnly)),
          EditorView.scrollMargins.of(() => {
            const insets = callbacks.current.scrollInsets?.() ?? {};
            return { top: Math.max(32, insets.top ?? 0), bottom: Math.max(DRAFT_SCROLL_PADDING_BOTTOM, insets.bottom ?? 0) };
          }),
          EditorState.transactionFilter.of(transaction => {
            if (!transaction.docChanged || transaction.annotation(externalSync) || transaction.newDoc.length <= DRAFT_MAX_LENGTH || transaction.newDoc.length <= transaction.startState.doc.length) return transaction;
            queueMicrotask(() => callbacks.current.onLimit?.());
            return [];
          }),
          referenceExtension,
          markdownExtension,
          draftEditorTheme,
          EditorView.updateListener.of(update => {
            const current = callbacks.current;
            const typed = update.transactions.some(transaction => transaction.isUserEvent('input.type') || transaction.isUserEvent('delete'));
            if (update.docChanged && !update.transactions.every(transaction => transaction.annotation(externalSync))) {
              const next = update.state.doc.toString();
              if (current.onChange(next) === false) {
                const previous = update.startState.doc.toString();
                // Not allowed inside an update: put the stored text back right after it.
                queueMicrotask(() => { if (!view.state.doc.eq(update.startState.doc)) view.dispatch({ changes: minimalChange(view.state.doc.toString(), previous), annotations: [externalSync.of(true), Transaction.addToHistory.of(false)] }); });
              }
            }
            if (typed) current.onTyping?.();
            const before = update.startState.field(referenceField).active, after = update.state.field(referenceField).active;
            if (before !== after) current.onActiveReference?.(after);
            if (update.docChanged || update.geometryChanged || update.heightChanged || update.viewportChanged) current.onGeometry?.();
            for (const listener of updateListeners) listener(update);
          }),
        ]),
    });
    viewRef.current = view;
    const handle: DraftEditorHandle = attachTextareaAdapter(view, updateListeners);
    handleRef.current = handle;
    setMounted(true);
    return () => {
      rememberDraftSession(props.sessionKey, view.state);
      if (handleRef.current === handle) handleRef.current = null;
      viewRef.current = null;
      view.destroy();
    };
    // The editor is created once per mount; later prop changes are applied by the effects below.
  }, []);

  // Mirror an outside change of the stored body (version restore, canvas undo) without echoing it back.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === normalized) return;
    view.dispatch({ changes: minimalChange(current, normalized), annotations: [externalSync.of(true), Transaction.addToHistory.of(false)] });
  }, [normalized]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: readOnlyCompartment.reconfigure([
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.contentAttributes.of({ 'aria-readonly': readOnly ? 'true' : 'false' }),
    ]) });
  }, [readOnly, readOnlyCompartment]);

  useEffect(() => { viewRef.current?.dispatch({ effects: setReferenceInfo.of(referenceInfo) }); }, [referenceInfo]);
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.field(referenceField).hover !== hoverReference) view.dispatch({ effects: setReferenceHover.of(hoverReference) });
  }, [hoverReference]);

  const referenceAt = (event: ReactMouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.cm-ref, .cm-ref-label') : null;
    return target?.dataset.refIndex ? { index: Number(target.dataset.refIndex), element: target } : null;
  };

  return <div
    className="draft-editor"
    // Superscripts are widgets the editor ignores: they keep the caret where it is and open their source card.
    onMouseDown={event => { if (event.button === 0 && referenceAt(event)) event.preventDefault(); }}
    onClick={event => { const hit = referenceAt(event); if (hit) props.onReferenceActivate?.(hit.index, hit.element, false); }}
    onMouseOver={event => { const hit = referenceAt(event); if (hit) props.onReferenceHover?.(hit.index); }}
    onMouseOut={event => {
      const hit = referenceAt(event);
      const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest('.cm-ref, .cm-ref-label') : null;
      if (hit && !next) props.onReferenceHover?.(null);
    }}
  >
    <div ref={hostRef} className="draft-editor__host" />
    {!mounted && <DraftEditorFallback text={normalized} placeholder={placeholder} readOnly={readOnly} />}
  </div>;
}
