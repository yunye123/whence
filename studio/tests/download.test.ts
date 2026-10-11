import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVideoInput, isPublicAddress, downloadErrorMessage } from '../native/download';

test('extracts complete Chinese share text and retains Xiaohongshu security token', () => {
  const input = '发现一个好视频！ https://www.xiaohongshu.com/discovery/item/674051740000000007027a15?xsec_token=abc%2B123%3D&xsec_source=app_share ，复制打开';
  const parsed = normalizeVideoInput(input);
  assert.equal(parsed.platform, '小红书');
  assert.match(parsed.url, /xsec_token=abc%2B123%3D/);
  assert.match(parsed.url, /\/explore\/674051740000000007027a15/);
  assert.equal(parsed.originalText, input);
  assert.equal(parsed.key, '小红书:674051740000000007027a15');
});

test('normalizes three platform short links and individual Bilibili pages', () => {
  assert.equal(normalizeVideoInput('6.66 分享 https://v.douyin.com/AbCdEF/ 复制打开').platform, '抖音');
  assert.equal(normalizeVideoInput('http://xhslink.com/o/AbCdEF').platform, '小红书');
  assert.equal(normalizeVideoInput('https://b23.tv/AbCdEF').platform, 'B站');
  assert.equal(normalizeVideoInput('https://www.bilibili.com/video/BV1bK411W797?p=2&share_source=copy').key, 'B站:BV1bK411W797:p2');
  assert.notEqual(normalizeVideoInput('https://www.bilibili.com/video/BV1bK411W797?p=2').key, normalizeVideoInput('https://www.bilibili.com/video/BV1bK411W797?p=3').key);
  assert.equal(normalizeVideoInput('https://www.douyin.com/?modal_id=6963263655114722595').url, 'https://www.douyin.com/video/6963263655114722595');
});

test('rejects private network, credentials, hostname spoofing, multiple links and shell text', () => {
  for (const input of ['https://127.0.0.1/video.mp4', 'https://10.0.0.1/x.mp4', 'http://[::1]/x.mp4', 'http://2130706433/x.mp4', 'https://a:b@www.bilibili.com/video/BV1bK411W797', 'https://bilibili.com.evil.test/video/BV1bK411W797', 'https://www.bilibili.com:3000/video/BV1bK411W797', '--exec rm', 'https://b23.tv/a https://b23.tv/b']) assert.throws(() => normalizeVideoInput(input), input);
  for (const address of ['127.0.0.1', '10.1.2.3', '192.168.2.1', '172.18.0.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('1.1.1.1'), true);
});

test('uses actionable language for upstream access restrictions', () => {
  assert.match(downloadErrorMessage(new Error('Fresh cookies (not necessarily logged in) are needed'), '抖音'), /重新复制完整分享链接/);
  assert.match(downloadErrorMessage(new Error('No video formats found'), '小红书'), /需要登录或是图文/);
  assert.equal(normalizeVideoInput('https://cdn.example.org/clip.mp4?signature=123').platform, '视频直链');
});
