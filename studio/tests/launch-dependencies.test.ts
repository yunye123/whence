import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error The launcher helper is a plain .mjs script without type declarations.
import { missingPackages, missingPackagesMessage, runtimePackages } from '../scripts/dependency-check.mjs';

test('FD-01: the launcher lists runtime packages that do not resolve from the app folder, like Node and Vite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'field-deps-'));
  try {
    const app = path.join(root, 'studio-next');
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ dependencies: { react: '19.3.0', '@codemirror/state': '6.7.6', '@lezer/markdown': '1.7.2' }, devDependencies: { typescript: '7.0.2' } }));
    // react sits in the shared folder above (the daily layout), @lezer/markdown in the app's own node_modules.
    for (const [base, name] of [[root, 'react'], [app, '@lezer/markdown'], [root, '@vitejs/plugin-react']] as const) {
      fs.mkdirSync(path.join(base, 'node_modules', ...name.split('/')), { recursive: true });
      fs.writeFileSync(path.join(base, 'node_modules', ...name.split('/'), 'package.json'), '{}');
    }
    assert.deepEqual(runtimePackages(app), ['react', '@codemirror/state', '@lezer/markdown', '@vitejs/plugin-react'], 'devDependencies other than the Vite plugin are not runtime packages');
    assert.deepEqual(missingPackages(app), ['@codemirror/state']);
    const message = missingPackagesMessage(app, ['@codemirror/state']);
    assert.match(message, /缺少 1 个运行所需的依赖包/);
    assert.ok(message.includes(`cd /d "${app}" && npm install`), 'the exact command to copy');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
