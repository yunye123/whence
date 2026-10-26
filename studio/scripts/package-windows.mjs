import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const studioRoot = path.join(repoRoot, 'studio');
const outputRoot = path.join(repoRoot, 'output', 'windows-setup');
const cacheRoot = path.join(outputRoot, 'cache');
const installRoot = path.join(outputRoot, '来处');
const PYTHON_URL = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip';
const PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';
const FFMPEG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip';

/** Embeddable Python ignores site-packages until this file says otherwise. */
export function pythonPth(original) {
  const lines = String(original).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const zip = lines.find(line => line.endsWith('.zip')) || 'python312.zip';
  return `${zip}\r\n.\r\nLib\\site-packages\r\nimport site\r\n`;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, ...options });
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} 退出码 ${code}`))));
  });
}

async function download(url, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const partial = `${destination}.partial`;
  await fs.rm(partial, { force: true });
  try {
    await run('curl.exe', ['-L', '--fail', '--retry', '3', '--retry-all-errors', '-o', partial, url]);
    await fs.rename(partial, destination);
  } catch (error) {
    await fs.rm(partial, { force: true });
    throw error;
  }
}

async function cachedDownload(url, name) {
  const destination = path.join(cacheRoot, name);
  try {
    const existing = await fs.stat(destination);
    if (existing.size > 10_000) return destination;
  } catch { /* Download it. */ }
  console.log(`正在下载 ${name}`);
  await download(url, destination);
  return destination;
}

async function expand(zip, destination) {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  const command = `Expand-Archive -LiteralPath '${zip.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`;
  await run('powershell.exe', ['-NoProfile', '-Command', command]);
}

async function findFile(directory, name) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findFile(full, name);
      if (found) return found;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) return full;
  }
  return '';
}

async function preparePython(runtime) {
  const pythonDir = path.join(runtime, 'python');
  const zip = await cachedDownload(PYTHON_URL, 'python-embed.zip');
  console.log('正在展开 Python');
  await expand(zip, pythonDir);
  const pthName = (await fs.readdir(pythonDir)).find(name => name.endsWith('._pth'));
  if (!pthName) throw new Error('Python 压缩包里没有 ._pth，无法安装转写和识图组件。');
  const pth = path.join(pythonDir, pthName);
  await fs.writeFile(pth, pythonPth(await fs.readFile(pth, 'utf8')));
  const getPip = await cachedDownload(PIP_URL, 'get-pip.py');
  const python = path.join(pythonDir, 'python.exe');
  const env = { ...process.env, PYTHONNOUSERSITE: '1', PYTHONUTF8: '1' };
  console.log('正在安装 pip');
  await run(python, ['-X', 'utf8', getPip, '--no-warn-script-location'], { env });
  console.log('正在安装语音转写、视频下载和识图组件');
  try {
    await run(python, ['-X', 'utf8', '-m', 'pip', 'install', '--disable-pip-version-check', 'yt-dlp', 'faster-whisper==1.2.1', 'av==18.0.0', 'rapidocr-onnxruntime'], { env });
  } catch (error) {
    console.log(`rapidocr-onnxruntime 没有装上（${error instanceof Error ? error.message : error}），改用 rapidocr。`);
    await run(python, ['-X', 'utf8', '-m', 'pip', 'install', '--disable-pip-version-check', 'yt-dlp', 'faster-whisper', 'rapidocr'], { env });
  }
}

async function prepareFfmpeg(runtime) {
  const destination = path.join(runtime, 'ffmpeg');
  await fs.mkdir(destination, { recursive: true });
  try {
    const zip = await cachedDownload(FFMPEG_URL, 'ffmpeg-lgpl.zip');
    const unpacked = path.join(cacheRoot, 'ffmpeg-lgpl');
    console.log('正在展开 FFmpeg');
    await expand(zip, unpacked);
    const ffmpeg = await findFile(unpacked, 'ffmpeg.exe');
    const ffprobe = await findFile(unpacked, 'ffprobe.exe');
    if (!ffmpeg || !ffprobe) throw new Error('压缩包里没有 ffmpeg.exe');
    await fs.copyFile(ffmpeg, path.join(destination, 'ffmpeg.exe'));
    await fs.copyFile(ffprobe, path.join(destination, 'ffprobe.exe'));
    return 'BtbN FFmpeg LGPL 构建。';
  } catch (error) {
    const local = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ffmpeg', 'bin');
    console.log(`没能下载 LGPL 版 FFmpeg（${error instanceof Error ? error.message : error}），改用这台电脑上已有的程序。`);
    await fs.copyFile(path.join(local, 'ffmpeg.exe'), path.join(destination, 'ffmpeg.exe'));
    await fs.copyFile(path.join(local, 'ffprobe.exe'), path.join(destination, 'ffprobe.exe'));
    return '这次用的是制作这台电脑上已有的 FFmpeg。若 ffmpeg -version 里有 --enable-gpl，这份程序按 GPL 再分发，需要连同许可证一起给对方。';
  }
}

