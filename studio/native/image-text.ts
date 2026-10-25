import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const abortError = () => Object.assign(new Error('任务已取消'), { name: 'AbortError' });

/** Read the words printed on each saved picture. Missing local OCR still leaves the pictures importable. */
export async function recognizeImages(files: string[], signal?: AbortSignal): Promise<{ available: boolean; texts: string[] }> {
  const empty = { available: false, texts: files.map(() => '') };
  if (!files.length) return { available: true, texts: [] };
  const command = process.platform === 'win32' ? path.join(process.env.USERPROFILE || '', '.local', 'bin', 'ocr.cmd') : 'ocr';
  const folder = path.dirname(path.resolve(files[0]));
  if (!existsSync(command) || files.some(file => path.dirname(path.resolve(file)) !== folder)) return empty;
  if (signal?.aborted) throw abortError();
  let code = 1;
  try {
    code = await new Promise<number>((resolve, reject) => {
      const executable = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : command;
      const args = process.platform === 'win32'
        ? ['/d', '/s', '/c', `"${command}" "${folder}" "${folder}" --fast`]
        : [folder, folder, '--fast'];
      const child = spawn(executable, args, { windowsHide: true });
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
