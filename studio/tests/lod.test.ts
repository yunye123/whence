import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import {
  GRID_FADE_BELOW, LOD_FULL_MIN, LOD_SIMPLE_MIN, MOVE_SETTLE_MS, createZoomVariables, formatZoom, heldHeight, lodForZoom,
  zoomTier, type CanvasLod, type Schedule, type ZoomVariableTarget,
} from '../src/canvas/lod';
import { LOD_FULL_MIN as EDGE_FULL_MIN, LOD_SIMPLE_MIN as EDGE_SIMPLE_MIN, zoomTier as edgeZoomTier } from '../src/canvas/edges/layout';
import { CardOverview, draftOverviewParagraphs, frameLabelBlocked, overviewText, unbreakableHyphens } from '../src/cards/CardOverview';
import type { CardData } from '../src/model';
import type { CardMedia } from '../src/cards/types';
import { assertNone, getBy, queryAll, textContent } from './helpers/markup';

// DESIGN_SYSTEM §6.16 and §0 rules 3–4, K9-7: three tiers by zoom, one enum per card, `--z-tier` quantized
// down to 0.05 and written only at tier switches and when the viewport settles, `--z` for strokes only.

test('C16: full from 0.86, simple from 0.5, overview below 0.5 (edges use the same thresholds)', () => {
  assert.equal(LOD_FULL_MIN, .86);
  assert.equal(LOD_SIMPLE_MIN, .5);
  assert.equal(EDGE_FULL_MIN, LOD_FULL_MIN);
  assert.equal(EDGE_SIMPLE_MIN, LOD_SIMPLE_MIN);
  const cases: Array<[number, CanvasLod]> = [[2, 'full'], [1, 'full'], [.86, 'full'], [.8599, 'simple'], [.85, 'simple'], [.7, 'simple'], [.5, 'simple'], [.4999, 'far'], [.2, 'far']];
  for (const [zoom, lod] of cases) assert.equal(lodForZoom(zoom), lod, `zoom ${zoom}`);
});

test('--z-tier rounds down to 0.05 so compensated text is never below its nominal screen size', () => {
  assert.equal(zoomTier(1), 1);
  assert.equal(zoomTier(.85), .85);
  assert.equal(zoomTier(.7), .7, 'exact tiers survive floating point (0.7 × 20 = 13.999…)');
  assert.equal(zoomTier(.42), .4);
  assert.equal(zoomTier(.499), .45);
  assert.equal(zoomTier(.2), .2);
  assert.equal(zoomTier(.01), .05, 'never 0 (it is a divisor)');
  assert.equal(zoomTier(Number.NaN), 1);
  assert.equal(zoomTier(0), 1);
  for (let zoom = .2; zoom <= 2; zoom += .013) {
    const tier = zoomTier(zoom);
    assert.ok(tier <= zoom + 1e-9, `tier ${tier} ≤ zoom ${zoom}`);
    assert.ok(zoom - tier < .05, `tier ${tier} within one step of zoom ${zoom}`);
    // 13px / tier on screen is 13 × zoom / tier ≥ 13.
    assert.ok(13 * zoom / tier >= 13 - 1e-9);
  }
  assert.equal(edgeZoomTier(.42), zoomTier(.42), 'edge labels quantize the same way');
  assert.equal(formatZoom(.123456), '0.1235');
});

function recorder() {
  const writes: string[] = [];
  const target: ZoomVariableTarget = {
    setVariable: (name, value) => writes.push(`${name}=${value}`),
    setLod: lod => writes.push(`lod=${lod}`),
    setGridOff: off => writes.push(`grid-off=${off}`),
    setMoving: moving => writes.push(`moving=${moving}`),
  };
  let pending: { callback: () => void; ms: number } | null = null;
  const schedule: Schedule = (callback, ms) => {
    pending = { callback, ms };
    return () => { if (pending?.callback === callback) pending = null; };
  };
  const flush = () => { const job = pending; pending = null; job?.callback(); return job?.ms; };
  return { writes, target, schedule, flush, get pending() { return pending; } };
}

test('panning writes nothing but the moving flag; settling clears it (no per-frame variable writes)', () => {
  const r = recorder();
  const tiers: number[] = [];
  const vars = createZoomVariables(r.target, r.schedule, tier => tiers.push(tier));
  vars.reset(.86);
  assert.deepEqual(r.writes, ['--z=0.86', '--z-tier=0.85', 'lod=full', 'grid-off=false', 'moving=false']);
  r.writes.length = 0;
  for (let frame = 0; frame < 24; frame++) vars.update(.86); // a pan: transform changes, zoom does not
  assert.deepEqual(r.writes, ['moving=true'], 'a pan writes the moving flag once and no variables');
  assert.equal(r.flush(), MOVE_SETTLE_MS);
  assert.deepEqual(r.writes, ['moving=true', 'moving=false'], 'settling at the same tier rewrites nothing');
  assert.deepEqual(tiers, [.85]);
});

