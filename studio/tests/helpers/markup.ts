// Order-independent queries over `renderToStaticMarkup` output.
//
// Render tests should assert behaviour contracts (accessible names, roles, test ids, disabled/readOnly
// state, React Flow interaction classes such as `nodrag`/`nowheel`/`nokey`, visible meaning) and not the
// exact class string, JSX attribute order or presentational wrapper elements. These helpers parse the
// static markup into a small element tree so a test can find an element by aria-label, data-testid or
// role and then check attributes regardless of their order.
//
// Negative checks: prefer `getBy*` (asserts the element exists) followed by a state check such as
// `assert.equal(isDisabled(el), false)` instead of `doesNotMatch(html, /x"[^>]*disabled/)`, which passes
// silently when the class or attribute it keys on is renamed. When asserting absence with `queryAll`,
// pair it with a positive control rendering in which the same query does find the element.
import assert from 'node:assert/strict';

export interface MarkupText { kind: 'text'; text: string }
export interface MarkupElement {
  kind: 'element';
  /** Lowercase tag name. */
  tag: string;
  /** Attribute names are lowercased (React emits `readOnly`, HTML is case-insensitive); values are entity-decoded. */
  attrs: Record<string, string>;
  /** The raw start tag, for assertion messages only. */
  raw: string;
  parent: MarkupElement | null;
  children: MarkupNode[];
}
export type MarkupNode = MarkupElement | MarkupText;
export type Scope = string | MarkupElement;

export interface Query {
  /** Accessible label from aria-label, or the text of the aria-labelledby targets. Strings match exactly. */
  label?: string | RegExp;
  testId?: string | RegExp;
  /** Explicit role attribute, or the implicit role of common elements (button, link, textbox, region, …). */
  role?: string;
  /** Accessible name: label, else alt/value/text content/title. Strings match the trimmed name exactly. */
  name?: string | RegExp;
  /** Lowercase tag name. Use only when the element type itself is the contract (e.g. `video`, `blockquote`). */
  tag?: string;
  /** Text content of the element (strings match a substring). */
  text?: string | RegExp;
  /** A single class token, e.g. a React Flow interaction class such as `nodrag` or `card-drag-content`. */
  className?: string;
  /** Attribute presence (`true`) or value (string = exact, RegExp = test). Names are case-insensitive. */
  attrs?: Record<string, string | RegExp | true>;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
const parsed = new Map<string, MarkupElement>();

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[lower];
  });
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

/** Parses static markup into a synthetic `#root` element. Results are cached per markup string. */
export function parseMarkup(html: string): MarkupElement {
  const cached = parsed.get(html);
  if (cached) return cached;
  const root: MarkupElement = { kind: 'element', tag: '#root', attrs: {}, raw: '', parent: null, children: [] };
  let current = root;
  let index = 0;
  const pushText = (text: string) => { if (text) current.children.push({ kind: 'text', text: decodeEntities(text) }); };
  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open < 0) { pushText(html.slice(index)); break; }
    pushText(html.slice(index, open));
    if (html.startsWith('<!--', open)) {
      const close = html.indexOf('-->', open + 4);
      index = close < 0 ? html.length : close + 3;
      continue;
    }
    if (html[open + 1] === '/') {
      const close = html.indexOf('>', open);
      const name = html.slice(open + 2, close).trim().toLowerCase();
      let cursor: MarkupElement | null = current;
      while (cursor && cursor !== root && cursor.tag !== name) cursor = cursor.parent;
      if (cursor && cursor !== root) current = cursor.parent ?? root;
      index = close + 1;
      continue;
    }
    if (html[open + 1] === '!' || html[open + 1] === '?') { index = html.indexOf('>', open) + 1 || html.length; continue; }
    let close = open + 1;
    let quote: string | null = null;
    for (; close < html.length; close++) {
      const char = html[close];
      if (quote) { if (char === quote) quote = null; } else if (char === '"' || char === "'") quote = char; else if (char === '>') break;
    }
    const raw = html.slice(open, close + 1);
    const inner = raw.slice(1, -1).replace(/\/\s*$/, '');
    const nameMatch = /^([^\s\/>]+)/.exec(inner);
    const tag = (nameMatch?.[1] ?? '').toLowerCase();
    const element: MarkupElement = { kind: 'element', tag, attrs: parseAttributes(inner.slice(tag.length)), raw, parent: current, children: [] };
    current.children.push(element);
    index = close + 1;
    if (VOID.has(tag) || /\/\s*>$/.test(raw)) continue;
    if (RAW_TEXT.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, index);
      const stop = end < 0 ? html.length : end;
      if (stop > index) element.children.push({ kind: 'text', text: decodeEntities(html.slice(index, stop)) });
      index = end < 0 ? html.length : html.indexOf('>', end) + 1;
      continue;
    }
    current = element;
  }
  parsed.set(html, root);
  return root;
}

