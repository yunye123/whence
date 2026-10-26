import test from 'node:test';
import assert from 'node:assert/strict';
import { pythonPth } from '../scripts/package-windows.mjs';

test('embeddable Python is told to use the installer site-packages', () => {
  const rewritten = pythonPth('python312.zip\r\n.\r\n\r\n# Uncomment to run site.main() automatically\r\n#import site\r\n');
  assert.equal(rewritten, 'python312.zip\r\n.\r\nLib\\site-packages\r\nimport site\r\n');
  assert.equal(rewritten.includes('#'), false);
});
