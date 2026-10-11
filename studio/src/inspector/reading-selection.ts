import type { TextRange } from './shared';

/**
 * DOM ↔ source offsets for the reading view (K9-13). The reading body keeps every source character in its
 * text nodes (Markdown syntax sits in hidden spans), so a DOM point's source offset is the summed length of the
 * text nodes before it. Both directions walk text nodes only; CSS, pseudo-elements and attributes never count.
 * The walker works on anything shaped like a DOM node so the mapping is tested without a browser.
 */
export interface TextWalkNode {
  nodeType: number;
  nodeValue: string | null;
  textContent: string | null;
  childNodes: ArrayLike<TextWalkNode>;
  parentNode: TextWalkNode | null;
}

const TEXT_NODE = 3;

function* textNodes(root: TextWalkNode): Generator<TextWalkNode> {
  const stack: { node: TextWalkNode; index: number }[] = [{ node: root, index: 0 }];
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top.index >= top.node.childNodes.length) { stack.pop(); continue; }
    const child = top.node.childNodes[top.index++];
    if (child.nodeType === TEXT_NODE) yield child;
    else if (child.childNodes.length) stack.push({ node: child, index: 0 });
  }
}

function contains(root: TextWalkNode, node: TextWalkNode | null): boolean {
  for (let cursor = node; cursor; cursor = cursor.parentNode) if (cursor === root) return true;
  return false;
}

const lengthOf = (node: TextWalkNode) => (node.nodeType === TEXT_NODE ? node.nodeValue : node.textContent)?.length ?? 0;

/** Text length of everything before `node` inside `root` (its preceding siblings and theirs, up the tree). */
function lengthBefore(root: TextWalkNode, node: TextWalkNode): number {
  let total = 0;
  for (let cursor = node; cursor !== root && cursor.parentNode; cursor = cursor.parentNode) {
    const siblings = cursor.parentNode.childNodes;
    for (let index = 0; index < siblings.length && siblings[index] !== cursor; index++) total += lengthOf(siblings[index]);
  }
  return total;
}

/** Source offset of a DOM boundary point (container + offset, as in Range / Selection), or null outside `root`. */
export function offsetOfPoint(root: TextWalkNode, container: TextWalkNode, offset: number): number | null {
  if (!contains(root, container)) return null;
  const before = container === root ? 0 : lengthBefore(root, container);
  if (container.nodeType === TEXT_NODE) return before + Math.max(0, Math.min(offset, lengthOf(container)));
  // An element boundary point means “before child #offset”.
  let inside = 0;
  const children = container.childNodes;
  for (let index = 0; index < Math.min(offset, children.length); index++) inside += lengthOf(children[index]);
  return before + inside;
}

/**
 * The text node position for a source offset. `forward` puts a boundary offset at the start of the next text
 * node (where the following character is), `backward` at the end of the previous one (where the preceding
 * character is), so a range's start and end stay inside the text they enclose.
 */
export function pointAtOffset(root: TextWalkNode, offset: number, affinity: 'forward' | 'backward' = 'forward'): { node: TextWalkNode; offset: number } | null {
  let total = 0;
  let last: TextWalkNode | null = null;
  for (const text of textNodes(root)) {
    const length = text.nodeValue?.length ?? 0;
    if (length === 0) continue;
    if (affinity === 'forward' ? offset < total + length : offset <= total + length) {
      if (offset >= total) return { node: text, offset: offset - total };
    }
    total += length;
    last = text;
  }
  if (last && offset === total) return { node: last, offset: last.nodeValue?.length ?? 0 };
  return null;
}

/** The current selection as source offsets, when it lies inside `element`. */
export function readingSelection(element: HTMLElement): TextRange | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  const root = element as unknown as TextWalkNode;
  const from = offsetOfPoint(root, range.startContainer as unknown as TextWalkNode, range.startOffset);
  const to = offsetOfPoint(root, range.endContainer as unknown as TextWalkNode, range.endOffset);
  return from !== null && to !== null && from < to ? { from, to } : null;
}

/** A DOM Range over source offsets inside `element` (no selection change). */
export function rangeForOffsets(element: HTMLElement, range: TextRange): Range | null {
  const root = element as unknown as TextWalkNode;
  const start = pointAtOffset(root, range.from, 'forward');
  const end = pointAtOffset(root, range.to, 'backward');
  if (!start || !end) return null;
  const dom = document.createRange();
  dom.setStart(start.node as unknown as Node, start.offset);
  dom.setEnd(end.node as unknown as Node, end.offset);
  return dom;
}

/** Select source offsets inside `element` and return the range (null when the offsets are outside the text). */
export function restoreReadingSelection(element: HTMLElement, range: TextRange): Range | null {
  const dom = rangeForOffsets(element, range);
  if (!dom) return null;
  const current = window.getSelection();
  current?.removeAllRanges(); current?.addRange(dom);
  return dom;
}

const MIRRORED = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariantNumeric', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform', 'tabSize'] as const;

/** Vertical position of a caret offset inside a textarea, measured with an invisible mirror of its text. */
export function caretTopInTextarea(editor: HTMLTextAreaElement, offset: number): number {
  const style = getComputedStyle(editor);
  const mirror = document.createElement('div');
  for (const property of MIRRORED) mirror.style[property] = style[property];
  Object.assign(mirror.style, { position: 'absolute', top: '0', left: '-99999px', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: style.wordBreak });
  mirror.textContent = editor.value.slice(0, Math.max(0, Math.min(offset, editor.value.length)));
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}