function rootOf(scope: Scope): MarkupElement { return typeof scope === 'string' ? parseMarkup(scope) : scope; }
function topOf(element: MarkupElement): MarkupElement { let cursor = element; while (cursor.parent) cursor = cursor.parent; return cursor; }

/** Every element below the scope (the scope element itself is excluded), in document order. */
export function descendants(scope: Scope): MarkupElement[] {
  const result: MarkupElement[] = [];
  const walk = (element: MarkupElement) => { for (const child of element.children) if (child.kind === 'element') { result.push(child); walk(child); } };
  walk(rootOf(scope));
  return result;
}

export function attr(element: MarkupElement, name: string): string | undefined { return element.attrs[name.toLowerCase()]; }
export function hasAttr(element: MarkupElement, name: string): boolean { return name.toLowerCase() in element.attrs; }
export function classList(element: MarkupElement): string[] { return (element.attrs.class ?? '').split(/\s+/).filter(Boolean); }
export function hasClass(element: MarkupElement, token: string): boolean { return classList(element).includes(token); }
export function isDisabled(element: MarkupElement): boolean { return hasAttr(element, 'disabled') || attr(element, 'aria-disabled') === 'true'; }
export function isReadOnly(element: MarkupElement): boolean { return hasAttr(element, 'readonly') || attr(element, 'aria-readonly') === 'true'; }
export function isButton(element: MarkupElement): boolean { return roleOf(element) === 'button'; }

/** Decoded text content (comments excluded). */
export function textContent(scope: Scope): string {
  const element = rootOf(scope);
  return element.children.map(child => child.kind === 'text' ? child.text : textContent(child)).join('');
}

/** Current value of a form control: textarea text, input/select `value`, or contenteditable text. */
export function fieldValue(element: MarkupElement): string {
  if (element.tag === 'input') return attr(element, 'value') ?? '';
  return textContent(element);
}

export function roleOf(element: MarkupElement): string | undefined {
  const explicit = attr(element, 'role');
  if (explicit) return explicit.split(/\s+/)[0];
  const type = (attr(element, 'type') ?? '').toLowerCase();
  switch (element.tag) {
    case 'button': return 'button';
    case 'a': return hasAttr(element, 'href') ? 'link' : undefined;
    case 'textarea': return 'textbox';
    case 'input':
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'search') return 'searchbox';
      if (['', 'text', 'email', 'tel', 'url'].includes(type)) return 'textbox';
      return undefined;
    case 'select': return 'combobox';
    case 'summary': return 'button';
    case 'img': return attr(element, 'alt') === '' ? 'presentation' : 'img';
    case 'section': return accessibleLabel(element) ? 'region' : undefined;
    case 'aside': return 'complementary';
    case 'nav': return 'navigation';
    case 'main': return 'main';
    case 'dialog': return 'dialog';
    case 'ul': case 'ol': return 'list';
    case 'li': return 'listitem';
    case 'mark': return 'mark';
    case 'blockquote': return 'blockquote';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
    default: return undefined;
  }
}

const LABELABLE = new Set(['input', 'textarea', 'select', 'button', 'meter', 'output', 'progress']);

/** aria-labelledby text, aria-label, or an associated <label> (for=id or wrapping), resolved inside the same markup. */
export function accessibleLabel(element: MarkupElement): string | undefined {
  const labelledBy = attr(element, 'aria-labelledby');
  if (labelledBy) {
    const all = descendants(topOf(element));
    const text = labelledBy.split(/\s+/).map(id => all.find(candidate => attr(candidate, 'id') === id)).filter(Boolean).map(target => textContent(target!).trim()).join(' ');
    if (text) return text;
  }
  const label = attr(element, 'aria-label');
  if (label !== undefined) return label;
  if (!LABELABLE.has(element.tag)) return undefined;
  const id = attr(element, 'id');
  const forLabel = id ? descendants(topOf(element)).find(candidate => candidate.tag === 'label' && attr(candidate, 'for') === id) : undefined;
  const wrapping = forLabel ?? closest(element, candidate => candidate.tag === 'label');
  if (!wrapping) return undefined;
  const own = (node: MarkupElement): string => node.children.map(child => child.kind === 'text' ? child.text : child === element ? '' : own(child)).join('');
  const text = own(wrapping).replace(/\s+/g, ' ').trim();
  return text || undefined;
}

/** Approximate accessible name: label, then alt (img), value (input buttons), text content, then title. */
export function accessibleName(element: MarkupElement): string {
  const label = accessibleLabel(element);
  if (label) return label;
  if (element.tag === 'img') return attr(element, 'alt') ?? '';
  if (element.tag === 'input' && ['button', 'submit', 'reset'].includes((attr(element, 'type') ?? '').toLowerCase())) return attr(element, 'value') ?? '';
  const text = textContent(element).replace(/\s+/g, ' ').trim();
  return text || attr(element, 'title') || '';
}

