import { EditorView } from '@codemirror/view';

/**
 * CodeMirror injects its base theme as unlayered CSS, which outranks every `@layer` rule in src/styles. So this
 * theme carries exactly the properties the base theme also sets (colours, font inheritance, the line and content
 * box: padding, min-height), with design tokens only (no raw colours, §0 rule 1). Everything the base theme leaves
 * alone (typography, line heights, decorations, the paper and the margin) lives in features/inspector-writing.css.
 * Line selectors carry `.cm-line` twice-over (`.cm-line.cm-md-*`) so they outrank the `.cm-line { padding: 0 }` reset.
 */
export const draftEditorTheme = EditorView.theme({
  '&': { color: 'inherit', backgroundColor: 'transparent', font: 'inherit' },
  '&.cm-focused': { outline: 'none' },
  // The inspector scroll area is the only scroller (shell contract); margin numbers and paper-edge ticks sit outside the box.
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit', overflow: 'visible' },
  '.cm-content': {
    padding: '0',
    minHeight: 'calc(var(--draft-line, 30px) * var(--draft-min-lines, 6))',
    caretColor: 'var(--fg-1)',
    fontFamily: 'inherit',
    whiteSpace: 'pre-wrap',
  },
  '.cm-line': { padding: '0' },
  '.cm-line.cm-md-quote': { paddingLeft: '1.15em' },
  '.cm-line.cm-md-list': { paddingLeft: '1.3em' },
  '.cm-line.cm-md-h1': { paddingTop: '.35em' },
  '.cm-line.cm-md-h2': { paddingTop: '.3em' },
  '.cm-line.cm-md-h3': { paddingTop: '.2em' },
  '.cm-line.cm-md-code, .cm-line.cm-md-fence': { paddingLeft: 'var(--space-5)', paddingRight: 'var(--space-5)' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--fg-1)', marginLeft: '-1px' },
  // The base theme's light/dark selection colours carry up to six classes; these carry one more so the token wins.
  '&.cm-editor.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-editor.cm-editor .cm-selectionBackground': { backgroundColor: 'var(--text-selection)' },
  '.cm-content ::selection': { backgroundColor: 'var(--text-selection)' },
  '.cm-placeholder': { color: 'var(--fg-3)', fontStyle: 'normal' },
});
