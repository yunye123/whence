// Everything of the draft editor that needs CodeMirror, as one on-demand chunk (CORE-32, editor-loader.ts): the body
// editor, the script cells' editing engine (a range view of it) and the insertion transaction.
export { default as DraftEditorView } from './DraftEditorView';
export { ScriptEditingEngine } from '../script-view/cell-editing';
export { draftInsertion } from './insert';
