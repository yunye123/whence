import fs from 'node:fs';
import path from 'node:path';

/**
 * Packages the app imports at runtime: every `dependencies` entry of package.json, plus the Vite React plugin that
 * vite.config.ts loads. A missing one only surfaces when a lazy module (the Inspector's editor, a font) first
 * loads, and then the whole window falls to the error page (FD-01), so the launcher checks them before starting.
 */
export function runtimePackages(studioRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(studioRoot, 'package.json'), 'utf8'));
  return [...new Set([...Object.keys(manifest.dependencies ?? {}), '@vitejs/plugin-react'])];
}

/** Resolve like Node and Vite do from the app folder: node_modules/<name> in it or in any folder above it. */
export function packageDirectory(studioRoot, name) {
  for (let directory = path.resolve(studioRoot); ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, 'node_modules', ...name.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.dirname(directory) === directory) return null;
  }
}

/** Packages that cannot be resolved from the app folder; an empty list means the launcher may start. */
export function missingPackages(studioRoot) {
  return runtimePackages(studioRoot).filter(name => !packageDirectory(studioRoot, name));
}

/** The message a person without programming background can act on: what is missing and the exact command. */
export function missingPackagesMessage(studioRoot, missing) {
  return [
    `缺少 ${missing.length} 个运行所需的依赖包，已停止启动（否则打开卡片时会出错）：`,
    ...missing.map(name => `  - ${name}`),
    '请在命令提示符里运行下面这一行，装好后再启动来处：',
    `  cd /d "${path.resolve(studioRoot)}" && npm install`,
  ].join('\n');
}
