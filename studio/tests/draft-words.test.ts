import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DraftWords from '../src/inspector/DraftWords';
import { getAllBy, textContent } from './helpers/markup';

// INSP-32: short serif passages tuck the blank half of 、，；： in (a span the stylesheet narrows); 。 keeps its full
// width so a superscript can still tuck into it, and the text itself is unchanged.
test('draft words wrap the mid-sentence marks and leave the text as written', () => {
  const text = '摊主说，四点出摊不是为了赚钱；是为了等头班公交的司机。';
  const html = renderToStaticMarkup(createElement(DraftWords, { text, className: 'watch-origin__draft-text' }));
  assert.equal(textContent(html), text);
  assert.deepEqual(getAllBy(html, { className: 'draft-punct' }).map(element => textContent(element)), ['，', '；']);
  assert.equal(html.includes('<span class="draft-punct">。</span>'), false, 'the full stop keeps its width');
});