test('zooming rewrites --z every change but --z-tier only at tier switches and when the viewport settles', () => {
  const r = recorder();
  const tiers: number[] = [];
  const vars = createZoomVariables(r.target, r.schedule, tier => tiers.push(tier));
  vars.reset(1);
  r.writes.length = 0;
  tiers.length = 0;
  // A wheel gesture from 100% to 30%: each tick about ×0.92.
  const zooms: number[] = [];
  for (let zoom = 1; zoom > .3; zoom *= .92) zooms.push(zoom);
  zooms.shift();
  for (const zoom of zooms) vars.update(zoom);
  const tierWrites = r.writes.filter(write => write.startsWith('--z-tier='));
  const zWrites = r.writes.filter(write => write.startsWith('--z='));
  assert.equal(zWrites.length, zooms.length, '--z follows every zoom change (strokes only)');
  assert.deepEqual(tierWrites, ['--z-tier=0.8', '--z-tier=0.45'], 'only the two tier switches write --z-tier during the gesture');
  assert.deepEqual(r.writes.filter(write => write.startsWith('lod=')), ['lod=simple', 'lod=far']);
  assert.deepEqual(r.writes.filter(write => write.startsWith('grid-off=')), ['grid-off=true'], 'the dot grid fades below 0.6');
  assert.ok(GRID_FADE_BELOW > LOD_SIMPLE_MIN && GRID_FADE_BELOW < LOD_FULL_MIN);
  assert.ok(r.pending, 'the settle timer is armed while the gesture runs');
  r.flush();
  const final = zoomTier(zooms.at(-1)!);
  assert.equal(r.writes.at(-1), `--z-tier=${final}`, 'the move end writes the final quantized tier');
  assert.equal(r.writes.at(-2), 'moving=false');
  assert.deepEqual(tiers, [.8, .45, final]);
  assert.equal(vars.state.lod, 'far');
});

test('every update re-arms the settle timer; disposing cancels it', () => {
  const r = recorder();
  const vars = createZoomVariables(r.target, r.schedule);
  vars.reset(1);
  vars.update(.9);
  const first = r.pending;
  vars.update(.88);
  assert.notEqual(r.pending, first, 'a new change replaces the pending settle');
  vars.dispose();
  assert.equal(r.pending, null);
  vars.update(Number.NaN);
  vars.update(0);
  assert.equal(vars.state.zoom, .88, 'invalid zooms are ignored');
});

test('the simple tier holds a content-sized card at its measured height; explicit heights need no hold', () => {
  const lookup = new Map<string, unknown>([
    ['content', { measured: { width: 272, height: 118 } }],
    ['explicit', { height: 210, measured: { width: 250, height: 210 } }],
    ['styled', { style: { height: 184 }, measured: { width: 138, height: 184 } }],
    ['auto', { style: { height: 'auto' }, measured: { width: 300, height: 96 } }],
    ['unmeasured', {}],
  ]);
  const state = { nodeLookup: lookup } as unknown as Parameters<typeof heldHeight>[0];
  assert.equal(heldHeight(state, 'content'), 118);
  assert.equal(heldHeight(state, 'explicit'), -1);
  assert.equal(heldHeight(state, 'styled'), -1);
  assert.equal(heldHeight(state, 'auto'), 96);
  assert.equal(heldHeight(state, 'unmeasured'), 0, 'a card never measured keeps its natural layout');
  assert.equal(heldHeight(state, 'missing'), 0);
});

// ── Overview silhouettes (§6.9–6.15 “概览”, C14) ───────────────────────────────────────────────────

const media: CardMedia = {
  mediaError: false, loadingMedia: false, unavailableMedia: false, mediaStateMessage: '',
  setMediaError: () => {}, setPosterError: () => {},
};
const overview = (data: Partial<CardData>, extra: Partial<Parameters<typeof CardOverview>[0]> = {}) =>
  renderToStaticMarkup(createElement(ReactFlowProvider, null,
    createElement(CardOverview, { data: { kind: 'note', title: '样本', body: '', ...data } as CardData, media, title: data.title ?? '样本', ...extra })));

test('silhouette text is plain readable text: no Markdown marks, no line breaks', () => {
  assert.equal(overviewText('# 开头\n\n**不要**讲大道理，[先讲](https://example.org)一个具体的人。\n- 一条'), '开头不要讲大道理，先讲一个具体的人。一条');
  assert.equal(overviewText('城市醒来之前的那一个小时。\n冷青蓝打底'), '城市醒来之前的那一个小时。冷青蓝打底', 'a line break between Chinese text joins without a space');
  assert.equal(overviewText('15-Minute City\nby Carlos Moreno'), '15-Minute City by Carlos Moreno', 'Latin words keep their space');
  assert.equal(overviewText(undefined), '');
  assert.equal(unbreakableHyphens('15-Minute City'), '15‑Minute City');
  assert.equal(unbreakableHyphens('十五分钟-城市'), '十五分钟-城市', 'Chinese titles keep their own breaking');
});

