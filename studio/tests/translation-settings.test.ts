import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { translationSettingsFromEnv } from '../src/english-translation';
import {
  TRANSLATION_SETTINGS_FILE, clearTranslationSettings, describeTranslationSettings, readStoredTranslationSettings,
  resolveTranslationSettings, writeTranslationSettings, type TranslationCipher,
} from '../native/translation-settings';

const KEY = 'sk-unit-key-12345';

function cipher(available = true): TranslationCipher {
  return {
    available: () => available,
    encrypt(value) { return Buffer.from(`v1:${value.split('').reverse().join('')}`, 'utf8'); },
    decrypt(value) {
      const text = Buffer.from(value).toString('utf8');
      if (!text.startsWith('v1:')) throw new Error('bad');
      return text.slice(3).split('').reverse().join('');
    },
  };
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'field-translation-'));
}

test('a saved translation key is encrypted on disk and wins over the environment', () => {
  const directory = tempDir();
  try {
    const saved = writeTranslationSettings(directory, cipher(), { apiKey: `  ${KEY}  `, baseUrl: '', model: '' });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.status.saved, true);
    assert.equal(JSON.stringify(saved.status).includes(KEY), false);
    const file = fs.readFileSync(path.join(directory, TRANSLATION_SETTINGS_FILE), 'utf8');
    assert.equal(file.includes(KEY), false);
    assert.deepEqual(fs.readdirSync(directory), [TRANSLATION_SETTINGS_FILE]);
    const stored = readStoredTranslationSettings(directory, cipher());
    assert.equal(stored.apiKey, KEY);
    assert.equal(stored.unreadable, false);
    const env = translationSettingsFromEnv({ CANVAS_TRANSLATE_API_KEY: 'env-key', CANVAS_TRANSLATE_BASE_URL: 'https://env.example', CANVAS_TRANSLATE_MODEL: 'env-model' });
    assert.deepEqual(resolveTranslationSettings(stored, env), { apiKey: KEY, baseUrl: env.baseUrl, model: env.model });
    assert.equal(describeTranslationSettings(stored, true).fromEnvironment, false);
    const kept = writeTranslationSettings(directory, cipher(), { apiKey: '', baseUrl: 'https://example.test/v1', model: 'unit-model' });
    assert.equal(kept.ok, true);
    const next = readStoredTranslationSettings(directory, cipher());
    assert.equal(next.apiKey, KEY);
    assert.equal(next.baseUrl, 'https://example.test/v1');
    assert.equal(next.model, 'unit-model');
    const before = fs.readFileSync(path.join(directory, TRANSLATION_SETTINGS_FILE), 'utf8');
    const rejected = writeTranslationSettings(directory, cipher(), { apiKey: 'another-key', baseUrl: `https://${KEY}:secret@example.test`, model: '' });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(rejected.error.includes(KEY), false);
      assert.equal(rejected.error.includes('another-key'), false);
    }
    assert.equal(fs.readFileSync(path.join(directory, TRANSLATION_SETTINGS_FILE), 'utf8'), before);
    const cleared = clearTranslationSettings(directory, cipher(), true);
    assert.equal(cleared.ok, true);
    if (cleared.ok) {
      assert.equal(cleared.status.saved, false);
      assert.equal(cleared.status.fromEnvironment, true);
    }
    assert.equal(fs.existsSync(path.join(directory, TRANSLATION_SETTINGS_FILE)), false);
    assert.equal(resolveTranslationSettings(readStoredTranslationSettings(directory, cipher()), env).apiKey, 'env-key');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a translation key is not written when encryption, the key, or the address is unusable', () => {
  const directory = tempDir();
  try {
    const locked = writeTranslationSettings(directory, cipher(false), { apiKey: KEY, baseUrl: '', model: '' });
    assert.equal(locked.ok, false);
    assert.equal(fs.existsSync(path.join(directory, TRANSLATION_SETTINGS_FILE)), false);
    const spaced = writeTranslationSettings(directory, cipher(), { apiKey: 'not a key', baseUrl: '', model: '' });
    assert.equal(spaced.ok, false);
    if (!spaced.ok) assert.match(spaced.error, /空格/);
    const empty = writeTranslationSettings(directory, cipher(), { apiKey: '  ', baseUrl: '', model: '' });
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.match(empty.error, /请填写接口密钥/);
    assert.equal(fs.existsSync(path.join(directory, TRANSLATION_SETTINGS_FILE)), false);
    fs.writeFileSync(path.join(directory, TRANSLATION_SETTINGS_FILE), JSON.stringify({ version: 1, apiKey: Buffer.from('bad').toString('base64') }));
    const broken = readStoredTranslationSettings(directory, cipher());
    assert.equal(broken.apiKey, '');
    assert.equal(broken.unreadable, true);
    assert.equal(describeTranslationSettings(broken, false).saved, false);
    fs.writeFileSync(path.join(directory, TRANSLATION_SETTINGS_FILE), '{"version":2,"apiKey":"plain-key"}');
    assert.equal(readStoredTranslationSettings(directory, cipher()).apiKey, '');
    fs.writeFileSync(path.join(directory, TRANSLATION_SETTINGS_FILE), 'not json');
    assert.deepEqual(readStoredTranslationSettings(directory, cipher()), { apiKey: '', baseUrl: '', model: '', unreadable: false });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
