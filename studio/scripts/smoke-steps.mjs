// Shared, real-input smoke steps. No force clicks and no product state writes.
// Only the new UI is accepted. This tooling mode does not assert that the product passed Gate C.
import assert from 'node:assert/strict';

// Stable check IDs let mutation tests reject unrelated assertions and browser errors.
export function smokeEqual(actual, expected, checkId, message) {
  if (actual !== expected) {
    const error = new assert.AssertionError({ actual, expected, operator: 'strictEqual', message });
    error.checkId = checkId;
    throw error;
  }
}

export function smokeConfig(env = process.env) {
  const required = { FIELD_SMOKE_STAGE: 'gate-c', FIELD_SMOKE_EXPORT_UI: 'radio', FIELD_SMOKE_RAIL_UI: 'desk-v2', FIELD_SMOKE_SIDEBAR_UI: 'desk-v2', FIELD_SMOKE_TOPBAR_UI: 'desk-v2', FIELD_SMOKE_PROVENANCE_UI: 'stamp' };
  for (const [key, value] of Object.entries(required)) {
    if (env[key] !== undefined) assert.equal(env[key], value, `${key} only accepts ${value}; retired UI modes are unavailable`);
  }
  return Object.freeze({ stage: 'gate-c' });
}

export function smokePort(env = process.env) {
  if (env.FIELD_SMOKE_PORT !== undefined && env.FIELD_FIX_PORT !== undefined) assert.equal(env.FIELD_SMOKE_PORT, env.FIELD_FIX_PORT, 'Smoke port overrides must agree');
  const port = Number(env.FIELD_SMOKE_PORT ?? env.FIELD_FIX_PORT ?? '5551');
  assert.ok(Number.isInteger(port) && port >= 5550 && port <= 5554, 'I1 smoke ports must be within 5550-5554');
  return port;
}

export function smokeUrl(value, env = process.env) {
  const url = value ?? env.FIELD_TEST_URL ?? 'http://127.0.0.1:5550/';
  const parsed = new URL(url);
  smokePort({ FIELD_SMOKE_PORT: parsed.port });
  return url;
}

export async function revealSidebarControl(page, control) {
  if (await control.isVisible()) return;
  const expand = page.getByRole('button', { name: '展开侧栏', exact: true });
  const visible = [];
  for (const button of await expand.all()) if (await button.isVisible()) visible.push(button);
  assert.equal(visible.length, 1, 'One visible sidebar expansion control is required');
  assert.equal(await visible[0].getAttribute('aria-expanded'), 'false', 'Sidebar must report its collapsed state');
  await visible[0].click();
  await control.waitFor({ state: 'visible' });
  assert.ok(await page.locator('.sidebar').isVisible(), 'Expansion reveals the sidebar');
  assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'false', 'Expanded sidebar is available to assistive technology');
}

export async function closeInspector(page) {
  const close = page.getByRole('button', { name: '关闭编辑面板', exact: true });
  if (await close.isVisible()) await close.click();
  await page.locator('.inspector').waitFor({ state: 'hidden' });
}

export async function revealCanvasNavigation(page) {
  const navigation = page.getByRole('toolbar', { name: '画布导航', exact: true });
  assert.equal(await navigation.count(), 1, 'One visible canvas navigation toolbar is required');
  const fit = navigation.getByRole('button', { name: '查看全部', exact: true });
  // Compact navigation keeps controls mounted and hides them in CSS until expanded.
  if (!await fit.isVisible()) {
    const fold = navigation.getByRole('button', { name: /^画布导航，当前缩放 \d+%$/ });
    assert.equal(await fold.count(), 1, 'Compact navigation has one contracted expansion button');
    assert.equal(await fold.getAttribute('aria-expanded'), 'false', 'Compact navigation starts collapsed');
    await fold.click();
    await fit.waitFor({ state: 'visible' });
    assert.equal(await fold.getAttribute('aria-expanded'), 'true', 'Compact navigation reports expansion');
  }
  return navigation;
}

