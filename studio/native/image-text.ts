import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const abortError = () => Object.assign(new Error('任务已取消'), { name: 'AbortError' });

/** The OCR command for this computer. The installer runtime wins over a personal ocr.cmd. */
export function ocrCommand(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  const chosen = env.CANVAS_OCR?.trim();
  if (chosen) return chosen;
  const runtime = env.CANVAS_RUNTIME?.trim();
  if (runtime) {
    const bundled = path.join(runtime, 'ocr', platform === 'win32' ? 'ocr.cmd' : 'ocr');
    if (existsSync(bundled)) return bundled;
  }
  if (platform === 'win32') {
    const personal = path.join(env.USERPROFILE || home, '.local', 'bin', 'ocr.cmd');
    if (existsSync(personal)) return personal;
    return '';
  }
  return 'ocr';
}

/** How to start OCR. The installer runtime is Python, so a folder path may contain spaces. */
export function ocrLaunch(command: string, folder: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): { executable: string; args: string[]; verbatim: boolean } {
  const runtime = env.CANVAS_RUNTIME?.trim();
  if (runtime) {
    const python = path.join(runtime, 'python', platform === 'win32' ? 'python.exe' : 'bin/python3');
    const script = path.join(runtime, 'ocr', 'ocr_fast.py');
    const bundled = path.join(runtime, 'ocr', platform === 'win32' ? 'ocr.cmd' : 'ocr');
    if (existsSync(python) && existsSync(script) && path.resolve(command) === path.resolve(bundled)) {
      return { executable: python, args: ['-X', 'utf8', script, folder, folder, '--fast'], verbatim: false };
    }
  }
  if (platform === 'win32') {
    const quote = (value: string) => `"${value.replaceAll('"', '')}"`;
    const line = `${quote(command)} ${quote(folder)} ${quote(folder)} --fast`;
    return { executable: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
  }
  return { executable: command, args: [folder, folder, '--fast'], verbatim: false };
}

/** Read the words printed on each saved picture. Missing local OCR still leaves the pictures importable. */
export async function recognizeImages(files: string[], signal?: AbortSignal): Promise<{ available: boolean; texts: string[] }> {
  const empty = { available: false, texts: files.map(() => '') };
  if (!files.length) return { available: true, texts: [] };
  const command = ocrCommand();
  const folder = path.dirname(path.resolve(files[0]));
  const ready = command && (path.isAbsolute(command) ? existsSync(command) : true);
  if (!ready || files.some(file => path.dirname(path.resolve(file)) !== folder)) return empty;
  if (signal?.aborted) throw abortError();
  let code = 1;
  try {
    code = await new Promise<number>((resolve, reject) => {
      const launch = ocrLaunch(command, folder);
      const child = spawn(launch.executable, launch.args, { windowsHide: true, windowsVerbatimArguments: launch.verbatim });
      const stop = () => { child.kill(); };
      signal?.addEventListener('abort', stop, { once: true });
      const timer = setTimeout(() => { child.kill(); reject(new Error('识别图片文字超过 4 分钟，已停止。')); }, 4 * 60_000);
      child.on('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(error); });
      child.on('exit', status => { clearTimeout(timer); signal?.removeEventListener('abort', stop); resolve(status ?? 1); });
    });
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (error instanceof Error && error.message.startsWith('识别图片文字')) throw error;
    return empty;
  }
  if (signal?.aborted) throw abortError();
  if (code !== 0) return { available: true, texts: files.map(() => '') };
  const texts: string[] = [];
  for (const file of files) {
    const written = path.join(folder, `${path.basename(file, path.extname(file))}.txt`);
    texts.push(existsSync(written) ? (await readFile(written, 'utf8')).replace(/\u0000/g, '').trim() : '');
  }
  return { available: true, texts };
}
