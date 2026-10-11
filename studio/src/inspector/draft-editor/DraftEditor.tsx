import { useEffect, useMemo, useState, type ComponentType, type RefObject } from 'react';
import type { TextEditorHandle } from './handle';
import type { ReferenceInfo } from './references';
import { loadedDraftEditor, preloadDraftEditor } from './editor-loader';
import { DraftEditorFallback } from './stand-in';

export { DRAFT_MAX_LENGTH, DRAFT_SCROLL_PADDING_BOTTOM } from './limits';

export interface DraftEditorProps {
  body: string;
  /** Optional session identity, so visiting a source and returning keeps this draft's undo/redo history. */
  sessionKey?: string;
  readOnly: boolean;
  placeholder: string;
  /** Receives the textarea-shaped handle (C11) while the editor is mounted. */
  handleRef: RefObject<TextEditorHandle | null>;
  /** Persist an edit; returning false (read-only, save locked) puts the previous text back. */
  onChange: (body: string) => boolean;
  referenceInfo: ReadonlyMap<number, ReferenceInfo>;
  /** Pointer hover coming from the margin cards (null when none). */
  hoverReference: number | null;
  onActiveReference?: (index: number | null) => void;
  onReferenceHover?: (index: number | null) => void;
  /** A superscript was clicked, or Alt+Enter pressed beside it. */
  onReferenceActivate?: (index: number, anchor: HTMLElement, keyboard: boolean) => void;
  /** Line heights or positions changed: margin cards must be measured again. */
  onGeometry?: () => void;
  /** Continuous typing (input or deletion), used to fade the status band. */
  onTyping?: () => void;
  onLimit?: () => void;
  onSaveShortcut?: () => void;
  /** Extra room kept clear when the caret is scrolled into view: a sticky toolbar on top, a sheet over the bottom. */
  scrollInsets?: () => { top?: number; bottom?: number };
}

/**
 * The draft body editor (C11). CodeMirror is loaded on demand with the rest of the editor (editor-kit.ts, CORE-32): the
 * panel opens a draft once the editor has arrived (InspectorPanel waits for it), so this renders DraftEditorView at
 * once. Without it (server rendering, or the editor still on its way) it shows the read-only stand-in and swaps in
 * the editor when it arrives.
 */
export default function DraftEditor(props: DraftEditorProps) {
  const [View, setView] = useState<ComponentType<DraftEditorProps> | null>(() => loadedDraftEditor()?.DraftEditorView ?? null);
  useEffect(() => {
    if (View) return;
    let live = true;
    void preloadDraftEditor().then(kit => { if (live) setView(() => kit.DraftEditorView); }, () => {});
    return () => { live = false; };
  }, [View]);
  const text = useMemo(() => props.body.replace(/\r\n?/g, '\n'), [props.body]);
  if (View) return <View {...props} />;
  return <div className="draft-editor">
    <div className="draft-editor__host" />
    <DraftEditorFallback text={text} placeholder={props.placeholder} readOnly={props.readOnly} />
  </div>;
}
