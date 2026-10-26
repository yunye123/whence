// PLAN v2 §5.1 K3/K4/K6/K10. These are explicit compatibility contracts,
// independently rendered from product components, not source-string snapshots.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider, type Node, type NodeProps } from '@xyflow/react';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import CanvasCard from '../src/CanvasCard';
import { CardOverview } from '../src/cards/CardOverview';
import { BoardContext, CardContext, type BoardActions, type CardActions } from '../src/board-context';
import { createExampleBoard } from '../src/templates';
import type { BoardNode, CardData, CardKind, Workspace } from '../src/model';
import { formatDraftQuote } from '../src/draft-references';
import TopBar from '../src/shell/TopBar';
import Sidebar from '../src/shell/Sidebar';
import CanvasToolbar from '../src/shell/CanvasToolbar';
import ZoomControls from '../src/shell/ZoomControls';
import CanvasLayers from '../src/shell/CanvasLayers';
import CanvasRail from '../src/shell/CanvasRail';
import Welcome from '../src/shell/Welcome';
import EmptyCanvas from '../src/shell/EmptyCanvas';
import OutlineView from '../src/shell/OutlineView';
import StatusBanners from '../src/shell/StatusBanners';
import ModalShell from '../src/shell/ModalShell';
import ExportDialog from '../src/dialogs/ExportDialog';
import NewBoardDialog from '../src/dialogs/NewBoardDialog';
import HelpDialog from '../src/dialogs/HelpDialog';
import VideoImportsDialog from '../src/dialogs/VideoImportsDialog';
import ImportDialog from '../src/dialogs/ImportDialog';
import Inspector from '../src/Inspector';
import DraftReferenceList from '../src/inspector/DraftReferenceList';
import ProvenanceTag from '../src/components/ProvenanceTag';
import CanvasSelectionTools from '../src/CanvasSelectionTools';
import { attr, getBy, getByLabel, getByRole, getByTestId, hasClass, queryAll, type Query } from './helpers/markup';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'output/desk-v2/W1-C');
const noop = () => {};
const source: BoardNode = { id: 'contract-video', type: 'card', position: { x: 0, y: 0 }, data: {
  kind: 'video', title: '契约原片', body: '', mediaId: 'contract-media', nativeAssetId: 'contract-asset',
  transcript: [{ id: 'contract-line', start: 72, end: 86, text: '契约原话。' }],
} };
const quote: BoardNode = { id: 'contract-quote', type: 'card', position: { x: 300, y: 0 }, data: {
  kind: 'quote', title: '摘录 · 01:12', body: '我的理解。', citation: { nodeId: source.id, title: source.data.title, text: '契约原话。', start: 72, end: 86 },
} };
const draft: BoardNode = { id: 'contract-draft', type: 'card', position: { x: 600, y: 0 }, data: { kind: 'draft', title: '契约文稿', body: '开头。' + formatDraftQuote(quote) } };
const board = createExampleBoard('video'); board.nodes.push(source, quote, draft);
const workspace: Workspace = { schema: 1, activeBoardId: board.id, boards: [board] };
const actions: BoardActions = {
  updateCard: () => true, openCard: noop, deleteCard: noop, duplicateCard: noop, addQuote: () => true, addTextQuote: () => true, focusSource: noop,
  openDraftSource: () => true, draftReturn: null, returnToDraft: () => true, draftRestore: null, completeDraftRestore: noop,
  getMediaUrl: id => id ? '/assets/scene-architecture.svg' : undefined, activeVideo: null, inspectedId: null, playVideo: noop,
  videoPlaybackVersion: 0, getVideoPlayback: () => ({ time: 0, paused: true }), bindVideoPlayer: noop, captureVideoPlayback: noop, restoreVideoPlayback: noop,
  setPendingTranscriptEdit: noop, cancelVideoImport: noop, retryVideoImport: noop, videoImportAvailable: true, videoImportActionPending: () => false,
  sourceParagraph: () => 3, quoteLocation: () => '01:12–01:26', nodes: board.nodes, nativeTranscribeAvailable: true, transcribeVideo: noop,
};
const cardActions: CardActions = { ...actions, sourceNodeIds: new Set(board.nodes.map(n => n.id)), tool: 'select' };
function render(child: ReactElement, overrides: Partial<BoardActions> = {}) {
  return renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(BoardContext.Provider, { value: { ...actions, ...overrides } }, child)));
}
function card(data: CardData, id = 'contract-card', overrides: Partial<CardActions> = {}) {
  return render(createElement(CardContext.Provider, { value: { ...cardActions, ...overrides } }, createElement(CanvasCard, { id, selected: true, data } as NodeProps<Node<CardData>>)));
}
function locks(html: string, query: Query, classes: string[] = []) {
  const element = getBy(html, query);
  for (const cls of classes) assert.ok(hasClass(element, cls), `K6 ${cls} on ${JSON.stringify(query)}`);
  return element;
}
function exportOptions(html: string) {
  const options = locks(html, { className: 'export-options' });
  // K6 protects the HTML button element. PLAN §4.6 explicitly permits radio roles.
  assert.ok(queryAll(options, { tag: 'button' }).length > 0);
  for (const name of ['文稿与参考资料', '灵感板', '便携画布文件', '另存完整画布目录']) getBy(options, { tag: 'button', name });
}
function topbar() {
  return render(createElement(TopBar, { board, readOnly: false, saveStatus: 'saved', saveError: '', sidebarOpen: true, onToggleSidebar: noop, onRename: noop, onRevealStorage: noop, view: 'canvas', onViewChange: noop, canUndo: true, canRedo: true, onUndo: noop, onRedo: noop, importTaskCount: 1, activeImportCount: 1, onOpenImports: noop, onOpenExport: noop }));
}
const kinds: CardKind[] = ['video', 'image', 'link', 'note', 'quote', 'draft', 'frame'];
for (const kind of kinds) test(`K6 ${kind}: card root, surface, display/LOD and resize contracts render`, () => {
  const data = kind === 'quote' ? quote.data : kind === 'draft' ? draft.data : { kind, title: '契约卡片', body: '保留正文。', mediaId: 'contract-media' };
  const html = card(data);
  locks(html, { tag: 'article' }, ['field-card', `field-card--${kind}`]);
  locks(html, { attrs: { 'data-display': 'detail', 'data-lod': 'full' } }, ['field-card']);
  for (const cls of ['field-card__surface', 'field-card__resize-line', 'field-card__resize-handle']) locks(html, { className: cls });
});
test('K6: overview, citation, footnote/ref, rail, tray edge and transcription hooks render', () => {
  for (const example of ['video', 'writing', 'creative'] as const) for (const node of createExampleBoard(example).nodes) {
    const html = card(node.data, node.id);
    if (node.data.kind === 'video') locks(html, { className: 'field-card__rail' });
    if (node.data.kind === 'frame') locks(html, { className: 'field-card__tray-edge' });
  }
  locks(card(quote.data), { role: 'button', name: '回到原片 01:12' }, ['field-card__citation', 'tag-btn', 'nodrag', 'nowheel']);
  locks(render(createElement(ProvenanceTag, { label: '01:12', onActivate: noop, actionLabel: '回到原片 01:12' })), { role: 'button', name: '回到原片 01:12' }, ['tag-btn', 'nodrag', 'nopan']);
  const textQuote = { ...quote.data, citation: { nodeId: source.id, title: '原文', text: '契约原话。', textAnchor: { from: 0, to: 5, prefix: '', suffix: '' } } };
  locks(card(textQuote), { role: 'button', name: '回到原文第 3 段' }, ['field-card__citation']);
  const written = card(draft.data);
  locks(written, { attrs: { 'data-footnote': '1' } }, ['field-card__footnote']);
  locks(written, { className: 'field-card__ref' });
  locks(card({ ...source.data, transcript: [] }), { className: 'field-card__transcribe' });
  locks(render(createElement(CardOverview, { data: { kind: 'note', title: '概览', body: '原话' }, title: '概览', media: { mediaError: false, loadingMedia: false, unavailableMedia: false, mediaStateMessage: '', setMediaError: noop, setPosterError: noop } })), { className: 'field-card__overview' });
});
test('K10: exact poster/player/image/draft/inert strings survive actual card rendering', () => {
  const video = card(source.data), playing = card(source.data, source.id, { activeVideo: source.id });
  assert.match(video, /class="field-card__poster-button card-drag-content"/);
  assert.match(video, /class="field-card__play nodrag nowheel"/);
  assert.match(playing, /<video class="nodrag nowheel nokey"/);
  assert.equal(attr(getBy(playing, { tag: 'video' }), 'controls'), undefined);
  const image = card({ kind: 'image', title: '契约图片', body: '', mediaId: 'contract-image' });
  assert.match(image, /class="field-card__image-button card-drag-content"/);
  assert.match(image, /class="field-card__image-expand nodrag nowheel"/);
  assert.match(card(draft.data), /class="field-card__draft-content card-drag-content"/);
  assert.match(card(source.data, source.id, { tool: 'hand' }), /field-card__surface" inert=""/);
});
test('K3/K4/K6: top bar ids, input/status semantics, names and class hooks', () => {
  const html = topbar();
  assert.equal(getByTestId(html, 'board-title').tag, 'input');
  locks(html, { testId: 'save-status', role: 'status', text: '已保存到本机' }, ['save-status']);
  for (const name of ['画布名称', '撤销', '重做', '导出作品', '查看视频导入任务']) getByLabel(html, name);
  locks(html, { className: 'topbar' });
});
test('K4/K6: toolbar and navigation groups/names and zoom hooks', () => {
  const toolbar = render(createElement(CanvasToolbar, { tool: 'select', readOnly: false, onTool: noop, onAddCard: noop, onPickFiles: noop, onOpenImport: noop }));
  locks(toolbar, { role: 'toolbar', name: '画布工具' }, ['canvas-toolbar']);
  for (const name of ['移动与选择', '创建与收集']) getBy(toolbar, { role: 'group', name });
  for (const name of ['选择', '平移', '连线', '添加分组区域', '添加']) getByRole(toolbar, 'button', name);
  assert.equal(attr(getByRole(toolbar, 'button', '添加'), 'aria-haspopup'), 'menu');
  const nav = render(createElement(ZoomControls, { zoom: 1, smartSnap: true, onToggleSnap: noop, onZoomOut: noop, onZoomReset: noop, onZoomIn: noop, onFit: noop }));
  locks(nav, { role: 'toolbar', name: '画布导航' }, ['zoom-controls']);
  for (const name of ['画布缩放', '画布设置']) getBy(nav, { role: 'group', name });
  for (const name of ['缩小', '放大', '查看全部', '当前缩放 100%，恢复 100%', '小地图', '智能贴齐']) getByRole(nav, 'button', name);
  locks(nav, { role: 'button', name: '当前缩放 100%，恢复 100%' }, ['zoom-value']);
  assert.equal(attr(getByRole(nav, 'button', '智能贴齐'), 'aria-pressed'), 'true');
});
test('K4/K6: sidebar, library kinds, appearance select, welcome, empty and outline hooks', () => {
  // Creative + writing examples make every library kind (including link) observable.
  const full = { ...board, nodes: [...board.nodes, ...createExampleBoard('creative').nodes, ...createExampleBoard('writing').nodes,
    { ...source, id: 'contract-empty-image', data: { kind: 'image' as const, title: '待导入图片', body: '' } }] };
  const html = render(createElement(Sidebar, { open: true, workspace: { ...workspace, boards: [full] }, board: full, readOnly: false, busy: false, selectedIds: [source.id], onSearch: noop, onSwitchBoard: noop, onNewBoard: noop, onChangeWorkspace: noop, onRevealCard: noop, onOpenCard: noop, onHelp: noop }));
  for (const cls of ['sidebar', 'sidebar-bottom', 'board-nav', 'library-list', 'library-item', 'library-meta', 'library-icon', 'is-current', 'appearance-control']) locks(html, { className: cls });
  for (const kind of kinds.filter(k => k !== 'frame')) assert.ok(queryAll(html, { className: 'library-icon' }).some(el => hasClass(el, kind)), `library-icon.${kind}`);
  getBy(html, { className: 'library-item', text: source.data.title }); getBy(html, { tag: 'strong', text: source.data.title });
  getBy(html, { role: 'group', name: '素材筛选' });
  assert.equal(getByLabel(html, '外观模式').tag, 'select');
  assert.equal(queryAll(html, { label: '翻译密钥' }).length, 2);
  const welcome = render(createElement(Welcome, { onOpenExample: noop, onNewBoard: noop }));
  locks(welcome, { tag: 'section', className: 'welcome' });
  for (const cls of ['template-card', 'new-board']) locks(welcome, { className: cls });
  locks(render(createElement(EmptyCanvas, { readOnly: false, onImport: noop, onAddNote: noop })), { className: 'empty-canvas' });
  locks(render(createElement(OutlineView, { board: full, onOpenCard: noop, onImport: noop })), { className: 'outline-row' });
});
test('K3/K6: task/transcript/draft-reference/snap ids render from their owning components', () => {
  const task = { attemptId: 'contract-attempt', url: 'https://example.com/video', originalText: '', status: 'failed' as const, message: '测试导入失败', mediaReady: false, createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' };
  const node = { ...source, data: { ...source.data, videoImport: task } };
  getByTestId(card(node.data, node.id), `card-video-import-${node.id}`);
  getByTestId(render(createElement(VideoImportsDialog, { entries: [{ board, node, task }], readOnly: false, videoAvailable: true, isActionPending: () => false, onGoToCard: noop, onCancel: noop, onRetry: noop })), `video-import-task-${node.id}`);
  const video = render(createElement(Inspector, { node: source, onClose: noop, onImportSubtitles: noop, onNativeTranscribe: async () => {}, onNotify: noop }));
  getByTestId(video, 'edit-transcript-contract-line'); locks(video, { className: 'inspector' });
  const writing = render(createElement(Inspector, { node: draft, onClose: noop, onImportSubtitles: noop, onNativeTranscribe: async () => {}, onNotify: noop }));
  getByTestId(writing, 'draft-used-reference-1');
  getByTestId(render(createElement(DraftReferenceList, { openDraftSource: noop, onInsert: noop, onClose: noop, usedCounts: new Map(), variant: 'inline' })), `draft-available-quote-${quote.id}`);
  const snap = render(createElement(CanvasLayers, { guides: [{ axis: 'x', position: 20, from: 0, to: 100, referenceId: source.id, feature: 'center' }] }));
  getByTestId(snap, 'snap-guides');
  const rail = render(createElement(CanvasRail, { tools: null, navigation: null }));
  locks(rail, { className: 'canvas-rail' }); locks(rail, { className: 'canvas-hint' });
});
test('K4/K6: modal, export buttons, panel names and status banner variants', () => {
  const modal = (kind: string, child: ReactElement) => render(createElement(ModalShell, { kind, locked: false, closeDisabled: false, onClose: noop, children: child }));
  const exported = modal('export', createElement(ExportDialog, { board, busy: false, directoryAvailable: false, onExportPackage: noop, onExportDirectory: noop, onExportMarkdown: noop }));
  for (const cls of ['modal', 'modal-title', 'modal-backdrop', 'export-options']) locks(exported, { className: cls });
  exportOptions(exported);
  const radios = exported.replace('class="export-options"', 'class="export-options" role="radiogroup"').replace(/<button\b/g, '<button role="radio" aria-checked="false"');
  exportOptions(radios);
  assert.throws(() => exportOptions(radios.replace(/<button\b/g, '<div').replace(/<\/button>/g, '</div>')));
  assert.throws(() => exportOptions(radios.replace('文稿与参考资料', '破坏格式名称')));
  assert.throws(() => exportOptions(radios.replace('export-options', 'broken-export-options')));
  getByRole(exported, 'dialog', '导出');
  getByRole(modal('help', createElement(HelpDialog)), 'dialog', '使用指南');
  getByRole(modal('import', createElement(ImportDialog, { mode: 'web', onModeChange: noop, value: '', onTextChange: noop, onXTextChange: noop, error: '', xProgress: '', xCommitting: false, xAvailable: false, videoAvailable: false, native: false, readOnly: false, busy: false, onPickFiles: noop, onSubmitLink: noop, onImportX: noop, onCancelX: noop, onRestoreBoardFile: noop, onOpenLocalBoard: noop, onRunNative: noop })), 'dialog', '导入素材');
  getByRole(modal('new', createElement(NewBoardDialog, { name: '', onName: noop, template: 'blank', onTemplate: noop, directory: null, directoryError: '', onChooseDirectory: noop, onClearDirectory: noop, onCreate: noop, creating: false, readOnly: false })), 'dialog', '新建画布');
  const props = { saveStatus: 'error' as const, saveError: '测试保存失败', readOnly: true, busy: false, canReconnect: false, onRetrySave: noop, onReconnect: noop, onExportBackup: noop };
  const banners = render(createElement(StatusBanners, props));
  locks(banners, { className: 'error' }, ['status-banner']); locks(banners, { className: 'warning' }, ['status-banner']);
});
test('K10/K6: selection toolbar literal and hook render', () => {
  const html = render(createElement(CanvasSelectionTools, { nodes: board.nodes, selectedIds: [source.id, quote.id], readOnly: false, onDelete: noop, onOpen: noop, onDuplicate: noop, onConnect: noop, onResize: noop, onViewSelected: noop }));
  assert.match(html, /role="toolbar" aria-label="整理选中卡片"/);
  locks(html, { role: 'toolbar', name: '整理选中卡片' }, ['selection-tools']);
});
test('mutation sentinel: rendered K3/K4/K6/K10 defects fail the same assertions', () => {
  const probe = process.env.FIELD_CONTRACT_MUTATION;
  let html = topbar();
  if (probe === 'K3') html = html.replace('data-testid="board-title"', 'data-testid="broken-title"');
  if (probe === 'K4') html = html.replace('aria-label="撤销"', 'aria-label="破坏读屏名"');
  if (probe === 'K6') html = html.replace('class="topbar ', 'class="broken-topbar ');
  getByTestId(html, 'board-title'); getByLabel(html, '撤销'); locks(html, { className: 'topbar' });
  let video = card(source.data);
  if (probe === 'K10') video = video.replace('field-card__poster-button card-drag-content', 'broken-poster card-drag-content');
  assert.match(video, /class="field-card__poster-button card-drag-content"/);
});
test('CSS guard rejects its filesystem/AST mutation fixtures', () => {
  for (const script of ['check-css-tokens']) {
    const log = execFileSync(process.execPath, [`scripts/${script}.mjs`, '--self-test'], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.match(log, /self-test \d+ passed/);
  }
});

test('K3/K4/K6: real browser renders App, menus, minimap and portal-owned surfaces', { timeout: 90000 }, async t => {
  await fs.mkdir(out, { recursive: true });
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {ReactFlowProvider} from '@xyflow/react'; import App from '/src/App.tsx';
import WorkspaceSearch from '/src/WorkspaceSearch.tsx'; import ImagePreviewDialog from '/src/inspector/ImagePreviewDialog.tsx';
import InspectorDialog from '/src/InspectorDialog.tsx'; import Toasts,{showToast} from '/src/shell/Toasts.tsx';
import {createExampleBoard} from '/src/templates.ts'; import '/src/styles/index.css';
const noop=()=>{},board=createExampleBoard('video');const surface=new URL(location.href).searchParams.get('surface');
const child=surface==='search'?<WorkspaceSearch workspace={{schema:1,activeBoardId:board.id,boards:[board]}} readOnly={false} onClose={noop} onSelect={noop} onCommand={noop}/>:
surface==='viewer'?<ImagePreviewDialog src="/assets/scene-architecture.svg" title="契约原图" initialSize={{width:100,height:80}} onClose={noop}/>:
surface==='dialog'?<InspectorDialog title="契约对话框" onCancel={noop}><p>契约正文</p></InspectorDialog>:
surface==='toast'?<Toasts busy="契约处理中"/>:<App/>;
createRoot(document.getElementById('root')).render(<ReactFlowProvider>{child}</ReactFlowProvider>);
if(surface==='toast')setTimeout(()=>showToast('契约提示',{duration:null}),100);
`;
  await fs.writeFile(path.join(out, 'contract-browser.tsx'), entry);
  await fs.writeFile(path.join(out, 'contract-browser.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="./contract-browser.tsx"></script></body></html>');
  const vite = await import('vite');
  let server: Awaited<ReturnType<typeof vite.createServer>> | undefined;
  let url = '';
  // Independent worktrees need separate pools; the default remains the W1-C pool.
  const firstPort = Number(process.env.FIELD_CONTRACT_PORT ?? 5320);
  assert.ok(Number.isInteger(firstPort) && firstPort >= 1024 && firstPort <= 65531 && !(firstPort <= 5178 && firstPort + 4 >= 5178), 'FIELD_CONTRACT_PORT must name a five-port pool outside the daily 5178 port');
  for (let port = firstPort; port <= firstPort + 4; port++) {
    const candidate = await vite.createServer({ root, configFile: false, logLevel: 'error', optimizeDeps: { entries: [path.join(out, 'contract-browser.html')] }, server: { host: '127.0.0.1', port, strictPort: true, open: false, watch: { ignored: ['**/output/**', '**/.native-profile/**'] } }, cacheDir: path.join(out, 'vite-cache') });
    try { await candidate.listen(); server = candidate; url = `http://127.0.0.1:${port}/output/desk-v2/W1-C/contract-browser.html`; break; }
    catch (e) { await candidate.close(); if (port === firstPort + 4) throw e; }
  }
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  t.signal.addEventListener('abort', () => { void browser?.close(); void server?.close(); }, { once: true });
  const errors: string[] = [], notifications: string[] = [], checks: string[] = [];
  try {
    const channel = process.env.FIELD_TEST_CHANNEL;
    browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (message.text().includes('ResizeObserver loop')) notifications.push(message.text()); });
    await page.addInitScript(() => localStorage.setItem('field-welcome-v1', 'seen'));
    await page.goto(url); await page.getByTestId('canvas').waitFor();
    assert.equal(await page.locator('.flow-container').count(), 1);
    await page.getByTestId('save-status').filter({ hasText: '已保存到本机' }).waitFor();
    const add = page.getByRole('button', { name: '添加', exact: true }); await add.click();
    await page.getByRole('menu').waitFor(); assert.ok(await page.getByRole('menuitem').count() >= 7);
    await page.keyboard.press('Escape'); checks.push('App canvas/flow-container/save-status and actual add menu');
    await page.getByRole('button', { name: '小地图', exact: true }).click();
    await page.locator('.react-flow__minimap').waitFor(); checks.push('actual React Flow minimap');
    for (const theme of ['light', 'dark']) {
      await page.getByRole('combobox', { name: '外观模式' }).selectOption(theme);
      await page.waitForTimeout(300); // Screenshot only: allow finite appearance transitions to settle.
      await page.screenshot({ path: path.join(out, `contracts-${theme}.png`) });
    }
    for (const surface of ['search', 'viewer', 'dialog', 'toast']) {
      await page.goto(`${url}?surface=${surface}`);
      if (surface === 'search') { await page.locator('.workspace-search').waitFor(); await page.getByRole('dialog', { name: '搜索与命令' }).waitFor(); }
      if (surface === 'viewer') { await page.getByRole('dialog', { name: '契约原图' }).waitFor(); await page.getByTestId('image-zoom-value').waitFor(); await page.getByTestId('image-pixel-dimensions').waitFor(); }
      if (surface === 'dialog') await page.locator('dialog.inspector-dialog').filter({ has: page.getByRole('heading', { name: '契约对话框' }) }).waitFor();
      if (surface === 'toast') { await page.locator('.busy-toast').waitFor(); await page.locator('.toast').waitFor(); }
      checks.push(`real portal: ${surface}`);
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }, theme);
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(out, `${surface}-${theme}.png`) });
      }
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(out, 'browser-contracts.json'), JSON.stringify({ status: 'passed', url, checks, errors, notifications, isolation: 'ephemeral browser context; no native profile', themes: ['light', 'dark'] }, null, 2));
  } finally { await browser?.close(); await server?.close(); }
});