export async function fitCanvas(page) {
  await page.getByRole('toolbar', { name: '画布工具', exact: true }).waitFor({ state: 'visible' });
  const navigation = await revealCanvasNavigation(page);
  const fit = navigation.getByRole('button', { name: '查看全部', exact: true });
  await page.evaluate(() => { delete window.__fieldSmokeFit; });
  await fit.click();
  await page.waitForFunction(() => {
    const element = document.querySelector('.react-flow__viewport');
    if (!element) return false;
    const transform = getComputedStyle(element).transform;
    const state = window.__fieldSmokeFit;
    const now = performance.now();
    window.__fieldSmokeFit = state?.transform === transform ? state : { transform, since: now };
    return now - window.__fieldSmokeFit.since >= 400;
  });
}

// Transcript rows can share a whole second and then display tenths; select the persisted line ID,
// require an actual time-named button and let callers verify the player's resulting currentTime.
export async function seekTranscriptLine(page, lineId) {
  assert.ok(typeof lineId === 'string' && lineId.length, 'A persisted transcript line ID is required');
  const escaped = await page.evaluate(id => CSS.escape(id), lineId);
  const row = page.getByRole('group', { name: '视频字幕', exact: true }).locator(`[data-line-id="${escaped}"]`);
  assert.equal(await row.count(), 1, 'Exactly one requested transcript line is rendered');
  const time = row.getByRole('button', { name: /^(?:\d+:)?\d{2}:\d{2}(?:\.\d)?$/ }).and(row.locator('.watch-line__time'));
  assert.equal(await time.count(), 1, 'Transcript seek is a button named by its visible time, not a title selector');
  assert.equal(await time.isDisabled(), false, 'The requested transcript time is seekable');
  await time.click();
}

const formats = {
  markdown: /^文稿与参考资料(?:\s*·\s*Markdown)?$/,
  portable: /^便携画布文件(?:\s*·\s*\.field\.json)?$/,
  directory: /^另存完整画布目录(?:\s*·\s*文件夹)?$/,
  moodboard: /^灵感板(?:\s*·\s*PNG\s*·\s*PDF)?$/,
  script: /^分镜脚本(?:\s*·\s*PDF)?$/,
};

export async function exportFormat(page, format, dialog = page.getByRole('dialog')) {
  const name = formats[format];
  assert.ok(name, `Unknown export format ${format}`);
  const group = dialog.getByRole('radiogroup').and(dialog.locator('.export-options'));
  assert.equal(await group.count(), 1, 'One export format radiogroup is required');
  const radio = group.getByRole('radio', { name });
  assert.equal(await radio.count(), 1, 'One named export format radio is required');
  await radio.click();
  assert.equal(await radio.getAttribute('aria-checked'), 'true', 'Chosen format must be checked before export');
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
}

export const hiddenChromeSelector = '.canvas-toolbar,.zoom-controls,.react-flow__minimap,.selection-tools,.canvas-hint,.canvas-rail';

export async function assertChromeHidden(page) {
  for (const selector of ['.canvas-toolbar', '.zoom-controls']) assert.equal(await page.locator(selector).count(), 1, `Hidden chrome positive control: ${selector}`);
  assert.equal(await page.locator('.canvas-rail').count(), 1, 'New canvas rail must exist');
  // Optional minimap, dismissed hint and empty selection may be absent. Every mounted instance,
  // including duplicate/hidden instances, must itself have display:none; an ancestor does not suffice.
  const chrome = await page.locator(hiddenChromeSelector).evaluateAll(elements => elements.map(element => ({ className: typeof element.className === 'string' ? element.className : element.className.baseVal, display: getComputedStyle(element).display })));
  assert.ok(chrome.length, 'Background canvas controls must exist');
  for (const item of chrome) smokeEqual(item.display, 'none', 'chrome.own-display', `${item.className} must individually have display:none`);
  return chrome;
}

export function railSelector() { return '.canvas-rail'; }

