import { draftReadableSegments } from '../../source-location';

/**
 * The draft body as a read-only textbox named “文稿正文” with the readable text (superscript numbers, no links): what
 * server rendering shows, and what the editor shows for the frame before CodeMirror mounts (C11).
 */
export function DraftEditorFallback({ text, placeholder, readOnly }: { text: string; placeholder: string; readOnly: boolean }) {
  return <div
    className="draft-editor__fallback"
    role="textbox"
    aria-label="文稿正文"
    aria-multiline="true"
    aria-readonly={readOnly ? 'true' : 'false'}
  >{text.trim()
    ? draftReadableSegments(text).map((segment, index) => 'text' in segment
      ? <span key={index}>{segment.text}</span>
      : <sup key={index} className="cm-ref">{segment.footnote}</sup>)
    : <span className="draft-editor__placeholder">{placeholder}</span>}</div>;
}
