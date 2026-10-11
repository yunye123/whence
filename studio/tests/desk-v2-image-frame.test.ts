import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageOverview } from '../src/cards/overview/ImageOverview';
import { render } from './helpers/card-faces';
import { queryAll } from './helpers/markup';
import type { CardData } from '../src/model';

const photo: CardData = { kind: 'image', title: '原图 · 01', body: '', url: '/photo.png' };
const table: CardData = { kind: 'frame', title: '清晨的街', body: '' };
test('photo/title/footer/expand contract survives v2 without adding a duplicate caption DOM', () => {
  const html = render(photo);
  assert.equal(queryAll(html, { tag: 'header' }).length, 1);
  assert.equal(queryAll(html, { tag: 'footer' }).length, 1);
  assert.equal(queryAll(html, { tag: 'h3' }).length, 1);
  assert.ok(html.includes('field-card__image-button card-drag-content'));
  assert.ok(html.includes('field-card__image-expand nodrag nowheel'));
  assert.ok(html.includes('data-stationery="photo"'));
  assert.ok(html.includes('查看原图：原图 · 01'));
});
for (const [state, overrides] of [
  ['readonly', { readOnly: true }], ['hand', { tool: 'hand' }],
  ['missing', { getMediaUrl: () => undefined, getMediaStatus: () => 'missing' as const }],
  ['loading', { getMediaUrl: () => undefined, getMediaStatus: () => 'loading' as const }],
] as const) test(`photo ${state}: unchanged state/action contract and DOM budget`, () => {
  const data = { ...photo, ...(state === 'missing' || state === 'loading' ? { mediaId: 'absent', url: undefined } : {}) };
  const html = render(data, overrides);
  assert.equal(queryAll(html, { tag: 'article' }).length, 1);
  assert.ok(queryAll(html, {}).filter(e => e.tag !== 'wbr').length <= 36, 'photo baseline24 ×1.5, no wbr');
  if (state === 'missing') assert.ok(html.includes('is-media-missing'));
  if (state === 'loading') assert.ok(html.includes('正在读取图片'));
  if (state === 'readonly') assert.ok(html.includes('is-readonly'));
});
test('lighttable keeps its 8px edge DOM, count and unique material within baseline15 ×1.5', () => {
  const html = render(table, { frameMemberCount: () => 9 });
  assert.ok(html.includes('data-stationery="lighttable"'));
  assert.ok(html.includes('field-card__tray-edge card-drag-content'));
  assert.ok(html.includes('9 张'));
  const count = queryAll(html, {}).filter(e => e.tag !== 'wbr').length;
  assert.ok(count <= 22 && count <= 150, String(count));
});
test('far image is a picture silhouette or an explicit missing-picture placeholder', () => {
  const media = { source: '/photo.png', mediaError: false, loadingMedia: false, unavailableMedia: false, mediaStateMessage: '', setMediaError() {}, setPosterError() {} };
  const html = renderToStaticMarkup(createElement(ImageOverview, { data: photo, title: photo.title, media }));
  assert.ok(html.includes('data-photo-preview="picture"'));
  assert.equal(queryAll(html, { tag: 'img' }).length, 1);
  const empty = renderToStaticMarkup(createElement(ImageOverview, { data: photo, title: photo.title, media: { ...media, source: undefined } }));
  assert.ok(empty.includes('data-photo-preview="missing"'));
  assert.ok(empty.includes('图片未找到'));
  const loading = renderToStaticMarkup(createElement(ImageOverview, { data: photo, title: photo.title, media: { ...media, source: undefined, loadingMedia: true } }));
  assert.ok(loading.includes('data-photo-preview="loading"'));
  assert.ok(loading.includes('正在读取图片'));
  assert.ok(!loading.includes('图片未找到'), 'loading is not a material failure');
});
