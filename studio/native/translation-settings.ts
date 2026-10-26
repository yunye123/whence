import fs from 'node:fs';
import path from 'node:path';
import { translationBaseUrlError, type TranslationSettings } from '../src/english-translation';

/**
 * The desktop translation key lives in the profile folder, encrypted with the
 * operating system. It is not written into a canvas, an export, or the source tree.
 * The renderer receives only whether a key is saved, never the key itself.
 */
export const TRANSLATION_SETTINGS_FILE = 'translation-settings.json';
const KEY_LIMIT = 2_000;
const URL_LIMIT = 300;
const MODEL_LIMIT = 120;

export interface TranslationCipher {
  available(): boolean;
  encrypt(value: string): Uint8Array;
  decrypt(value: Uint8Array): string;
}

export interface StoredTranslationSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  unreadable: boolean;
}

export interface TranslationSettingsStatus {
  saved: boolean;
  fromEnvironment: boolean;
  unreadable: boolean;
  baseUrl: string;
  model: string;
}

export type TranslationSettingsResponse =
  | { ok: true; status: TranslationSettingsStatus }
  | { ok: false; error: string };

const EMPTY: StoredTranslationSettings = { apiKey: '', baseUrl: '', model: '', unreadable: false };

function storedFile(directory: string): string {
  return path.join(directory, TRANSLATION_SETTINGS_FILE);
}

/** Saved values. A missing, unreadable, or unfamiliar file is treated as empty. */
export function readStoredTranslationSettings(directory: string, cipher: TranslationCipher): StoredTranslationSettings {
  if (!directory) return { ...EMPTY };
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(storedFile(directory), 'utf8')); }
  catch { return { ...EMPTY }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...EMPTY };
  const record = parsed as { version?: unknown; apiKey?: unknown; baseUrl?: unknown; model?: unknown };
  if (record.version !== 1) return { ...EMPTY };
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim().slice(0, URL_LIMIT) : '';
  const model = typeof record.model === 'string' ? record.model.trim().slice(0, MODEL_LIMIT) : '';
  if (typeof record.apiKey !== 'string' || !record.apiKey) return { ...EMPTY, baseUrl, model };
  if (!cipher.available()) return { apiKey: '', baseUrl, model, unreadable: true };
  try {
    const apiKey = cipher.decrypt(Buffer.from(record.apiKey, 'base64')).trim();
    return apiKey ? { apiKey, baseUrl, model, unreadable: false } : { ...EMPTY, baseUrl, model, unreadable: true };
  } catch {
    return { apiKey: '', baseUrl, model, unreadable: true };
  }
}

/** A saved field wins. An empty saved field leaves the environment value, which already includes defaults. */
export function resolveTranslationSettings(stored: StoredTranslationSettings, env: TranslationSettings): TranslationSettings {
  return {
    apiKey: stored.apiKey.trim() || env.apiKey,
    baseUrl: stored.baseUrl.trim() || env.baseUrl,
    model: stored.model.trim() || env.model,
  };
}

export function describeTranslationSettings(stored: StoredTranslationSettings, environmentKey: boolean): TranslationSettingsStatus {
  return {
    saved: !!stored.apiKey,
    fromEnvironment: !stored.apiKey && environmentKey,
    unreadable: stored.unreadable && !stored.apiKey,
    baseUrl: stored.baseUrl,
    model: stored.model,
  };
}

function textField(value: unknown, limit: number): string | null {
  if (typeof value !== 'string' || value.length > limit * 2) return null;
  const trimmed = value.trim();
  return trimmed.length > limit ? null : trimmed;
}

function keyProblem(apiKey: string): string {
  if (!apiKey) return '';
  if (apiKey.length > KEY_LIMIT || apiKey.includes('\u0000') || /\s/.test(apiKey)) return '密钥不正确。请粘贴接口密钥，不要带空格。';
  return '';
}

function modelProblem(model: string): string {
  if (!model) return '';
  if (model.length > MODEL_LIMIT || /[\s\u0000]/.test(model)) return '模型名称不正确。';
  return '';
}

/**
 * Save a key the person typed. An empty key keeps the one already saved.
 * Address and model may be empty, which means “use the default”.
 */
export function writeTranslationSettings(directory: string, cipher: TranslationCipher, input: unknown): TranslationSettingsResponse {
  if (!directory) return { ok: false, error: '来处的本机资料还没有打开。' };
  if (!cipher.available()) return { ok: false, error: '这台电脑暂时不能加密保存密钥。可以改在启动前设置环境变量 CANVAS_TRANSLATE_API_KEY。' };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: '翻译设置格式不正确。' };
  const raw = input as { apiKey?: unknown; baseUrl?: unknown; model?: unknown };
  const apiKey = textField(raw.apiKey, KEY_LIMIT);
  const baseUrl = textField(raw.baseUrl, URL_LIMIT);
  const model = textField(raw.model, MODEL_LIMIT);
  if (apiKey === null || baseUrl === null || model === null) return { ok: false, error: '翻译设置过长或格式不正确。' };
  const keyError = keyProblem(apiKey);
  if (keyError) return { ok: false, error: keyError };
  const urlError = translationBaseUrlError(baseUrl);
  if (urlError) return { ok: false, error: urlError };
  const modelError = modelProblem(model);
  if (modelError) return { ok: false, error: modelError };
  const existing = readStoredTranslationSettings(directory, cipher);
  const nextKey = apiKey || existing.apiKey;
  if (!nextKey) return { ok: false, error: existing.unreadable ? '已保存的密钥读不出来，请重新填写。' : '请填写接口密钥。' };
  let protectedKey = '';
  try { protectedKey = Buffer.from(cipher.encrypt(nextKey)).toString('base64'); }
  catch { return { ok: false, error: '没有把密钥保存到这台电脑。' }; }
  if (!protectedKey || protectedKey === nextKey) return { ok: false, error: '没有把密钥保存到这台电脑。' };
  const body: { version: 1; apiKey: string; baseUrl?: string; model?: string } = { version: 1, apiKey: protectedKey };
  if (baseUrl) body.baseUrl = baseUrl;
  if (model) body.model = model;
  const target = storedFile(directory);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(body), { mode: 0o600 });
    fs.renameSync(temporary, target);
    try { fs.chmodSync(target, 0o600); } catch { /* Windows may ignore the mode. The file still stays in the profile folder. */ }
  } catch {
    try { fs.rmSync(temporary, { force: true }); } catch { /* The temporary file is already gone. */ }
    return { ok: false, error: '没有把密钥保存到这台电脑。' };
  }
  return { ok: true, status: describeTranslationSettings(readStoredTranslationSettings(directory, cipher), false) };
}

export function clearTranslationSettings(directory: string, cipher: TranslationCipher, environmentKey: boolean): TranslationSettingsResponse {
  if (!directory) return { ok: false, error: '来处的本机资料还没有打开。' };
  try { fs.rmSync(storedFile(directory), { force: true }); }
  catch { return { ok: false, error: '没有清除这台电脑上的翻译密钥。' }; }
  return { ok: true, status: describeTranslationSettings(readStoredTranslationSettings(directory, cipher), environmentKey) };
}