// These checks also run unchanged under each deliberate mutation.
export async function assertCanvasChrome(page) {
  const rail = page.locator(railSelector());
  assert.equal(await rail.count(), 1, 'Canvas rail must exist exactly once');
  smokeEqual(await rail.isVisible(), true, 'rail.visible', 'Canvas rail must be visible in canvas mode');
  assert.equal(await rail.getByRole('toolbar', { name: '画布工具', exact: true }).count(), 1);
  assert.equal(await rail.getByRole('toolbar', { name: '画布导航', exact: true }).count(), 1);
  const tools = page.getByRole('toolbar', { name: '画布工具', exact: true });
  assert.equal(await tools.count(), 1, 'One canvas tools toolbar is required');
  assert.equal(await tools.getByRole('group', { name: '移动与选择', exact: true }).count(), 1);
  assert.equal(await tools.getByRole('group', { name: '创建与收集', exact: true }).count(), 1);
  for (const name of ['选择', '平移', '连线', '添加分组区域', '添加']) {
    smokeEqual(await tools.getByRole('button', { name, exact: true }).count(), 1, `tool.name:${name}`, `Required tool name: ${name}`);
  }
  const pressed = {};
  for (const name of ['选择', '平移', '连线']) {
    pressed[name] = await tools.getByRole('button', { name, exact: true }).getAttribute('aria-pressed');
    assert.ok(['true', 'false'].includes(pressed[name]), `${name} reports its tool state`);
  }
  assert.notEqual(pressed['选择'], pressed['平移'], 'Exactly one movement tool is active');
  const add = tools.getByRole('button', { name: '添加', exact: true });
  assert.equal(await add.getAttribute('aria-haspopup'), 'menu');
  assert.ok(['true', 'false'].includes(await add.getAttribute('aria-expanded')));
  const fold = page.getByRole('toolbar', { name: '画布导航', exact: true }).getByRole('button', { name: /^画布导航，当前缩放 \d+%$/ });
  const refold = await fold.isVisible() && await fold.getAttribute('aria-expanded') === 'false';
  try {
    const navigation = await revealCanvasNavigation(page);
    for (const name of ['画布缩放', '画布设置']) assert.equal(await navigation.getByRole('group', { name, exact: true }).count(), 1);
    for (const name of ['缩小', '放大', '查看全部', '小地图', '智能贴齐']) {
      assert.equal(await navigation.getByRole('button', { name, exact: true }).count(), 1, `Required navigation name: ${name}`);
    }
    assert.equal(await navigation.getByRole('button', { name: /^当前缩放 \d+%，恢复 100%$/ }).count(), 1);
    for (const name of ['小地图', '智能贴齐']) assert.ok(['true', 'false'].includes(await navigation.getByRole('button', { name, exact: true }).getAttribute('aria-pressed')));
  } finally {
    if (refold && await fold.getAttribute('aria-expanded') === 'true') {
      await fold.click();
      assert.equal(await fold.getAttribute('aria-expanded'), 'false', 'Semantic inspection restores compact navigation');
    }
  }
  return { selector: railSelector(), visible: true, pressed };
}

export function cardSelector(nodeId) {
  assert.match(nodeId, /^[\w-]+$/, 'Smoke node IDs must be safe selector identifiers');
  return `.react-flow__node[data-id="${nodeId}"]`;
}

export async function assertProvenance(page, nodeId, name) {
  const card = page.locator(cardSelector(nodeId));
  await card.waitFor({ state: 'attached' });
  const stamp = card.locator('.field-card__citation');
  smokeEqual(await stamp.count(), 1, 'provenance.count', 'Quote card must have one provenance stamp');
  assert.equal(await card.getByRole('button', { name, exact: true }).count(), 1, 'Provenance keeps its contracted accessible name');
  const action = card.getByRole('button', { name, exact: true }).and(stamp);
  assert.equal(await action.count(), 1, 'The contracted name belongs to this stamp, not another card control');
  assert.ok(await action.isVisible(), 'Provenance must be visible');
  const classes = (await action.getAttribute('class')).split(/\s+/);
  for (const token of ['tag-btn', 'nodrag']) assert.ok(classes.includes(token), `Provenance keeps ${token}`);
  assert.equal(await stamp.locator('.tag__body').count(), 1, 'Provenance retains the location text hook');
  const location = (await stamp.locator('.tag__body').textContent()).trim();
  assert.ok(location, 'Provenance location is not empty');
  assert.equal(await stamp.locator('.tag--stamp').count(), 1, 'New provenance must render the standard stamp');
  assert.equal(await stamp.locator('.tag__head[aria-hidden="true"] svg').count(), 1, 'Stamp location glyph is decorative');
  assert.equal(await stamp.locator('.tag-hole,.tag__hole,.tag__string').count(), 0, 'Retired tag holes and strings are absent');
  return { nodeId, name, location };
}