test('draft bars: quoted passages are marked and footnotes tie to the passage they cite', () => {
  const body = '凌晨四点，老周的早餐摊已经亮着灯。\n\n> 一座城市是否宜居，要看一个人步行十五分钟能完成多少件事。\n\n[来源：步行十五分钟](field://node/src1?quote=q1)\n\n我原本想写一篇关于城市规划的文章。[来源：调查](field://node/src2?quote=q2)';
  const paragraphs = draftOverviewParagraphs(body);
  assert.equal(paragraphs.length, 3);
  assert.deepEqual(paragraphs.map(p => p.cited), [false, true, false]);
  assert.equal(paragraphs[1].text, '一座城市是否宜居，要看一个人步行十五分钟能完成多少件事。');
  assert.ok(!paragraphs.some(p => /field:|\[|\]|>/.test(p.text)), 'no protocol, brackets or quote marks in the bars');
  assert.deepEqual(paragraphs.map(p => p.footnotes.length), [0, 1, 1]);
});

test('every kind draws a readable silhouette with an h3 and never writes the card type (C14)', () => {
  const quote = overview({ kind: 'quote', title: '摘录 · 01:12', body: '我的理解', citation: { nodeId: 'v', title: '早餐摊', text: '摊主说，四点出摊不是为了赚钱。', start: 72, end: 86 } });
  assert.match(textContent(getBy(quote, { tag: 'h3' })), /摊主说，四点出摊不是为了赚钱。/);
  assert.ok(!textContent(quote).includes('我的理解'), 'C28/PLAN §2.10: far keeps source prose and hides the reading');
  assert.ok(getBy(quote, { attrs: { 'data-edge-anchor': 'stamp' } }), 'C28: the inert stamp silhouette keeps its paper-edge anchor');
  assertNone(quote, { attrs: { 'data-edge-anchor': 'tag-hole' } }, 'the retired tag hole cannot return in far');
  for (const [data, expected] of [
    [{ kind: 'note', body: '开头不要讲大道理，先讲一个具体的人。' }, /开头不要讲大道理/],
    [{ kind: 'draft', title: '十五分钟的城市', body: '第一段。\n\n第二段。' }, /十五分钟的城市/],
    [{ kind: 'link', title: '15-Minute City', url: 'https://example.org' }, /15‑Minute City/],
    [{ kind: 'video', title: '凌晨四点的早餐摊' }, /凌晨四点的早餐摊/],
    [{ kind: 'image', title: '头班车出站' }, /头班车出站/],
    [{ kind: 'frame', title: '光线参考' }, /光线参考/],
    [{ kind: 'note', title: '空笔记', body: '' }, /空笔记/],
  ] as Array<[Partial<CardData>, RegExp]>) {
    const html = overview(data);
    const root = getBy(html, { className: 'field-card__overview' });
    assert.equal(root.attrs['aria-hidden'], 'true', `${data.kind}: the surface keeps the accessible name`);
    assert.match(textContent(getBy(html, { tag: 'h3' })), expected, `${data.kind}: a readable main line, never an empty box`);
    assertNone(html, { className: 'field-card__overview-kind' }, `${data.kind}: no type label on the card face`);
    assert.ok(root.attrs.class.split(' ').includes('card-drag'), `${data.kind}: the silhouette is a drag surface`);
  }
  assert.ok(getBy(overview({ kind: 'frame', title: '光线参考' }), { className: 'field-card__overview-content' }), 'the frame label stays a pointer target (scripts click it)');
  assert.match(textContent(overview({ kind: 'frame', title: '光线参考' }, { frameCount: 5 })), /5 张/);
});

test('a playing video keeps a light dot in the overview instead of the play mark (CV-M3)', () => {
  const playing = overview({ kind: 'video', title: '早餐摊' }, { playing: true });
  const idle = overview({ kind: 'video', title: '早餐摊' });
  assert.equal(queryAll(playing, { className: 'field-card__overview-live' }).length, 1);
  assert.equal(queryAll(playing, { className: 'field-card__overview-play' }).length, 0);
  assert.equal(queryAll(idle, { className: 'field-card__overview-play' }).length, 1, 'positive control');
});

test('a frame label turns into a compact sunk tab only when the band above the tray is taken', () => {
  const node = (id: string, x: number, y: number, width: number, height: number) =>
    [id, { id, internals: { positionAbsolute: { x, y } }, measured: { width, height } }] as const;
  // Two trays stacked 40 canvas units apart (the creative example), a note to the left.
  const lookup = new Map<string, unknown>([
    node('light', 400, 0, 700, 360), node('people', 400, 400, 700, 420), node('note', 0, 0, 240, 200),
  ]);
  const at = (zoom: number) => ({ nodeLookup: lookup, transform: [0, 0, zoom] }) as unknown as Parameters<typeof frameLabelBlocked>[0];
  assert.equal(frameLabelBlocked(at(1), 'people'), false, 'at 100% a 26px label fits in the 40-unit gap');
  assert.equal(frameLabelBlocked(at(.42), 'people'), true, 'at 42% the label needs 65 units: a compact tab sunk into its own tray');
  assert.equal(frameLabelBlocked(at(.42), 'light'), false, 'nothing above the first tray: the label stays outside');
  assert.equal(frameLabelBlocked(at(.42), 'missing'), false);
});
