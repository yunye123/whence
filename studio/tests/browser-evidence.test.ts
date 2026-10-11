import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbackMatchesTarget } from '../native/browser-evidence';

test('a visible recommendation without target identity is not the requested video', () => {
  assert.equal(playbackMatchesTarget('抖音', '123', 'https://v11.douyinvod.com/media/', [], []), false);
  assert.equal(playbackMatchesTarget('抖音', '123', 'https://v11.douyinvod.com/media/', ['456'], ['123']), false);
  assert.equal(playbackMatchesTarget('小红书', '123', 'https://sns-video.xhscdn.com/media/', ['123'], ['123']), false);
});

test('requires matching CDN identity or both player and detail public DOM identity', () => {
  assert.equal(playbackMatchesTarget('抖音', '123', 'https://v11.douyinvod.com/media/?__vid=123', [], []), true);
  assert.equal(playbackMatchesTarget('抖音', '123', 'https://v11.douyinvod.com/media/', ['123'], ['123']), true);
  assert.equal(playbackMatchesTarget('抖音', '123', 'https://v11.douyinvod.com/media/?__vid=456', ['123'], ['123']), false);
  assert.equal(playbackMatchesTarget('抖音', '123', 'https://v11.douyinvod.com/media/?__vid=123', ['456'], ['123']), false);
  assert.equal(playbackMatchesTarget('抖音', '123', 'https://v11.douyinvod.com/media/', ['123'], []), false);
});

test('blob URLs cannot be treated as public downloadable media', () => {
  assert.equal(playbackMatchesTarget('抖音', '123', 'blob:https://www.douyin.com/uuid', ['123'], ['123']), false);
});