export async function assertTopbar(page) {
  const topbar = page.locator('.topbar');
  assert.equal(await topbar.count(), 1);
  assert.ok(await topbar.isVisible());
  assert.equal(await page.getByRole('banner').and(topbar).count(), 1, 'Topbar is the banner landmark');
  const title = topbar.getByTestId('board-title');
  assert.equal(await title.count(), 1);
  assert.equal(await title.evaluate(element => element.tagName), 'INPUT', 'K3: title remains an input');
  assert.equal(await title.getAttribute('aria-label'), '画布名称');
  const status = topbar.getByTestId('save-status');
  assert.equal(await status.count(), 1);
  assert.equal(await status.evaluate(element => element.tagName), 'SPAN');
  assert.equal(await status.getAttribute('role'), 'status');
  const statusText = (await status.textContent()).trim();
  assert.match(statusText, /^(?:读取中|保存中|已保存到本机(?:文件夹)?|保存失败|只读窗口)$/);
  assert.equal(await status.locator('svg').count(), 1, 'Save state retains its narrow-window icon');
  for (const name of ['撤销', '重做', '导出作品']) assert.equal(await topbar.getByRole('button', { name, exact: true }).count(), 1);
  if (await topbar.locator('.video-import-activity').count()) {
    const activity = topbar.getByRole('button', { name: '查看视频导入任务', exact: true });
    assert.equal(await activity.count(), 1);
    assert.equal(await activity.locator('svg').count(), 1);
    assert.match((await activity.locator('.video-import-activity__count').textContent()).trim(), /^\d+$/);
  }
  const views = topbar.getByRole('group', { name: '视图', exact: true });
  assert.equal(await views.count(), 1);
  const states = [];
  for (const name of ['画布', '大纲']) {
    const button = views.getByRole('button', { name, exact: true });
    assert.equal(await button.count(), 1);
    const pressed = await button.getAttribute('aria-pressed');
    assert.ok(['true', 'false'].includes(pressed));
    states.push(pressed);
  }
  assert.notEqual(...states, 'Exactly one topbar view is active');
  return { title: await title.inputValue(), statusText, view: states[0] === 'true' ? 'canvas' : 'outline' };
}

export async function assertSidebar(page) {
  const appearance = page.getByRole('combobox', { name: '外观模式', exact: true });
  await revealSidebarControl(page, appearance);
  const sidebar = page.locator('.sidebar');
  assert.equal(await sidebar.count(), 1);
  assert.equal(await page.getByRole('complementary', { name: '工作区导航', exact: true }).and(sidebar).count(), 1);
  assert.equal(await appearance.evaluate(element => element.tagName), 'SELECT', 'K8: appearance remains a native select');
  assert.deepEqual(await appearance.locator('option').evaluateAll(elements => elements.map(element => element.value)), ['light', 'dark', 'system']);
  assert.equal(await sidebar.getByRole('button', { name: '新建画布', exact: true }).count(), 1);
  assert.equal(await sidebar.getByRole('button', { name: /^搜索与命令/ }).count(), 1);
  assert.equal(await sidebar.locator('.library-list').count(), 1, 'Material list remains mounted even when empty');
  const rows = sidebar.locator('.library-item');
  const count = await rows.count();
  if (count) {
    const facets = sidebar.getByRole('group', { name: '素材筛选', exact: true });
    assert.equal(await facets.count(), 1);
    let pressedCount = 0;
    for (const label of ['来源', '摘录', '我写的', '图片']) {
      const button = facets.getByRole('button', { name: new RegExp(`^只看${label}，\\d+ 张$`) });
      assert.equal(await button.count(), 1, `New sidebar facet: ${label}`);
      const pressed = await button.getAttribute('aria-pressed');
      assert.ok(['true', 'false'].includes(pressed));
      if (pressed === 'true') pressedCount++;
    }
    assert.ok(pressedCount <= 1, 'At most one sidebar facet is active');
    for (const row of await rows.all()) {
      assert.equal(await row.evaluate(element => element.tagName), 'BUTTON');
      assert.equal(await row.locator('strong').count(), 1);
      assert.equal(await row.locator('.library-meta').count(), 1);
    }
  }
  return { materialRows: count, appearance: await appearance.inputValue() };
}

