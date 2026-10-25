import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWebArticle } from '../src/web-article';

const sentence = '河水在夜里还是慢慢地走，岸上的灯一盏一盏地灭了，只有风穿过芦苇，把白天的话又送回来一次。';

test('a long article keeps its pictures in place and drops the navigation', () => {
  const article = Array.from({ length: 12 }, () => `<p>${sentence}</p>`).join('');
  const html = `<!doctype html><html><head><title>河岸笔记</title></head><body><nav>首页 分类 登录 关于我们</nav><article><h1>河岸笔记</h1>${article}<img src="/photo.jpg" alt="河岸的照片"></article></body></html>`;
  const parsed = extractWebArticle(html, 'https://example.com/shore');
  assert.ok(parsed);
  assert.equal(parsed.title, '河岸笔记');
  assert.match(parsed.body, /河水在夜里/);
  assert.doesNotMatch(parsed.body, /首页 分类/);
  assert.match(parsed.body, /!\[河岸的照片\]\(https:\/\/example.com\/photo\.jpg\)/);
  assert.ok(parsed.body.indexOf('河水在夜里') < parsed.body.indexOf('photo.jpg'));
});

test('a page with no article is not a body', () => {
  const home = '<!doctype html><html><head><title>Home</title></head><body><h1>Welcome</h1><p>Hi</p></body></html>';
  assert.equal(extractWebArticle(home, 'https://example.com/'), null);
  const nav = '<!doctype html><html><head><title>Home</title></head><body><nav>首页 分类 登录</nav><footer>版权所有</footer></body></html>';
  assert.equal(extractWebArticle(nav, 'https://example.com/'), null);
  assert.equal(extractWebArticle('<!doctype html><html><body></body></html>', 'https://example.com/'), null);
  assert.equal(extractWebArticle('not html at all', 'https://example.com/'), null);
});