function matches(value: string | undefined, expected: string | RegExp, substring = false): boolean {
  if (value === undefined) return false;
  if (typeof expected === 'string') return substring ? value.includes(expected) : value === expected;
  expected.lastIndex = 0;
  return expected.test(value);
}

export function matchesQuery(element: MarkupElement, query: Query): boolean {
  if (query.tag && element.tag !== query.tag.toLowerCase()) return false;
  if (query.testId !== undefined && !matches(attr(element, 'data-testid'), query.testId)) return false;
  if (query.label !== undefined && !matches(accessibleLabel(element), query.label)) return false;
  if (query.role && roleOf(element) !== query.role) return false;
  if (query.className && !hasClass(element, query.className)) return false;
  if (query.name !== undefined && !matches(accessibleName(element).trim(), query.name)) return false;
  if (query.text !== undefined && !matches(textContent(element), query.text, true)) return false;
  for (const [name, expected] of Object.entries(query.attrs ?? {})) {
    if (expected === true ? !hasAttr(element, name) : !matches(attr(element, name), expected)) return false;
  }
  return true;
}

export function queryAll(scope: Scope, query: Query): MarkupElement[] { return descendants(scope).filter(element => matchesQuery(element, query)); }
export function queryOne(scope: Scope, query: Query): MarkupElement | undefined { return descendants(scope).find(element => matchesQuery(element, query)); }

function describe(query: Query): string {
  return JSON.stringify(query, (_, value) => value instanceof RegExp ? String(value) : value);
}
function inventory(scope: Scope): string {
  const elements = descendants(scope);
  const labels = [...new Set(elements.map(accessibleLabel).filter(Boolean))].slice(0, 60);
  const ids = [...new Set(elements.map(element => attr(element, 'data-testid')).filter(Boolean))].slice(0, 30);
  return `labels: ${labels.join(' | ') || '(none)'}; testids: ${ids.join(' | ') || '(none)'}`;
}

/** The first element matching the query; fails (with an inventory of labels/test ids) when there is none. */
export function getBy(scope: Scope, query: Query, message?: string): MarkupElement {
  const found = queryOne(scope, query);
  if (!found) assert.fail(`${message ? `${message}: ` : ''}no element matches ${describe(query)}. Available ${inventory(scope)}`);
  return found;
}
export function getAllBy(scope: Scope, query: Query, message?: string): MarkupElement[] {
  const found = queryAll(scope, query);
  if (!found.length) assert.fail(`${message ? `${message}: ` : ''}no element matches ${describe(query)}. Available ${inventory(scope)}`);
  return found;
}
export function getByLabel(scope: Scope, label: string | RegExp, extra: Omit<Query, 'label'> = {}): MarkupElement { return getBy(scope, { ...extra, label }); }
export function getByTestId(scope: Scope, testId: string | RegExp, extra: Omit<Query, 'testId'> = {}): MarkupElement { return getBy(scope, { ...extra, testId }); }
export function getByRole(scope: Scope, role: string, name?: string | RegExp, extra: Omit<Query, 'role' | 'name'> = {}): MarkupElement {
  return getBy(scope, { ...extra, role, ...(name === undefined ? {} : { name }) });
}

/** The innermost element whose text contains (string) or matches (RegExp) the given text. */
export function getByText(scope: Scope, text: string | RegExp, extra: Omit<Query, 'text'> = {}): MarkupElement {
  const found = getAllBy(scope, { ...extra, text });
  return found.find(element => !found.some(other => other !== element && isInside(other, element)))!;
}

/** Asserts no element matches. Pair with a positive control in which the same query does match. */
export function assertNone(scope: Scope, query: Query, message?: string): void {
  const found = queryAll(scope, query);
  assert.equal(found.length, 0, `${message ? `${message}: ` : ''}expected no element for ${describe(query)}, found ${found.map(element => element.raw).join(' ')}`);
}

export function closest(element: MarkupElement, predicate: Query | ((candidate: MarkupElement) => boolean)): MarkupElement | undefined {
  const test = typeof predicate === 'function' ? predicate : (candidate: MarkupElement) => matchesQuery(candidate, predicate);
  for (let cursor = element.parent; cursor && cursor.tag !== '#root'; cursor = cursor.parent) if (test(cursor)) return cursor;
  return undefined;
}
export function isInside(element: MarkupElement, ancestor: MarkupElement): boolean {
  for (let cursor = element.parent; cursor; cursor = cursor.parent) if (cursor === ancestor) return true;
  return false;
}

/** True when the text, or any attribute value (title, aria-*, …), in the scope contains the needle. */
export function mentions(scope: Scope, needle: string | RegExp): boolean {
  const root = rootOf(scope);
  if (matches(textContent(root), needle, true)) return true;
  return [root, ...descendants(root)].some(element => Object.values(element.attrs).some(value => matches(value, needle, true)));
}
