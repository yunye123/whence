import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

function signingEnv() {
  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  for (const key of [
    'CSC_LINK', 'WIN_CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_KEY_PASSWORD', 'CSC_NAME',
    'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID',
    'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE',
  ]) delete env[key];
  return env;
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', shell: false, windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} 退出码 ${code ?? 'signal'}`))));
  });
}

if (process.platform !== 'win32' && process.platform !== 'darwin') {
  console.error('npm run dist 只在 Windows 上生成 NSIS 安装包（x64），在 macOS 上生成 x64 与 arm64 两份 dmg。');
  console.error(`当前系统是 ${process.platform}，打不出这两种安装包。请从 GitHub Actions 的 windows-latest 与 macos-latest 任务下载。不要用 Wine 做 Mac 安装包。`);
  console.error('npm run dist builds an NSIS x64 installer on Windows and two dmgs (x64 and arm64) on macOS.');
  console.error(`This machine is ${process.platform}, so it cannot produce those installers. Download them from the GitHub Actions windows-latest and macos-latest jobs. Do not use Wine to make a Mac package.`);
  process.exit(1);
}

const env = signingEnv();
const rootPackage = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const studioPackage = JSON.parse(await fs.readFile(path.join(root, 'studio/package.json'), 'utf8'));
if (rootPackage.version !== studioPackage.version) {
  throw new Error(`根 package.json 版本 ${rootPackage.version} 与 studio/package.json 版本 ${studioPackage.version} 不一致。`);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('请用 npm run dist 启动打包，这样能找到 npm。');
await run(process.execPath, [npmCli, 'run', 'build'], env);

const builder = require.resolve('electron-builder/cli.js');
const args = process.platform === 'win32'
  ? [builder, '--config', 'electron-builder.yml', '--publish', 'never', '--win', 'nsis', '--x64']
  : [builder, '--config', 'electron-builder.yml', '--publish', 'never', '--mac', 'dmg', '--x64', '--arm64'];
await run(process.execPath, args, env);

const expected = process.platform === 'win32'
  ? [`whence-${rootPackage.version}-win-x64.exe`]
  : [`whence-${rootPackage.version}-mac-x64.dmg`, `whence-${rootPackage.version}-mac-arm64.dmg`];
const produced = await fs.readdir(path.join(root, 'release'));
const missing = expected.filter(name => !produced.includes(name));
if (missing.length) {
  console.error(`安装包没有按预期文件名生成：${missing.join('、')}`);
  console.error(`release/ 里实际有：${produced.join('、') || '（空）'}`);
  process.exit(1);
}
console.log(expected.map(name => `已生成 ${name}`).join('\n'));
