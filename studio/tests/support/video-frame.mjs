import assert from 'node:assert/strict';

// Shared by the actual page callback and Node-only controls. A timer is never positive evidence.
function videoFrameKernel(video, options) {
function verdict(samples) {
  for (let i = 2; i < samples.length; i++) {
    const run = samples.slice(i - 2, i + 1);
    if (run.every(s => Number.isInteger(s.presentedFrames) && s.presentedFrames >= 0 && Number.isFinite(s.mediaTime) && Number.isFinite(s.currentTime) && s.paused === false && s.seeking === false)
      && run[1].presentedFrames > run[0].presentedFrames && run[2].presentedFrames > run[1].presentedFrames
      && run[1].mediaTime > run[0].mediaTime && run[2].mediaTime > run[1].mediaTime && run[2].currentTime > run[0].currentTime) return { status: 'passed', first: i - 2, last: i, presentedFramesDelta: run[2].presentedFrames - run[0].presentedFrames, mediaTimeDelta: run[2].mediaTime - run[0].mediaTime, currentTimeDelta: run[2].currentTime - run[0].currentTime };
  }
  return { status: 'incomplete', reason: 'Three successive decoded frame callbacks with real playback/time advancement required' };
}
  if (Array.isArray(video)) return verdict(video); // Node controls exercise the actual page callback's verdict.
  const { key, timeoutMs } = options;
  if (!(video instanceof HTMLVideoElement) || typeof video.requestVideoFrameCallback !== 'function') throw new Error('Actual HTMLVideoElement.requestVideoFrameCallback required');
  const registry = window.__i1VideoFrameEvidence ??= {};
  if (registry[key]) throw new Error('Video frame probe key cannot be reused');
  const record = registry[key] = { status: 'running', source: 'actual-requestVideoFrameCallback', samples: [], armedAt: new Date().toISOString(), uiActions: [] };
  let callback, timer;
  const stop = () => { clearTimeout(timer); if (callback !== undefined) video.cancelVideoFrameCallback(callback); };
  record.cancel = () => { if (record.status === 'running') { record.status = 'failed'; record.failure = 'Frame probe cancelled before decoded advancement'; } stop(); };
  const next = (now, metadata) => {
    if (!video.isConnected) { record.status = 'failed'; record.failure = 'Actual measured player detached'; stop(); return; }
    record.samples.push({ callbackNow: now, epochMs: Date.now(), presentedFrames: metadata.presentedFrames, mediaTime: metadata.mediaTime, currentTime: video.currentTime, paused: video.paused, seeking: video.seeking, videoWidth: video.videoWidth, videoHeight: video.videoHeight, metadata: { ...metadata } });
    const result = verdict(record.samples);
    if (result.status === 'passed') { Object.assign(record, result); stop(); }
    else callback = video.requestVideoFrameCallback(next);
  };
  callback = video.requestVideoFrameCallback(next);
  timer = setTimeout(() => { record.status = 'failed'; record.failure = 'Decoded video frame advancement timed out'; stop(); }, timeoutMs);
}
export const frameAdvanceVerdict = samples => videoFrameKernel(samples);
export async function assertRealVideoAdvancement(page, { scopeSelector = '.inspector .inspector-watch[aria-label="播放器"]', timeoutMs = 15000, evidence = {} } = {}) {
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, 'Video frame timeout must be positive');
  const key = `i1-frame-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const scope = page.locator(scopeSelector), video = scope.locator('video');
  evidence.status = 'running'; evidence.uiActions = []; evidence.source = 'actual-requestVideoFrameCallback';
  try {
    assert.equal(await scope.count(), 1, 'Unique actual watching player scope');
    if (await video.count() === 0) {
      const placeholder = scope.getByRole('button', { name: '播放视频', exact: true });
      assert.equal(await placeholder.count(), 1, 'Unique actual play-video placeholder');
      await placeholder.click(); evidence.uiActions.push('real-play-video-placeholder-click');
      await video.waitFor({ state: 'visible' });
    }
    assert.equal(await video.count(), 1, 'One actual watching video');
    if (await video.evaluate(v => !v.paused)) {
      const pause = scope.getByRole('button', { name: '暂停', exact: true });
      await pause.waitFor({ state: 'visible' });
      assert.equal(await pause.count(), 1, 'Unique real pause transport'); await pause.click(); evidence.uiActions.push('real-pause-click-before-probe');
    }
    await video.evaluate(videoFrameKernel, { key, timeoutMs });
    const play = scope.getByRole('button', { name: '播放', exact: true });
    await play.waitFor({ state: 'visible' });
    assert.equal(await play.count(), 1, 'Unique real play transport'); await play.click(); evidence.uiActions.push('real-play-click-after-probe-armed');
    await page.waitForFunction(key => window.__i1VideoFrameEvidence?.[key]?.status !== 'running', key, { timeout: timeoutMs + 1000 });
    const result = await page.evaluate(key => { const { cancel, ...result } = window.__i1VideoFrameEvidence[key]; return result; }, key);
    Object.assign(evidence, result, { uiActions: evidence.uiActions });
    assert.equal(result.status, 'passed', result.failure || 'Actual decoded advancement missing');
    assert.equal(frameAdvanceVerdict(result.samples).status, 'passed');
    return evidence;
  } catch (error) {
    const partial = await page.evaluate(key => { const value = window.__i1VideoFrameEvidence?.[key]; if (!value) return null; const { cancel, ...record } = value; return record; }, key).catch(() => null);
    if (partial) Object.assign(evidence, partial, { uiActions: evidence.uiActions });
    evidence.status = 'failed'; evidence.failure = error.stack || String(error); throw error;
  } finally {
    await page.evaluate(key => window.__i1VideoFrameEvidence?.[key]?.cancel?.(), key).catch(() => {});
  }
}
