import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps, type ComponentType, type CSSProperties } from 'react';
import { readPanelWidth } from '../inspector/session-cache';
import { loadedDraftEditor, preloadDraftEditor } from '../inspector/draft-editor/editor-loader';

type InspectorModule = typeof import('../Inspector');
let inspectorModule: Promise<InspectorModule> | null = null;
/** The module once it has arrived: a panel opened after that mounts it directly, without a Suspense round (CORE-11). */
let loadedInspector: InspectorModule | null = null;
/**
 * Load the inspector module once; later calls share the same request (CORE-11). App calls it when the browser is idle
 * after the first screen and again the moment a source is about to open, so the panel rarely has to wait for it.
 */
export function preloadInspector(): Promise<InspectorModule> {
  inspectorModule ??= import('../Inspector').then(module => { loadedInspector = module; return module; }).catch(error => { inspectorModule = null; throw error; });
  return inspectorModule;
}

const Inspector=lazy(preloadInspector);

export type InspectorPanelProps = ComponentProps<typeof Inspector>;

/**
 * Lazy mount point for the inspector; everything else reaches it through BoardContext.
 * The placeholder takes the same layout box as the panel it stands for (docked width or the whole-window
 * workbench), so the canvas does not jump when the module arrives. The whole-window placeholder is transparent:
 * the canvas and the end of the FIELD trace stay visible instead of a blank sheet (CORE-11).
 *
 * CORE-11 (round 3): even with the module already loaded, React.lazy suspends on its first render and React 19 then
 * holds the fallback for about 100 ms before revealing the panel, so the first source opened in a session showed a
 * transparent placeholder first. Once the module is loaded, a panel mounts the component directly. The choice is made
 * once per mount, so a panel that started lazily is never swapped (and remounted) when the module arrives.
 *
 * CORE-32: the draft editor (CodeMirror) is its own chunk, loaded only for writing (editor-loader.ts). App starts it as
 * soon as a draft is pointed at, selected or about to open, so it is normally in by now. If it is not, a panel opening on
 * a draft waits for it behind a fully transparent placeholder and then opens with its usual motion: the editor and its
 * caret are there from the first frame, never a stand-in that the editor replaces.
 */
export default function InspectorPanel({ node, slot, imagePreviewToken, onClose, onImportSubtitles, onNativeTranscribe, onNotify }: InspectorPanelProps) {
  // Direct or lazy is decided once, on the first render that shows the panel (a draft may first wait for its editor).
  const choice = useRef<ComponentType<InspectorPanelProps> | 'lazy' | null>(null);
  // Only a panel that opens waits; a draft opened while another card's panel is showing switches at once, as cards do
  // in an open panel, and its editor takes over from the stand-in when it arrives.
  const waitsForEditor = node.data.kind === 'draft' && !loadedDraftEditor() && choice.current === null;
  const [, setEditorArrived] = useState(0);
  // A failed load opens the draft anyway: its editor then shows the read-only stand-in and keeps trying (DraftEditor).
  const [editorFailed, setEditorFailed] = useState(false);
  useEffect(() => {
    if (!waitsForEditor || editorFailed) return;
    let live = true;
    void Promise.all([preloadDraftEditor(), preloadInspector().catch(() => {})]).then(() => { if (live) setEditorArrived(value => value + 1); }, () => { if (live) setEditorFailed(true); });
    return () => { live = false; };
  }, [waitsForEditor, editorFailed]);
  const layout=node.data.kind==='video'?'inspector--video':'inspector--docked';
  const slotClass=slot==='pinned'?' inspector--pinned':slot==='companion'?' inspector--companion':'';
  const style={'--inspector-w':`${readPanelWidth()}px`,...(node.data.kind==='video'?{background:'transparent',boxShadow:'none'}:{})} as CSSProperties;
  if (waitsForEditor && !editorFailed) {
    return <aside className={`inspector ${layout}${slotClass} inspector--motion-none`} style={{...style,background:'transparent',boxShadow:'none',borderLeftColor:'transparent'}} aria-busy="true" aria-label="正在打开资料"><div className="inspector-loading sr-only" role="status">正在打开资料…</div></aside>;
  }
  choice.current ??= loadedInspector?.default ?? 'lazy';
  if (choice.current !== 'lazy') {
    const Loaded = choice.current;
    return <Loaded key={node.id} node={node} slot={slot} imagePreviewToken={imagePreviewToken} onClose={onClose} onImportSubtitles={onImportSubtitles} onNativeTranscribe={onNativeTranscribe} onNotify={onNotify}/>;
  }
  return (
    <Suspense fallback={<aside className={`inspector ${layout}${slotClass} inspector--motion-none`} style={style} aria-busy="true" aria-label="正在打开资料"><div className="inspector-loading sr-only" role="status">正在打开资料…</div></aside>}>
      <Inspector key={node.id} node={node} slot={slot} imagePreviewToken={imagePreviewToken} onClose={onClose} onImportSubtitles={onImportSubtitles} onNativeTranscribe={onNativeTranscribe} onNotify={onNotify}/>
    </Suspense>
  );
}
