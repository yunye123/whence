import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseDouyin, chooseXhs, douyinBootstrap, imageNoteText, pageCaptureScript, publicMediaUrl, tidyImageText } from '../native/page-media';

test('douyin keeps the highest H.264 address and otherwise every picture', () => {
  const video = chooseDouyin({
    id: '100', desc: '我是大唐顶流', author: '作者', duration: 103167,
    gears: [
      { h265: true, h: 1280, size: 9, urls: ['https://v26-web.douyinvod.com/high.mp4'] },
      { h265: false, h: 1280, size: 4, urls: ['https://evil.example/no.mp4', 'https://v26-web.douyinvod.com/h264.mp4'] },
      { h265: false, h: 720, size: 20, urls: ['https://v26-web.douyinvod.com/low.mp4'] },
    ],
  }, '100');
  assert.equal(video?.kind, 'video');
  assert.equal(video?.mediaUrl, 'https://v26-web.douyinvod.com/h264.mp4');
  assert.ok(Math.abs((video?.durationSeconds ?? 0) - 103.167) < 0.001);
  const pictures = chooseDouyin({ id: '100', desc: '图文', images: [{ urls: ['http://p3.douyinpic.com/a.jpg'] }, { urls: ['https://127.0.0.1/secret.jpg'] }] }, '100');
  assert.deepEqual(pictures?.images, [{ url: 'https://p3.douyinpic.com/a.jpg' }]);
  assert.equal(chooseDouyin({ id: '100', gears: [{ urls: ['https://v26-web.douyinvod.com/a.mp4'] }] }, '999'), undefined);
});

test('xiaohongshu video uses the page stream and an image note uses every picture', () => {
  const video = chooseXhs({
    id: 'note', type: 'video', title: '视频', author: '作者', desc: '说明',
    streams: [{ url: 'http://sns-video.xhscdn.com/a.mp4', backups: [] }],
    images: [{ url: 'https://sns-webpic-qc.xhscdn.com/cover.webp' }],
  }, 'note');
  assert.equal(video?.mediaUrl, 'https://sns-video.xhscdn.com/a.mp4');
  assert.equal(video?.description, '说明');
  const images = chooseXhs({
    id: '6a9286630000000025026294', type: 'normal', title: '李白的人生轨迹', author: '瀚文', desc: '',
    images: [{ url: 'http://sns-webpic-qc.xhscdn.com/1.webp' }, { url: 'https://sns-webpic-qc.xhscdn.com/2.webp' }],
  }, '6a9286630000000025026294');
  assert.equal(images?.kind, 'images');
  assert.equal(images?.images?.length, 2);
  const many = Array.from({ length: 19 }, (_, index) => ({ url: `https://sns-webpic-qc.xhscdn.com/${index}.webp` }));
  assert.equal(chooseXhs({ id: 'many', type: 'normal', title: '多图', images: many }, 'many')?.images?.length, 19);
  assert.equal(images?.description, undefined);
  assert.equal(publicMediaUrl('小红书', 'http://127.0.0.1/a.webp'), undefined);
});

test('wrapped picture text becomes paragraphs without decoration noise', () => {
  assert.equal(tidyImageText('李白（701-762）。\n80。\nD\n理想：寻仙。'), '李白（701-762）。\n\n理想：寻仙。');
  assert.equal(tidyImageText('李白的人生轨迹\n李白（701-762）。'), '李白的人生轨迹\n\n李白（701-762）。');
});

test('picture notes keep the author, the caption and each picture in order', () => {
  assert.equal(imageNoteText({ author: '瀚文', description: '一生', pages: ['出蜀', ''] }), '瀚文\n\n一生\n\n图片上的文字\n\n【1】\n出蜀\n\n【2】\n这一张没有识别到文字。');
});

test('the page script can see the same addresses the download plugin reads', () => {
  const interesting = douyinBootstrap.slice(douyinBootstrap.indexOf('const interesting = ') + 'const interesting = '.length, douyinBootstrap.indexOf(';', douyinBootstrap.indexOf('const interesting = ')));
  const detail = new Function(`return ${interesting}`)() as RegExp;
  assert.equal(detail.test('/aweme/v1/web/aweme/detail/?aweme_id=1'), true);
  assert.equal(detail.test('/aweme/v1/web/aweme/post/?sec_user_id=1'), true);
  assert.equal(detail.test('https://www.douyin.com/video/1'), false);
  const matchAt = pageCaptureScript.indexOf('pathname.match(') + 'pathname.match('.length;
  const source = pageCaptureScript.slice(matchAt, pageCaptureScript.indexOf('/)', matchAt) + 1);
  const pageId = new Function(`return ${source}`)() as RegExp;
  assert.equal('/explore/6a9286630000000025026294'.match(pageId)?.[1], '6a9286630000000025026294');
  assert.equal('/discovery/item/6a9286630000000025026294'.match(pageId)?.[1], '6a9286630000000025026294');
  assert.equal(douyinBootstrap.includes('cookie'), false);
});