async function copyTree(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true });
}

async function assemble() {
  if (process.platform !== 'win32') throw new Error('这个安装包只在 Windows 上制作。');
  if (!process.env.WHENCE_SKIP_BUILD) {
    console.log('正在构建来处');
    await run('cmd.exe', ['/d', '/s', '/c', 'npm run build'], { cwd: repoRoot });
  }
  console.log('正在整理安装目录');
  await fs.rm(installRoot, { recursive: true, force: true });
  await fs.mkdir(installRoot, { recursive: true });
  await fs.cp(path.join(repoRoot, 'node_modules', 'electron', 'dist'), installRoot, { recursive: true });
  await fs.rename(path.join(installRoot, 'electron.exe'), path.join(installRoot, '来处.exe'));
  await copyTree(path.join(studioRoot, 'dist'), path.join(installRoot, 'app', 'studio', 'dist'));
  await copyTree(path.join(studioRoot, 'dist-native'), path.join(installRoot, 'app', 'studio', 'dist-native'));
  await copyTree(path.join(studioRoot, 'native', 'workers'), path.join(installRoot, 'app', 'studio', 'native', 'workers'));
  await copyTree(path.join(studioRoot, 'native', 'windows'), path.join(installRoot, 'app', 'studio', 'native', 'windows'));
  await copyTree(path.join(studioRoot, 'desktop-assets', 'field.ico'), path.join(installRoot, 'app', 'studio', 'desktop-assets', 'field.ico'));
  await fs.copyFile(path.join(studioRoot, 'THIRD_PARTY_NOTICES.txt'), path.join(installRoot, 'THIRD_PARTY_NOTICES.txt'));
  await fs.copyFile(path.join(repoRoot, 'LICENSE'), path.join(installRoot, 'LICENSE'));
  for (const name of ['启动来处.cmd', '安装并检查.cmd']) {
    await fs.copyFile(path.join(studioRoot, 'native', 'windows', name), path.join(installRoot, name));
  }
  const shortcut = await fs.readFile(path.join(studioRoot, 'native', 'windows', 'ensure-shortcut.vbs'));
  await fs.writeFile(path.join(installRoot, 'ensure-shortcut.vbs'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(shortcut.toString('utf8'), 'utf16le')]));
  const runtime = path.join(installRoot, 'runtime');
  await preparePython(runtime);
  await fs.mkdir(path.join(runtime, 'ocr'), { recursive: true });
  await fs.copyFile(path.join(studioRoot, 'native', 'windows', 'ocr.cmd'), path.join(runtime, 'ocr', 'ocr.cmd'));
  await fs.copyFile(path.join(studioRoot, 'native', 'windows', 'ocr_fast.py'), path.join(runtime, 'ocr', 'ocr_fast.py'));
  const ffmpegNote = await prepareFfmpeg(runtime);
  const modelSource = path.join(process.env.USERPROFILE || '', '.cache', 'faster-whisper', 'large-v3');
  if (!await fs.stat(path.join(modelSource, 'model.bin')).then(item => item.size > 1_000_000).catch(() => false)) {
    throw new Error('这台电脑没有可用的 faster-whisper large-v3 模型，语音转文字没法装进安装包。');
  }
  console.log('正在复制语音模型（大约 3 GB）');
  await fs.cp(modelSource, path.join(runtime, 'models', 'faster-whisper', 'large-v3'), { recursive: true });
  await fs.mkdir(path.join(installRoot, 'profile'), { recursive: true });
  await fs.writeFile(path.join(runtime, 'installed.json'), JSON.stringify({
    product: 'laichu', version: '0.1.0', model: 'faster-whisper-large-v3', ocr: 'rapidocr', translation: 'later',
  }, null, 2));
  await fs.writeFile(path.join(installRoot, '请先读我.txt'), `\uFEFF把整个「来处」文件夹交给对方，不要只发其中一个文件。
对方双击「安装并检查.cmd」。它会检查程序、语音转文字和识图，并在桌面没有旧图标时放上「来处」。
翻译接口密钥可以以后在来处侧栏的钥匙图标里填写，不影响这次安装。
画布保存在这个文件夹里的 profile。换地方存放后，再双击一次「安装并检查.cmd」。
${ffmpegNote}
`, 'utf8');
  console.log('正在检查安装结果');
  await run(path.join(runtime, 'python', 'python.exe'), ['-X', 'utf8', path.join(installRoot, 'app', 'studio', 'native', 'windows', 'self-test.py'), installRoot], {
    env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONUTF8: '1' },
  });
  console.log(`安装包已放在：${installRoot}`);
}

const startedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (startedDirectly) {
  assemble().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
