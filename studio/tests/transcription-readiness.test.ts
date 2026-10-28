import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IMPORT_MEDIA_GATES, TRANSCRIPTION_GATES, YT_DLP_DOWNLOAD_GATES,
  isToolGapMessage, missingToolsMessage, toolCheckLabel, toolRemedy,
} from '../native/transcription-readiness';

const NAMES = ['Python', 'FFmpeg', 'ffprobe', '转写依赖', '本地模型', '链接下载器'] as const;
function checks(failed: string[] = []) {
  return NAMES.map(name => ({ name, ok: !failed.includes(name), detail: failed.includes(name) ? 'Error: spawn ENOENT\npython traceback' : 'Python 3.12.1' }));
}

test('a missing tool is named in Chinese with how to supply it, and the process error is not copied', () => {
  const message = missingToolsMessage(checks(['Python', '本地模型', '链接下载器']), TRANSCRIPTION_GATES);
  assert.ok(message);
  assert.match(message, /^缺 Python。/);
  assert.match(message, /侧栏「本机工具」/);
  assert.match(message, /安装并检查/);
  assert.match(message, /缺 yt-dlp。/);
  assert.match(message, /不会替你安装/);
  assert.match(message, /缺 faster-whisper 模型。/);
  assert.match(message, /model\.bin/);
  assert.match(message, /不会下载模型/);
  assert.equal(message.includes('FFmpeg'), false);
  assert.equal(message.includes('ENOENT'), false);
  assert.equal(message.includes('traceback'), false);
  assert.equal(message.includes('Error:'), false);
  assert.ok(message.indexOf('缺 Python。') < message.indexOf('缺 yt-dlp。'));
  assert.ok(message.indexOf('缺 yt-dlp。') < message.indexOf('缺 faster-whisper 模型。'));
});

test('passed checks and an empty report do not invent a missing tool', () => {
  assert.equal(missingToolsMessage(checks(), TRANSCRIPTION_GATES), null);
  assert.equal(missingToolsMessage([], YT_DLP_DOWNLOAD_GATES), null);
  assert.equal(missingToolsMessage(checks(['本地模型']), YT_DLP_DOWNLOAD_GATES), null);
  assert.match(missingToolsMessage(checks(['ffprobe']), IMPORT_MEDIA_GATES)!, /缺 ffprobe。/);
});

test('the tools dialog can say the same remedy without the raw check name', () => {
  assert.equal(toolCheckLabel('链接下载器'), 'yt-dlp');
  assert.equal(toolCheckLabel('转写依赖'), 'faster-whisper');
  assert.equal(toolCheckLabel('本地模型'), 'faster-whisper 模型');
  assert.match(toolRemedy('FFmpeg')!, /本机工具/);
  assert.equal(toolRemedy('不存在'), undefined);
});

test('an existing Douyin download error is not treated as this explanation', () => {
  assert.equal(isToolGapMessage('本机视频下载工具未能启动。请打开侧栏「本机工具」，确认 Python 的位置后再试。'), false);
  assert.equal(isToolGapMessage('视频已在画布上，还不能转写。缺 faster-whisper。在「本机工具」所填的 Python 里安装 faster-whisper。'), true);
});
