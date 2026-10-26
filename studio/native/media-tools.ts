import fs from 'node:fs';
import path from 'node:path';

/**
 * Where this computer keeps Python, FFmpeg and the speech model.
 * The file lives in the profile folder, not in a canvas or the source tree.
 */
export const MEDIA_TOOLS_FILE = 'media-tools.json';
const PATH_LIMIT = 1_000;
const KEYS = ['python', 'ffmpeg', 'ffprobe', 'model'] as const;
export type MediaToolKey = (typeof KEYS)[number];
export type MediaToolSettings = Record<MediaToolKey, string>;

export interface MediaToolsStatus {
  settings: MediaToolSettings;
  defaults: MediaToolSettings;
  fromEnvironment: Record<MediaToolKey, boolean>;
}

export type MediaToolsResponse =
  | { ok: true; status: MediaToolsStatus }
  | { ok: false; error: string };

const EMPTY: MediaToolSettings = { python: '', ffmpeg: '', ffprobe: '', model: '' };

function storedFile(directory: string): string {
  return path.join(directory, MEDIA_TOOLS_FILE);
}

function textField(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length > PATH_LIMIT || /[\u0000\r\n]/.test(text)) return null;
  return text;
}

/** Saved overrides. A missing or unfamiliar file means “use the default on this computer”. */
export function readMediaTools(directory: string): MediaToolSettings {
  if (!directory) return { ...EMPTY };
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(storedFile(directory), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY };
    return { ...EMPTY };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...EMPTY };
  const raw = parsed as { version?: unknown };
  if (raw.version !== 1) return { ...EMPTY };
  const settings = { ...EMPTY };
  for (const key of KEYS) {
    const value = textField((parsed as Record<string, unknown>)[key]);
    if (value) settings[key] = value;
  }
  return settings;
}

export function parseMediaTools(input: unknown): { ok: true; settings: MediaToolSettings } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: '本机工具的格式不正确。' };
  const settings = { ...EMPTY };
  for (const key of KEYS) {
    const value = textField((input as Record<string, unknown>)[key]);
    if (value === null) return { ok: false, error: '路径过长，或包含换行。请只填写程序或模型目录的位置。' };
    settings[key] = value;
  }
  return { ok: true, settings };
}

export function writeMediaTools(directory: string, input: unknown): { ok: true; settings: MediaToolSettings } | { ok: false; error: string } {
  if (!directory) return { ok: false, error: '来处的本机资料还没有打开。' };
  const parsed = parseMediaTools(input);
  if (!parsed.ok) return parsed;
  const target = storedFile(directory);
  if (!KEYS.some(key => parsed.settings[key])) {
    try { fs.rmSync(target, { force: true }); }
    catch { return { ok: false, error: '没有把本机工具保存到这台电脑。' }; }
    return { ok: true, settings: { ...EMPTY } };
  }
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, ...parsed.settings }));
    fs.renameSync(temporary, target);
  } catch {
    try { fs.rmSync(temporary, { force: true }); } catch { /* The temporary file is already gone. */ }
    return { ok: false, error: '没有把本机工具保存到这台电脑。' };
  }
  return { ok: true, settings: parsed.settings };
}

export function clearMediaTools(directory: string): { ok: true; settings: MediaToolSettings } | { ok: false; error: string } {
  if (!directory) return { ok: false, error: '来处的本机资料还没有打开。' };
  try { fs.rmSync(storedFile(directory), { force: true }); }
  catch { return { ok: false, error: '没有恢复这台电脑的默认位置。' }; }
  return { ok: true, settings: { ...EMPTY } };
}
