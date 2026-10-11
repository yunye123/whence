import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import TemplatePreview from '../src/dialogs/TemplatePreview';
import ModalShell from '../src/shell/ModalShell';
import { attr, getByRole } from './helpers/markup';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = (path: string) => postcss.parse(read(path));
function declaration(path: string, selector: string, property: string) {
  let value: string | undefined;
  css(path).walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(property, item => { value = item.value; });
  });
  return value;
}

test('desk v2 dialog material and hierarchy use panel, serif title and 14px UI', () => {
  const frame = 'src/styles/components/dialog.css';
  const controls = 'src/styles/components/dialog-controls.css';
  assert.equal(declaration(frame, '.modal', 'background'), 'var(--bg-panel)');
  assert.equal(declaration(frame, '.modal-backdrop', 'animation'), 'none');
  assert.equal(declaration(frame, '.modal-backdrop', 'background-color'), 'rgb(from var(--bg-scrim) r g b / calc(round(nearest, alpha * 255, 1) / 255))');
  assert.equal(declaration(frame, '.modal-backdrop', 'backdrop-filter'), 'blur(var(--modal-backdrop-blur))');
  assert.equal(declaration(controls, 'dialog.inspector-dialog', 'background'), 'var(--bg-panel)');
  assert.match(declaration(controls, '.modal-title', 'font')!, /var\(--fs-h3\).*var\(--font-read\)/);
  assert.match(declaration(frame, '.modal', 'font')!, /var\(--fs-ui\)\/22px/);
  assert.match(declaration(controls, '.modal-subtitle', 'font')!, /var\(--type-meta\)/);
});

test('new board miniature keeps real layouts and uses flat stationery, without the old hanging tag or paper stack', () => {
  for (const template of ['blank', 'writing', 'video', 'design'] as const) {
    const html = renderToStaticMarkup(createElement(TemplatePreview, { template }));
    assert.match(html, /viewBox=/);
    assert.doesNotMatch(html, /tp-sheet|tp-tag/);
    assert.match(html, /tp-dot/);
  }
  const preview = read('src/styles/features/dialogs.css');
  assert.match(preview, /\.tp-dot\s*\{\s*fill: var\(--edge-ink\)/);
  assert.doesNotMatch(preview, /var\(--(?:bg-surface|bg-paper|bg-elevated|source-[\w-]+|draft-sheet-[\w-]+|canvas-grid-[\w-]+)\)/);
});

test('viewer numeric and annotation typography are independent from interface text', () => {
  const viewer = read('src/styles/features/viewer.css');
  assert.match(viewer, /\.viewer__num[^}]*font:[^;]*var\(--fs-xs\)\/18px var\(--font-mono\)/);
  assert.match(viewer, /\.viewer__mine[^}]*font:[^;]*var\(--fs-ui\)\/23px var\(--font-note\)/);
});

test('modal shell keeps named modal and close control, including a locked close', () => {
  const html = renderToStaticMarkup(createElement(ModalShell, {
    kind: 'new', locked: true, closeDisabled: true, onClose() {},
    children: createElement('h2', { id: 'modal-title' }, '新建画布'),
  }));
  const dialog = getByRole(html, 'dialog');
  assert.equal(attr(dialog, 'aria-modal'), 'true');
  assert.equal(attr(dialog, 'aria-labelledby'), 'modal-title');
  assert.equal(attr(getByRole(html, 'button', '关闭对话框'), 'disabled'), '');
});

test('transcript dialog presentation overrides live in this package and keep source contract copy', () => {
  const presentation = read('src/styles/features/dialogs-help.css');
  assert.match(presentation, /watch-correct-dialog::backdrop[^}]*background: var\(--bg-scrim\)/);
  assert.match(presentation, /watch-correct__field textarea[^}]*var\(--fs-ui\)\/23px/);
  assert.match(read('src/inspector/ReplaceTranscriptDialog.tsx'), /data-autofocus.*onClick=\{onCancel\}>取消/);
  assert.match(read('src/inspector/TranscriptCorrectionDialog.tsx'), /时间与来源保持不变/);
});