// UI changes only, restored through the same buttons. Call once from normal browser smoke;
// mutation checks reuse the semantic assertions above, without changing the injected target.
export async function assertShellInteractions(page) {
  const evidence = { sidebar: await assertSidebar(page), topbar: await assertTopbar(page), canvas: await assertCanvasChrome(page) };
  const tools = page.getByRole('toolbar', { name: '画布工具', exact: true });
  const previous = evidence.canvas.pressed['选择'] === 'true' ? '选择' : '平移';
  const next = previous === '选择' ? '平移' : '选择';
  try {
    await tools.getByRole('button', { name: next, exact: true }).click();
    assert.equal(await tools.getByRole('button', { name: next, exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await tools.getByRole('button', { name: previous, exact: true }).getAttribute('aria-pressed'), 'false');
  } finally { await tools.getByRole('button', { name: previous, exact: true }).click(); }
  const add = tools.getByRole('button', { name: '添加', exact: true });
  await add.click();
  try {
    await page.getByRole('menu', { name: '添加', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await add.getAttribute('aria-expanded'), 'true');
  } finally { await page.keyboard.press('Escape'); }
  assert.equal(await add.getAttribute('aria-expanded'), 'false');
  assert.ok(await add.evaluate(element => element === document.activeElement), 'Closing the add menu returns focus');
  const navigation = await revealCanvasNavigation(page);
  const snap = navigation.getByRole('button', { name: '智能贴齐', exact: true });
  const snapBefore = await snap.getAttribute('aria-pressed');
  try {
    await snap.click();
    assert.equal(await snap.getAttribute('aria-pressed'), snapBefore === 'true' ? 'false' : 'true');
  } finally {
    if (await snap.getAttribute('aria-pressed') !== snapBefore) await snap.click();
  }
  assert.equal(await snap.getAttribute('aria-pressed'), snapBefore);
  const collapse = page.getByRole('button', { name: '收起侧栏', exact: true });
  assert.equal(await collapse.count(), 1, 'Expanded shell has one sidebar collapse action');
  await collapse.click();
  try {
    const expand = page.locator('.topbar').getByRole('button', { name: '展开侧栏', exact: true });
    await expand.waitFor({ state: 'visible' });
    assert.equal(await expand.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('.sidebar').getAttribute('inert'), '');
  } finally {
    await revealSidebarControl(page, page.getByRole('combobox', { name: '外观模式', exact: true }));
  }
  evidence.sidebarRoundTrip = true;
  return { ...evidence, movementRoundTrip: true, addMenuRoundTrip: true, snappingRoundTrip: true };
}

// FD-04: native exports use the real product writer. Only the isolated save picker is substituted.
export async function nativePortableExport(desktop, page, destination) {
  await desktop.evaluate(({ dialog }, file) => {
    globalThis.__fieldSmokeOriginalSaveDialog = dialog.showSaveDialog;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, destination);
  try {
    await page.getByRole('button', { name: '导出作品', exact: true }).click();
    await exportFormat(page, 'portable');
    await page.locator('.toast-stack').getByText('画布文件已保存', { exact: true }).waitFor({ timeout: 60_000 });
    return { destination, via: 'real native writer and isolated save dialog' };
  } finally {
    await desktop.evaluate(({ dialog }) => { dialog.showSaveDialog = globalThis.__fieldSmokeOriginalSaveDialog; delete globalThis.__fieldSmokeOriginalSaveDialog; });
  }
}
