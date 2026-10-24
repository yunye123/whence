import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacyRoot = path.dirname(studioRoot);
const originalMain = path.join(legacyRoot, 'electron/main.ts');
const originalPreload = path.join(legacyRoot, 'electron/preload.ts');
const hash = value => createHash('sha256').update(value).digest('hex');

/** Bundle the desktop shell. Stop if main or preload changes while esbuild is reading it. */
export async function buildNative() {
  const [rawMain, rawPreload] = await Promise.all([fs.readFile(originalMain, 'utf8'), fs.readFile(originalPreload, 'utf8')]);
  const out = path.join(studioRoot, 'dist-native');
  await fs.mkdir(out, { recursive: true });
  const common = { absWorkingDir: legacyRoot, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] };
  await build({ ...common, entryPoints: [originalMain], outfile: path.join(out, 'main.cjs'), sourcemap: true });
  await build({ ...common, entryPoints: [originalPreload], outfile: path.join(out, 'preload.cjs'), sourcemap: true });
  const current = await Promise.all([fs.readFile(originalMain, 'utf8'), fs.readFile(originalPreload, 'utf8')]);
  if (current[0] !== rawMain || current[1] !== rawPreload) throw new Error('构建期间旧桌面源码发生了并发变化，请重新构建后再启动。');
  const workerDirectory = path.join(studioRoot, 'native', 'workers');
  const worker = await fs.readFile(path.join(workerDirectory, 'transcribe.py'), 'utf8').catch(() => {
    throw new Error('缺少来处自己的转写程序 native/workers/transcribe.py，已停止构建。');
  });
  await fs.writeFile(path.join(out, 'build-info.json'), JSON.stringify({
    builtAt: new Date().toISOString(), legacyRoot,
    sources: { 'electron/main.ts': hash(rawMain), 'electron/preload.ts': hash(rawPreload) },
    worker: { 'native/workers/transcribe.py': hash(worker) },
  }, null, 2));
  return path.join(out, 'main.cjs');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildNative().then(entry => console.log(`来处独立桌面已构建：${entry}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
