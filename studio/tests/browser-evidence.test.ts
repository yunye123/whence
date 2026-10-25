import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbackMatchesTarget, selectSplitPlayback } from '../native/browser-evidence';

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

test('a blob player can only be saved from one public picture-and-sound pair', () => {
  const video = 'https://v26-web.douyinvod.com/a/video/tos/cn/tos-cn-vd-0026/item/media-video-avc1/?br=796&l=pair';
  const audio = 'https://v26-web.douyinvod.com/a/video/tos/cn/tos-cn-ve-15/item/media-audio-und-mp4a/?br=50&l=pair';
  const louder = 'https://v26-web.douyinvod.com/a/video/tos/cn/tos-cn-vd-0026/item/media-video-avc1/?br=1200&l=pair';
  assert.deepEqual(selectSplitPlayback('抖音', [video, audio, 'https://lf-douyin-pc-web.douyinstatic.com/obj/uuu_265.mp4', 'blob:https://www.douyin.com/uuid']), { videoUrl: video, audioUrl: audio });
  assert.equal(selectSplitPlayback('抖音', [video, louder, audio])?.videoUrl, louder);
  assert.equal(selectSplitPlayback('抖音', [video, audio, 'https://v26-web.douyinvod.com/b/media-video-avc1/?br=100&l=other']), undefined);
  assert.equal(selectSplitPlayback('小红书', [video, audio]), undefined);
  assert.equal(selectSplitPlayback('抖音', []), undefined);
});
